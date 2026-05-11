"use client";

import { useLocale } from "@/lib/i18n";

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

// Semantic mapping for the new "missing-only" mode:
//   - deletes  = rows in OLD but not in NEW  → "missing" (will be emitted)
//   - inserts  = rows in NEW but not in OLD  → "extra"   (ignored)
//   - updates  = rows in both, content differs → "changed" (ignored)
export function DiffRow({
  table,
  selected,
  expanded,
  onToggleSelect,
  onToggleExpand,
}: Props) {
  const { t } = useLocale();
  const missing = table.deleteCount;
  const extra = table.insertCount;
  const changed = table.updateCount;
  const hasAnyDiff = missing + extra + changed > 0;
  const actionable = missing > 0;
  const noPk = table.pkColumns.length === 0;

  return (
    <li className="border-b border-zinc-100 last:border-b-0">
      <div className="flex items-center gap-3 py-3 px-4 hover:bg-zinc-50 transition-colors">
        <input
          type="checkbox"
          checked={selected}
          disabled={!actionable}
          onChange={onToggleSelect}
          className="h-4 w-4 accent-emerald-600 disabled:opacity-30"
          aria-label={`Select ${table.table}`}
        />

        <button
          type="button"
          onClick={hasAnyDiff ? onToggleExpand : undefined}
          className={`
            flex-1 flex items-center gap-4 text-left
            ${hasAnyDiff ? "cursor-pointer" : "cursor-default"}
          `}
        >
          <span className="font-mono text-sm text-zinc-900 min-w-0 truncate">
            {table.table}
          </span>

          {noPk && actionable && (
            <span
              title={t("noPkTip")}
              className="text-[10px] uppercase tracking-wider text-amber-600"
            >
              {t("noPk")}
            </span>
          )}

          <span className="ml-auto flex items-center gap-3 font-mono text-xs">
            {hasAnyDiff ? (
              <>
                <span
                  className={missing > 0 ? "text-emerald-600 font-medium" : "text-zinc-300"}
                  title={t("catMissing")}
                >
                  ↓{missing}
                </span>
                <span
                  className={changed > 0 ? "text-amber-600" : "text-zinc-300"}
                  title={t("catChanged")}
                >
                  ~{changed}
                </span>
                <span
                  className={extra > 0 ? "text-zinc-500" : "text-zinc-300"}
                  title={t("catExtra")}
                >
                  +{extra}
                </span>
              </>
            ) : (
              <span className="text-zinc-400">{t("noChanges")}</span>
            )}
            {hasAnyDiff && (
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

      {expanded && hasAnyDiff && (
        <div className="bg-zinc-50/70 border-t border-zinc-100 px-4 py-3 space-y-3">
          {renderSection(
            t("catMissing"),
            t("missingHelp"),
            table.samples.deletes,
            missing,
            "text-emerald-600",
            t("more")
          )}
          {renderSection(
            t("catChanged"),
            t("changedHelp"),
            table.samples.updates,
            changed,
            "text-amber-600",
            t("more")
          )}
          {renderSection(
            t("catExtra"),
            t("extraHelp"),
            table.samples.inserts,
            extra,
            "text-zinc-500",
            t("more")
          )}
        </div>
      )}
    </li>
  );
}

function renderSection(
  label: string,
  help: string,
  samples: SamplePreview[],
  total: number,
  accentClass: string,
  moreWord: string
) {
  if (total === 0) return null;
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className={`text-[10px] uppercase tracking-wider ${accentClass}`}>
          {label} ({total})
        </span>
        <span className="text-[10px] text-zinc-400">{help}</span>
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
          <div className="text-zinc-400">… +{total - samples.length} {moreWord}</div>
        )}
      </div>
    </div>
  );
}

