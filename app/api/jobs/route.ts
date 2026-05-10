import { NextRequest } from "next/server";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createJob } from "@/lib/job-store";
import { startJob } from "@/lib/worker";
import type { JobState } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const oldFile = form.get("oldDump");
  const newFile = form.get("newDump");

  if (!(oldFile instanceof File) || !(newFile instanceof File)) {
    return Response.json(
      { error: "Both `oldDump` and `newDump` files are required." },
      { status: 400 }
    );
  }

  const jobId = randomUUID();
  const dir = join(tmpdir(), "sqldiff", jobId);
  await mkdir(dir, { recursive: true });

  const oldPath = join(dir, sanitizeName(oldFile.name, "old.sql"));
  const newPath = join(dir, sanitizeName(newFile.name, "new.sql"));

  await Promise.all([writeFile(oldFile, oldPath), writeFile(newFile, newPath)]);

  const state: JobState = {
    id: jobId,
    status: "queued",
    oldFile: { name: oldFile.name, size: oldFile.size, path: oldPath },
    newFile: { name: newFile.name, size: newFile.size, path: newPath },
    progress: {
      currentTable: null,
      bytesRead: 0,
      totalBytes: oldFile.size,
      rowsSeen: 0,
    },
    createdAt: Date.now(),
  };

  createJob(state);
  startJob(jobId);

  return Response.json({ jobId });
}

async function writeFile(file: File, path: string): Promise<void> {
  const webStream = file.stream();
  const nodeStream = Readable.fromWeb(webStream as Parameters<typeof Readable.fromWeb>[0]);
  await pipeline(nodeStream, createWriteStream(path));
}

function sanitizeName(name: string, fallback: string): string {
  const base = name.replace(/[\\/:*?"<>|]/g, "_").trim();
  return base || fallback;
}
