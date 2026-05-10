"use client";

import { useMemo, useState } from "react";
import { DiffRow, type SerializedTable } from "./DiffRow";

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
  const tablesWithChanges = useMemo(
    () =>
      summary.tables.filter(
        (t) => t.insertCount + t.updateCount + t.deleteCount > 0
      ),
    [summary.tables]
  );

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(tablesWithChanges.map((t) => t.table))
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);

  const totalChanges = useMemo(
    () =>
      summary.tables.reduce(
        (sum, t) => sum + t.insertCount + t.updateCount + t.deleteCount,
        0
      ),
    [summary.tables]
  );

  const selectedStmtCount = useMemo(() => {
    let n = 0;
    for (const t of summary.tables) {
      if (!selected.has(t.table)) continue;
      n += t.insertCount + t.updateCount * 2 + t.deleteCount;
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
    setSelected(new Set(tablesWithChanges.map((t) => t.table)));
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
        alert(err.error ?? "Download failed");
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
            {summary.tables.length} tables
          </span>{" "}
          · {totalChanges} change{totalChanges === 1 ? "" : "s"}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={selectAll}
            className="text-zinc-500 hover:text-zinc-900 transition-colors"
          >
            select all
          </button>
          <span className="text-zinc-300">·</span>
          <button
            type="button"
            onClick={clearAll}
            className="text-zinc-500 hover:text-zinc-900 transition-colors"
          >
            clear
          </button>
        </div>
      </header>

      <ul>
        {summary.tables.map((t) => (
          <DiffRow
            key={t.table}
            table={t}
            selected={selected.has(t.table)}
            expanded={expanded.has(t.table)}
            onToggleSelect={() => toggleSelect(t.table)}
            onToggleExpand={() => toggleExpand(t.table)}
          />
        ))}
      </ul>

      <footer className="flex items-center justify-between gap-4 px-4 py-3 border-t border-zinc-100 bg-zinc-50/60 text-xs">
        <div className="text-zinc-500">
          {selected.size} selected · {selectedStmtCount} statement
          {selectedStmtCount === 1 ? "" : "s"}
        </div>
        <button
          type="button"
          onClick={download}
          disabled={selected.size === 0 || downloading}
          className="
            inline-flex items-center gap-2 px-4 py-1.5 rounded-md
            bg-emerald-600 text-white font-medium text-xs
            hover:bg-emerald-500 transition-colors
            disabled:bg-zinc-200 disabled:text-zinc-400 disabled:cursor-not-allowed
          "
        >
          {downloading ? "preparing…" : "↓ sync.sql"}
        </button>
      </footer>
    </section>
  );
}
