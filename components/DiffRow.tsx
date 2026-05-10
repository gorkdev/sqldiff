"use client";

export type SamplePreview = {
  kind: "insert" | "update" | "delete";
  pkValues: string[];
  preview: string;
};

export type SerializedTable = {
  table: string;
  columns: string[];
  pkColumns: string[];
  insertCount: number;
  updateCount: number;
  deleteCount: number;
  samples: {
    inserts: SamplePreview[];
    updates: SamplePreview[];
    deletes: SamplePreview[];
  };
};

type Props = {
  table: SerializedTable;
  selected: boolean;
  expanded: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
};

export function DiffRow({
  table,
  selected,
  expanded,
  onToggleSelect,
  onToggleExpand,
}: Props) {
  const totalChanges = table.insertCount + table.updateCount + table.deleteCount;
  const hasChanges = totalChanges > 0;
  const noPk = table.pkColumns.length === 0;

  return (
    <li className="border-b border-zinc-100 last:border-b-0">
      <div className="flex items-center gap-3 py-3 px-4 hover:bg-zinc-50 transition-colors">
        <input
          type="checkbox"
          checked={selected}
          disabled={!hasChanges}
          onChange={onToggleSelect}
          className="h-4 w-4 accent-emerald-600 disabled:opacity-30"
          aria-label={`Select ${table.table}`}
        />

        <button
          type="button"
          onClick={hasChanges ? onToggleExpand : undefined}
          className={`
            flex-1 flex items-center gap-4 text-left
            ${hasChanges ? "cursor-pointer" : "cursor-default"}
          `}
        >
          <span className="font-mono text-sm text-zinc-900 min-w-0 truncate">
            {table.table}
          </span>

          {noPk && hasChanges && (
            <span
              title="No primary key — DELETE/UPDATE may match unintended rows"
              className="text-[10px] uppercase tracking-wider text-amber-600"
            >
              no pk
            </span>
          )}

          <span className="ml-auto flex items-center gap-3 font-mono text-xs">
            {hasChanges ? (
              <>
                <span className="text-emerald-600">+{table.insertCount}</span>
                <span className="text-amber-600">~{table.updateCount}</span>
                <span className="text-rose-600">−{table.deleteCount}</span>
              </>
            ) : (
              <span className="text-zinc-400">no changes</span>
            )}
            {hasChanges && (
              <span
                aria-hidden
                className={`text-zinc-400 transition-transform ${expanded ? "rotate-90" : ""}`}
              >
                ›
              </span>
            )}
          </span>
        </button>
      </div>

      {expanded && hasChanges && (
        <div className="bg-zinc-50/70 border-t border-zinc-100 px-4 py-3 space-y-3">
          {renderSection(
            "inserts",
            table.samples.inserts,
            table.insertCount,
            "text-emerald-600"
          )}
          {renderSection(
            "updates",
            table.samples.updates,
            table.updateCount,
            "text-amber-600"
          )}
          {renderSection(
            "deletes",
            table.samples.deletes,
            table.deleteCount,
            "text-rose-600"
          )}
        </div>
      )}
    </li>
  );
}

function renderSection(
  label: string,
  samples: SamplePreview[],
  total: number,
  accentClass: string
) {
  if (total === 0) return null;
  return (
    <div>
      <div
        className={`text-[10px] uppercase tracking-wider mb-1.5 ${accentClass}`}
      >
        {label} ({total})
      </div>
      <div className="font-mono text-xs text-zinc-700 space-y-1.5 leading-relaxed">
        {samples.map((s, i) => (
          <div
            key={i}
            className="rounded border border-zinc-200 bg-white px-2.5 py-1.5 whitespace-pre-wrap break-all"
          >
            {s.preview}
          </div>
        ))}
        {total > samples.length && (
          <div className="text-zinc-400">… +{total - samples.length} more</div>
        )}
      </div>
    </div>
  );
}
