"use client";

import { useMemo, useState } from "react";
import { DiffRow, type SerializedTable } from "./DiffRow";
import { useLocale } from "@/lib/i18n";

const EMPTY_ROWS: Map<string, Set<string>> = new Map();
const EMPTY_SET: Set<string> = new Set();

export type DiffSummaryDto = {
  oldFileName: string;
  newFileName: string;
  oldFileSize: number;
  newFileSize: number;
  generatedAt: string;
  tables: SerializedTable[];
};

type Props = {
  jobId: string;
  summary: DiffSummaryDto;
};

export function DiffTableList({ jobId, summary }: Props) {
  const { t } = useLocale();

  const actionableTables = useMemo(
    () =>
      summary.tables.filter(
        (t) => t.deleteCount > 0 || t.status === "old-only"
      ),
    [summary.tables]
  );

  // Default-selected: common tables with missing rows, AND old-only tables (CREATE+import).
  // NEW-only tables are NOT selected by default (DROP is destructive).
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        summary.tables
          .filter(
            (t) =>
              t.status === "old-only" ||
              (t.status === "common" && t.deleteCount > 0)
          )
          .map((t) => t.table)
      )
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [cellReverts, setCellReverts] = useState<
    Map<string, Map<string, Set<string>>>
  >(new Map());
  const [missingExcluded, setMissingExcluded] = useState<
    Map<string, Set<string>>
  >(new Map());
  const [downloading, setDownloading] = useState(false);

  const totalMissing = useMemo(
    () => summary.tables.reduce((sum, t) => sum + t.deleteCount, 0),
    [summary.tables]
  );

  const selectedStmtCount = useMemo(() => {
    let n = 0;
    for (const tbl of summary.tables) {
      if (!selected.has(tbl.table)) continue;
      if (tbl.status === "new-only") {
        n += 1;
        continue;
      }
      const excluded = missingExcluded.get(tbl.table)?.size ?? 0;
      n += Math.max(0, tbl.deleteCount - excluded);
      if (tbl.status === "old-only") n += 1;
      const rows = cellReverts.get(tbl.table);
      if (rows) {
        for (const cols of rows.values()) if (cols.size > 0) n++;
      }
    }
    return n;
  }, [selected, cellReverts, missingExcluded, summary.tables]);

  const toggleSelect = (table: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(table)) next.delete(table);
      else next.add(table);
      return next;
    });
  };

  const toggleExpand = (table: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(table)) next.delete(table);
      else next.add(table);
      return next;
    });
  };

  const toggleMissingRow = (table: string, pk: string) => {
    setMissingExcluded((prev) => {
      const next = new Map(prev);
      const cur = new Set(next.get(table) ?? []);
      if (cur.has(pk)) cur.delete(pk);
      else cur.add(pk);
      if (cur.size === 0) next.delete(table);
      else next.set(table, cur);
      return next;
    });
  };

  const toggleCellRevert = (table: string, pk: string, col: string) => {
    setCellReverts((prev) => {
      const next = new Map(prev);
      const rows = new Map(next.get(table) ?? []);
      const cols = new Set(rows.get(pk) ?? []);
      if (cols.has(col)) cols.delete(col);
      else cols.add(col);
      if (cols.size === 0) rows.delete(pk);
      else rows.set(pk, cols);
      if (rows.size === 0) next.delete(table);
      else next.set(table, rows);
      return next;
    });
    setSelected((prev) => {
      if (prev.has(table)) return prev;
      const next = new Set(prev);
      next.add(table);
      return next;
    });
  };

  const selectAll = () =>
    setSelected(new Set(actionableTables.map((t) => t.table)));
  const clearAll = () => {
    setSelected(new Set());
    setCellReverts(new Map());
    setMissingExcluded(new Map());
  };

  const download = async () => {
    setDownloading(true);
    try {
      const overrides: Record<string, Record<string, string[]>> = {};
      for (const [table, rows] of cellReverts) {
        if (!selected.has(table)) continue;
        const tableObj: Record<string, string[]> = {};
        for (const [pk, cols] of rows) {
          if (cols.size > 0) tableObj[pk] = Array.from(cols);
        }
        if (Object.keys(tableObj).length > 0) overrides[table] = tableObj;
      }
      const sqlTables: string[] = [];
      const dropTables: string[] = [];
      for (const tbl of summary.tables) {
        if (!selected.has(tbl.table)) continue;
        if (tbl.status === "new-only") dropTables.push(tbl.table);
        else sqlTables.push(tbl.table);
      }
      const excludeMissing: Record<string, string[]> = {};
      for (const [table, keys] of missingExcluded) {
        if (!selected.has(table)) continue;
        if (keys.size > 0) excludeMissing[table] = Array.from(keys);
      }
      const res = await fetch(`/api/jobs/${jobId}/sql`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tables: sqlTables,
          dropTables,
          updateOverrides: overrides,
          excludeMissing,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error ?? t("error"));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sync-${jobId.slice(0, 8)}.sql`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section className="rounded-lg border border-zinc-200 bg-white overflow-hidden">
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-100 text-xs">
        <div className="text-zinc-500">
          <span className="text-zinc-900 font-medium">
            {summary.tables.length} {t("tablesWord")}
          </span>{" "}
          · {totalMissing} {t("missingTotal")}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={selectAll}
            className="text-zinc-500 hover:text-zinc-900 transition-colors"
          >
            {t("selectAll")}
          </button>
          <span className="text-zinc-300">·</span>
          <button
            type="button"
            onClick={clearAll}
            className="text-zinc-500 hover:text-zinc-900 transition-colors"
          >
            {t("clearOne")}
          </button>
        </div>
      </header>

      <ul>
        {summary.tables.map((tbl) => (
          <DiffRow
            key={tbl.table}
            table={tbl}
            selected={selected.has(tbl.table)}
            expanded={expanded.has(tbl.table)}
            cellReverts={cellReverts.get(tbl.table) ?? EMPTY_ROWS}
            missingExcluded={missingExcluded.get(tbl.table) ?? EMPTY_SET}
            onToggleSelect={() => toggleSelect(tbl.table)}
            onToggleExpand={() => toggleExpand(tbl.table)}
            onToggleCell={(pk, col) => toggleCellRevert(tbl.table, pk, col)}
            onToggleMissingRow={(pk) => toggleMissingRow(tbl.table, pk)}
          />
        ))}
      </ul>

      <footer className="flex items-center justify-between gap-4 px-4 py-3 border-t border-zinc-100 bg-zinc-50/60 text-xs">
        <div className="text-zinc-500">
          {selected.size} {t("selected")} · {selectedStmtCount}{" "}
          {selectedStmtCount === 1 ? t("statement") : t("statements")}
        </div>
        <button
          type="button"
          onClick={download}
          disabled={selected.size === 0 || selectedStmtCount === 0 || downloading}
          className="
            inline-flex items-center gap-2 px-4 py-1.5 rounded-md
            bg-emerald-600 text-white font-medium text-xs
            hover:bg-emerald-500 transition-colors
            disabled:bg-zinc-200 disabled:text-zinc-400 disabled:cursor-not-allowed
          "
        >
          {downloading ? t("preparing") : t("download")}
        </button>
      </footer>
    </section>
  );
}
