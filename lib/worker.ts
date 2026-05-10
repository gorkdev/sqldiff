import { parseDump } from "./parser";
import { diffSnapshots } from "./differ";
import { getJob, updateJob } from "./job-store";
import type { DiffSummary } from "./types";

export function startJob(id: string): void {
  void runJob(id).catch((err) => {
    updateJob(id, {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

async function runJob(id: string): Promise<void> {
  const job = getJob(id);
  if (!job) throw new Error(`Job ${id} not found`);

  updateJob(id, { status: "parsing-old" });
  const oldSnap = await parseDump(job.oldFile.path, {
    onProgress: (progress) => {
      updateJob(id, { progress });
    },
  });

  updateJob(id, {
    status: "parsing-new",
    progress: { currentTable: null, bytesRead: 0, totalBytes: job.newFile.size, rowsSeen: 0 },
  });
  const newSnap = await parseDump(job.newFile.path, {
    onProgress: (progress) => {
      updateJob(id, { progress });
    },
  });

  updateJob(id, { status: "diffing" });
  const tables = diffSnapshots(oldSnap, newSnap);

  const summary: DiffSummary = {
    oldFileName: job.oldFile.name,
    newFileName: job.newFile.name,
    oldFileSize: job.oldFile.size,
    newFileSize: job.newFile.size,
    generatedAt: new Date().toISOString(),
    tables,
  };

  updateJob(id, { status: "done", summary });
}
