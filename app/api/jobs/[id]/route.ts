import { NextRequest } from "next/server";
import { rm } from "node:fs/promises";
import { dirname } from "node:path";
import { deleteJob, getJob } from "@/lib/job-store";
import { splitTupleValues } from "@/lib/parser";
import type { RowChange, TableDiff } from "@/lib/types";

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

function collectSamples(t: TableDiff) {
  const sample = (changes: RowChange[], kind: "insert" | "delete") =>
    changes.map((c) => ({
      kind,
      pkValues: c.pkValues,
      preview: previewLine(t, c, kind),
    }));
  return {
    inserts: sample(t.inserts, "insert"),
    updates: t.updates.map((c) => ({
      kind: "update" as const,
      pkValues: c.pkValues,
      preview: pkLabel(t.pkColumns, c.pkValues),
      cellDiffs: cellDiffsOf(t, c),
    })),
    deletes: sample(t.deletes, "delete"),
  };
}

function cellDiffsOf(
  t: TableDiff,
  c: RowChange
): { column: string; oldValue: string; newValue: string }[] {
  if (!c.oldRow || !c.newRow) return [];
  const cols = c.newRow.columns.length ? c.newRow.columns : t.columns;
  const oldCells = splitTupleValues(c.oldRow.values);
  const newCells = splitTupleValues(c.newRow.values);
  const out: { column: string; oldValue: string; newValue: string }[] = [];
  for (let i = 0; i < cols.length; i++) {
    const o = oldCells[i] ?? "NULL";
    const n = newCells[i] ?? "NULL";
    if (o === n) continue;
    out.push({ column: cols[i], oldValue: o, newValue: n });
  }
  return out;
}

const ident = (s: string) => "`" + s.replace(/`/g, "``") + "`";
const trunc = (s: string, max: number) =>
  s.length > max ? s.slice(0, max - 1) + "…" : s;

function pkLabel(pkColumns: string[], pkValues: string[]): string {
  if (pkColumns.length === 0) return "(no pk)";
  return pkColumns.map((c, i) => `${c}=${pkValues[i] ?? ""}`).join(", ");
}

function previewLine(
  t: TableDiff,
  c: RowChange,
  kind: "insert" | "delete"
): string {
  if (kind === "delete" && c.oldRow) {
    const cols = c.oldRow.columns.length ? c.oldRow.columns : t.columns;
    const colList = cols.map(ident).join(",");
    return `INSERT IGNORE INTO ${ident(t.table)} (${colList}) VALUES (${c.oldRow.values});`;
  }

  if (kind === "insert" && c.newRow) {
    const cols = c.newRow.columns.length ? c.newRow.columns : t.columns;
    const cells = splitTupleValues(c.newRow.values);
    const idCols: string[] = [];
    for (let i = 0; i < cols.length && idCols.length < 3; i++) {
      if (t.pkColumns.includes(cols[i])) continue;
      const v = cells[i] ?? "";
      if (v === "NULL" || v === "") continue;
      idCols.push(`${cols[i]}=${trunc(v, 30)}`);
    }
    const label = pkLabel(t.pkColumns, c.pkValues);
    return idCols.length > 0 ? `${label} · ${idCols.join(", ")}` : label;
  }

  return "";
}
