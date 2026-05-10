import { NextRequest } from "next/server";
import { rm } from "node:fs/promises";
import { dirname } from "node:path";
import { deleteJob, getJob } from "@/lib/job-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const job = getJob(id);
  if (!job) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(serializeJob(job));
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const job = getJob(id);
  if (!job) return Response.json({ ok: true });

  const dir = dirname(job.oldFile.path);
  await rm(dir, { recursive: true, force: true }).catch(() => {});
  deleteJob(id);
  return Response.json({ ok: true });
}

function serializeJob(job: ReturnType<typeof getJob>) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    error: job.error,
    oldFile: { name: job.oldFile.name, size: job.oldFile.size },
    newFile: { name: job.newFile.name, size: job.newFile.size },
    summary: job.summary
      ? {
          oldFileName: job.summary.oldFileName,
          newFileName: job.summary.newFileName,
          oldFileSize: job.summary.oldFileSize,
          newFileSize: job.summary.newFileSize,
          generatedAt: job.summary.generatedAt,
          tables: job.summary.tables.map((t) => ({
            table: t.table,
            columns: t.columns,
            pkColumns: t.pkColumns,
            insertCount: t.inserts.length,
            updateCount: t.updates.length,
            deleteCount: t.deletes.length,
            samples: collectSamples(t),
          })),
        }
      : undefined,
  };
}

function collectSamples(t: import("@/lib/types").TableDiff) {
  const limit = 5;
  const sample = (changes: typeof t.inserts, kind: "insert" | "update" | "delete") =>
    changes.slice(0, limit).map((c) => ({
      kind,
      pkValues: c.pkValues,
      preview: previewSql(t, c, kind),
    }));
  return {
    inserts: sample(t.inserts, "insert"),
    updates: sample(t.updates, "update"),
    deletes: sample(t.deletes, "delete"),
  };
}

function previewSql(
  t: import("@/lib/types").TableDiff,
  c: import("@/lib/types").RowChange,
  kind: "insert" | "update" | "delete"
): string {
  const ident = (s: string) => "`" + s.replace(/`/g, "``") + "`";
  if (kind === "insert" && c.newRow) {
    return `INSERT INTO ${ident(t.table)} (${c.newRow.columns.map(ident).join(",")}) VALUES (${c.newRow.values});`;
  }
  if (kind === "delete" && c.oldRow) {
    const where = (t.pkColumns.length ? t.pkColumns : c.oldRow.columns)
      .map((col, i) => `${ident(col)}=${(t.pkColumns.length ? c.oldRow!.pkValues : c.oldRow!.values.split(","))[i] ?? "NULL"}`)
      .join(" AND ");
    return `DELETE FROM ${ident(t.table)} WHERE ${where};`;
  }
  if (kind === "update" && c.newRow) {
    const where = t.pkColumns
      .map((col, i) => `${ident(col)}=${c.newRow!.pkValues[i]}`)
      .join(" AND ");
    return `UPDATE ${ident(t.table)} SET … WHERE ${where};`;
  }
  return "";
}
