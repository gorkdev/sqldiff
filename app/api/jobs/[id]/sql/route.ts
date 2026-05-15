import { NextRequest } from "next/server";
import { getJob } from "@/lib/job-store";
import { writeSyncSql } from "@/lib/sql-writer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const job = getJob(id);
  if (!job) return Response.json({ error: "Not found" }, { status: 404 });
  if (job.status !== "done" || !job.summary) {
    return Response.json({ error: "Job not finished" }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  const tables: string[] = Array.isArray(body?.tables) ? body.tables : [];
  const drops: string[] = Array.isArray(body?.dropTables) ? body.dropTables : [];
  const rawOverrides: unknown = body?.updateOverrides;
  const updateOverrides = parseUpdateOverrides(rawOverrides);
  const excludeMissing = parseExclude(body?.excludeMissing);
  const hasReverts = Array.from(updateOverrides.values()).some(
    (rows) => Array.from(rows.values()).some((s) => s.size > 0)
  );

  if (tables.length === 0 && drops.length === 0 && !hasReverts) {
    return Response.json({ error: "Select at least one table" }, { status: 400 });
  }

  const sql = writeSyncSql(job.summary, {
    tables: new Set(tables),
    dropTables: new Set(drops),
    updateOverrides,
    excludeMissing,
  });

  return new Response(sql, {
    status: 200,
    headers: {
      "Content-Type": "application/sql; charset=utf-8",
      "Content-Disposition": `attachment; filename="sync-${id.slice(0, 8)}.sql"`,
    },
  });
}

function parseExclude(raw: unknown): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  if (!raw || typeof raw !== "object") return out;
  for (const [table, keys] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(keys)) continue;
    const set = new Set<string>();
    for (const k of keys) if (typeof k === "string") set.add(k);
    if (set.size > 0) out.set(table, set);
  }
  return out;
}

function parseUpdateOverrides(
  raw: unknown
): Map<string, Map<string, Set<string>>> {
  const out = new Map<string, Map<string, Set<string>>>();
  if (!raw || typeof raw !== "object") return out;
  for (const [table, rows] of Object.entries(raw as Record<string, unknown>)) {
    if (!rows || typeof rows !== "object") continue;
    const rowMap = new Map<string, Set<string>>();
    for (const [pk, cols] of Object.entries(rows as Record<string, unknown>)) {
      if (!Array.isArray(cols)) continue;
      const set = new Set<string>();
      for (const c of cols) if (typeof c === "string") set.add(c);
      if (set.size > 0) rowMap.set(pk, set);
    }
    if (rowMap.size > 0) out.set(table, rowMap);
  }
  return out;
}
