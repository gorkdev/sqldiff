"use client";

import { useMemo, useState } from "react";
import { DiffRow, type SerializedTable } from "./DiffRow";
import { useLocale } from "@/lib/i18n";

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

  // Only "missing" rows (deleteCount = OLD-only) are emitted in missing-only mode.
  // Tables without any missing rows cannot be acted on.
  const actionableTables = useMemo(
    () => summary.tables.filter((t) => t.deleteCount > 0),
    [summary.tables]
  );

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(actionableTables.map((t) => t.table))
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);

  const totalMissing = useMemo(
    () => summary.tables.reduce((sum, t) => sum + t.deleteCount, 0),
    [summary.tables]
  );

  const selectedStmtCount = useMemo(() => {
    let n = 0;
    for (const tbl of summary.tables) {
      if (!selected.has(tbl.table)) continue;
      n += tbl.deleteCount;
    }
    return n;
  }, [selected, summary.tables]);

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

  const selectAll = () =>
    setSelected(new Set(actionableTables.map((t) => t.table)));
  const clearAll = () => setSelected(new Set());

  const download = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/sql`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tables: Array.from(selected) }),
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

      <div className="px-4 py-2 text-[11px] text-zinc-500 bg-zinc-50/60 border-b border-zinc-100">
        {t("note")}
      </div>

      <ul>
        {summary.tables.map((tbl) => (
          <DiffRow
            key={tbl.table}
            table={tbl}
            selected={selected.has(tbl.table)}
            expanded={expanded.has(tbl.table)}
            onToggleSelect={() => toggleSelect(tbl.table)}
            onToggleExpand={() => toggleExpand(tbl.table)}
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
