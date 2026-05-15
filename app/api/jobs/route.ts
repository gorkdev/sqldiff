import { NextRequest } from "next/server";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import Busboy from "busboy";
import { createJob } from "@/lib/job-store";
import { startJob } from "@/lib/worker";
import type { JobState } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UploadedFile = { name: string; size: number; path: string };

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return Response.json(
      { error: "Expected multipart/form-data." },
      { status: 400 }
    );
  }
  if (!request.body) {
    return Response.json({ error: "Empty body." }, { status: 400 });
  }

  const jobId = randomUUID();
  const dir = join(tmpdir(), "sqldiff", jobId);
  await mkdir(dir, { recursive: true });

  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => {
    headers[k] = v;
  });
  const bb = Busboy({ headers });

  let oldFile: UploadedFile | null = null;
  let newFile: UploadedFile | null = null;
  const fileWrites: Promise<void>[] = [];

  bb.on("file", (fieldname, fileStream, info) => {
    if (fieldname !== "oldDump" && fieldname !== "newDump") {
      fileStream.resume();
      return;
    }
    const fallback = fieldname === "oldDump" ? "old.sql" : "new.sql";
    const displayName = info.filename || fallback;
    const safeName = sanitizeName(info.filename, fallback);
    const filePath = join(dir, safeName);

    let bytesWritten = 0;
    fileStream.on("data", (chunk: Buffer) => {
      bytesWritten += chunk.length;
    });

    const writeJob = pipeline(fileStream, createWriteStream(filePath)).then(
      () => {
        const meta: UploadedFile = {
          name: displayName,
          size: bytesWritten,
          path: filePath,
        };
        if (fieldname === "oldDump") oldFile = meta;
        else newFile = meta;
      }
    );
    fileWrites.push(writeJob);
  });

  try {
    await new Promise<void>((resolve, reject) => {
      bb.once("close", () => resolve());
      bb.once("error", reject);
      Readable.fromWeb(
        request.body as Parameters<typeof Readable.fromWeb>[0]
      )
        .on("error", reject)
        .pipe(bb);
    });
    await Promise.all(fileWrites);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Upload failed." },
      { status: 400 }
    );
  }

  const oldMeta = oldFile as UploadedFile | null;
  const newMeta = newFile as UploadedFile | null;
  if (!oldMeta || !newMeta) {
    return Response.json(
      { error: "Both `oldDump` and `newDump` files are required." },
      { status: 400 }
    );
  }

  const state: JobState = {
    id: jobId,
    status: "queued",
    oldFile: oldMeta,
    newFile: newMeta,
    progress: {
      currentTable: null,
      bytesRead: 0,
      totalBytes: oldMeta.size,
      rowsSeen: 0,
    },
    createdAt: Date.now(),
  };

  createJob(state);
  startJob(jobId);

  return Response.json({ jobId });
}

function sanitizeName(name: string | undefined, fallback: string): string {
  const base = (name ?? "").replace(/[\\/:*?"<>|]/g, "_").trim();
  return base || fallback;
}
