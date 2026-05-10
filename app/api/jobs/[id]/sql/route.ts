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
  if (tables.length === 0) {
    return Response.json({ error: "Select at least one table" }, { status: 400 });
  }

  const sql = writeSyncSql(job.summary, { tables: new Set(tables) });

  return new Response(sql, {
    status: 200,
    headers: {
      "Content-Type": "application/sql; charset=utf-8",
      "Content-Disposition": `attachment; filename="sync-${id.slice(0, 8)}.sql"`,
    },
  });
}
