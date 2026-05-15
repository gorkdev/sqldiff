"use client";

import { useState } from "react";
import { useLocale } from "@/lib/i18n";

const DEFAULT_VISIBLE = 5;

export type CellDiff = {
  column: string;
  oldValue: string;
  newValue: string;
};

export type SamplePreview = {
  kind: "insert" | "update" | "delete";
  pkValues: string[];
  preview: string;
  cellDiffs?: CellDiff[];
};

export type TableStatus = "common" | "old-only" | "new-only";

export type SerializedTable = {
  table: string;
  columns: string[];
  pkColumns: string[];
  status: TableStatus;
  createSql?: string;
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
  cellReverts: Map<string, Set<string>>;
  missingExcluded: Set<string>;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onToggleCell: (pkKey: string, column: string) => void;
  onToggleMissingRow: (pkKey: string) => void;
};

const pkKey = (pkValues: string[]): string => JSON.stringify(pkValues);

export function DiffRow({
  table,
  selected,
  expanded,
  cellReverts,
  missingExcluded,
  onToggleSelect,
  onToggleExpand,
  onToggleCell,
  onToggleMissingRow,
}: Props) {
  const { t } = useLocale();
  const missing = table.deleteCount;
  const extra = table.insertCount;
  const changed = table.updateCount;

  let revertedRows = 0;
  let revertedCells = 0;
  for (const cols of cellReverts.values()) {
    if (cols.size > 0) {
      revertedRows++;
      revertedCells += cols.size;
    }
  }

  const hasAnyDiff = missing + extra + changed > 0;
  const isOldOnly = table.status === "old-only";
  const isNewOnly = table.status === "new-only";
  const actionable =
    isOldOnly || isNewOnly || missing > 0 || revertedRows > 0;
  const noPk = table.pkColumns.length === 0;

  return (
    <li className="border-b border-zinc-100 last:border-b-0">
      <div className="flex items-center gap-3 py-3 px-4 hover:bg-zinc-50 transition-colors">
        <input
          type="checkbox"
          checked={selected && actionable}
          disabled={!actionable}
          onChange={onToggleSelect}
          title={
            isOldOnly
              ? t("tableOldOnlyTip")
              : isNewOnly
              ? t("tableNewOnlyTip")
              : undefined
          }
          className={`h-4 w-4 disabled:opacity-30 ${
            isNewOnly ? "accent-rose-600" : "accent-emerald-600"
          }`}
          aria-label={`Select ${table.table}`}
        />

        <button
          type="button"
          onClick={hasAnyDiff ? onToggleExpand : undefined}
          className={`flex-1 flex items-center gap-4 text-left ${
            hasAnyDiff ? "cursor-pointer" : "cursor-default"
          }`}
        >
          <span className="font-mono text-sm text-zinc-900 min-w-0 truncate">
            {table.table}
          </span>

          {isOldOnly && (
            <span
              title={t("tableOldOnlyTip")}
              className="text-[10px] uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5"
            >
              {t("tableOldOnlyBadge")} ·{" "}
              {missing > 0 ? t("tableOldOnlyAction") : t("tableOldOnlySchemaOnly")}
            </span>
          )}
          {isNewOnly && (
            <span
              title={t("tableNewOnlyTip")}
              className="text-[10px] uppercase tracking-wider text-rose-700 bg-rose-50 border border-rose-200 rounded px-1.5 py-0.5"
            >
              {t("tableNewOnlyBadge")} · {t("tableNewOnlyAction")}
            </span>
          )}

          {noPk && missing > 0 && !isOldOnly && (
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
                  title={t("catMissingTip")}
                >
                  ↓{missing}
                </span>
                <span
                  className={
                    revertedCells > 0
                      ? "text-amber-700 font-medium"
                      : changed > 0
                      ? "text-amber-600"
                      : "text-zinc-300"
                  }
                  title={t("catChangedTip")}
                >
                  ~{changed}
                  {revertedCells > 0 && <span>·{revertedCells}↺</span>}
                </span>
                <span
                  className={extra > 0 ? "text-zinc-500" : "text-zinc-300"}
                  title={t("catExtraTip")}
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
                className={`text-zinc-400 transition-transform ${
                  expanded ? "rotate-90" : ""
                }`}
              >
                ›
              </span>
            )}
          </span>
        </button>
      </div>

      {expanded && hasAnyDiff && (
        <div className="bg-zinc-50/70 border-t border-zinc-100 px-4 py-3 space-y-4">
          {missing > 0 && (
            <MissingSection
              label={t("catMissing")}
              help={t("missingHelp")}
              samples={table.samples.deletes}
              total={missing}
              moreWord={t("more")}
              showAllLabel={t("showAll")}
              showLessLabel={t("showLess")}
              missingExcluded={missingExcluded}
              onToggleRow={onToggleMissingRow}
            />
          )}
          {changed > 0 && (
            <ChangedSection
              label={t("catChanged")}
              total={changed}
              revertedCells={revertedCells}
              revertedSuffix={t("revertedSuffix")}
              revertNoPkTip={t("revertNoPkTip")}
              pickOld={t("pickOld")}
              pickNew={t("pickNew")}
              showAllLabel={t("showAll")}
              showLessLabel={t("showLess")}
              moreWord={t("more")}
              samples={table.samples.updates}
              cellReverts={cellReverts}
              onToggleCell={onToggleCell}
              noPk={noPk}
            />
          )}
          {extra > 0 && (
            <PreviewSection
              label={t("catExtra")}
              help=""
              accent="text-zinc-500"
              samples={table.samples.inserts}
              total={extra}
              moreWord={t("more")}
              showAllLabel={t("showAll")}
              showLessLabel={t("showLess")}
            />
          )}
        </div>
      )}
    </li>
  );
}

function MissingSection({
  label,
  help,
  samples,
  total,
  moreWord,
  showAllLabel,
  showLessLabel,
  missingExcluded,
  onToggleRow,
}: {
  label: string;
  help: string;
  samples: SamplePreview[];
  total: number;
  moreWord: string;
  showAllLabel: string;
  showLessLabel: string;
  missingExcluded: Set<string>;
  onToggleRow: (pkKey: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? samples : samples.slice(0, DEFAULT_VISIBLE);
  const hidden = samples.length - visible.length;
  const includedCount = Math.max(0, total - missingExcluded.size);
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-[10px] uppercase tracking-wider text-emerald-600">
          {label} ({includedCount}/{total})
        </span>
        <span className="text-[10px] text-zinc-400">{help}</span>
      </div>
      <div className="font-mono text-xs text-zinc-700 space-y-1 leading-relaxed">
        {visible.map((s, i) => {
          const key = pkKey(s.pkValues);
          const included = !missingExcluded.has(key);
          return (
            <label
              key={i}
              className={`
                flex items-start gap-2 rounded border px-2.5 py-1.5
                whitespace-pre-wrap break-all cursor-pointer
                ${included ? "border-zinc-200 bg-white" : "border-zinc-200 bg-zinc-100 opacity-60"}
              `}
            >
              <input
                type="checkbox"
                checked={included}
                onChange={() => onToggleRow(key)}
                className="mt-0.5 h-3.5 w-3.5 accent-emerald-600 shrink-0"
              />
              <span className="min-w-0 flex-1">{s.preview}</span>
            </label>
          );
        })}
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="text-left text-zinc-500 hover:text-zinc-900 underline decoration-dotted"
          >
            … +{hidden} {moreWord} · {showAllLabel}
          </button>
        )}
        {showAll && samples.length > DEFAULT_VISIBLE && (
          <button
            type="button"
            onClick={() => setShowAll(false)}
            className="text-left text-zinc-500 hover:text-zinc-900 underline decoration-dotted"
          >
            ↑ {showLessLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function PreviewSection({
  label,
  help,
  accent,
  samples,
  total,
  moreWord,
  showAllLabel,
  showLessLabel,
}: {
  label: string;
  help: string;
  accent: string;
  samples: SamplePreview[];
  total: number;
  moreWord: string;
  showAllLabel: string;
  showLessLabel: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? samples : samples.slice(0, DEFAULT_VISIBLE);
  const hidden = samples.length - visible.length;
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className={`text-[10px] uppercase tracking-wider ${accent}`}>
          {label} ({total})
        </span>
        {help && <span className="text-[10px] text-zinc-400">{help}</span>}
      </div>
      <div className="font-mono text-xs text-zinc-700 space-y-1 leading-relaxed">
        {visible.map((s, i) => (
          <div
            key={i}
            className="rounded border border-zinc-200 bg-white px-2.5 py-1.5 whitespace-pre-wrap break-all"
          >
            {s.preview}
          </div>
        ))}
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="text-left text-zinc-500 hover:text-zinc-900 underline decoration-dotted"
          >
            … +{hidden} {moreWord} · {showAllLabel}
          </button>
        )}
        {showAll && samples.length > DEFAULT_VISIBLE && (
          <button
            type="button"
            onClick={() => setShowAll(false)}
            className="text-left text-zinc-500 hover:text-zinc-900 underline decoration-dotted"
          >
            ↑ {showLessLabel}
          </button>
        )}
        {total > samples.length && (
          <div className="text-zinc-400">
            … +{total - samples.length} {moreWord} (not loaded)
          </div>
        )}
      </div>
    </div>
  );
}

function ChangedSection({
  label,
  total,
  revertedCells,
  revertedSuffix,
  revertNoPkTip,
  pickOld,
  pickNew,
  showAllLabel,
  showLessLabel,
  moreWord,
  samples,
  cellReverts,
  onToggleCell,
  noPk,
}: {
  label: string;
  total: number;
  revertedCells: number;
  revertedSuffix: string;
  revertNoPkTip: string;
  pickOld: string;
  pickNew: string;
  showAllLabel: string;
  showLessLabel: string;
  moreWord: string;
  samples: SamplePreview[];
  cellReverts: Map<string, Set<string>>;
  onToggleCell: (pkKey: string, column: string) => void;
  noPk: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? samples : samples.slice(0, DEFAULT_VISIBLE);
  const hidden = samples.length - visible.length;
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-[10px] uppercase tracking-wider text-amber-600">
          {label} ({total})
        </span>
        {revertedCells > 0 && (
          <span className="text-[10px] text-amber-700 font-medium">
            · {revertedCells} {revertedSuffix}
          </span>
        )}
        {noPk && (
          <span className="text-[10px] text-zinc-400">· {revertNoPkTip}</span>
        )}
      </div>
      <div className="space-y-2.5">
        {visible.map((s, i) => {
          const key = pkKey(s.pkValues);
          const reverted = cellReverts.get(key) ?? new Set<string>();
          return (
            <ChangedRow
              key={i}
              sample={s}
              reverted={reverted}
              onPickOld={(col) => !noPk && onToggleCell(key, col)}
              onPickNew={(col) => reverted.has(col) && onToggleCell(key, col)}
              pickOld={pickOld}
              pickNew={pickNew}
              disabled={noPk}
            />
          );
        })}
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="text-left text-[11px] text-zinc-500 hover:text-zinc-900 underline decoration-dotted font-mono"
          >
            … +{hidden} {moreWord} · {showAllLabel}
          </button>
        )}
        {showAll && samples.length > DEFAULT_VISIBLE && (
          <button
            type="button"
            onClick={() => setShowAll(false)}
            className="text-left text-[11px] text-zinc-500 hover:text-zinc-900 underline decoration-dotted font-mono"
          >
            ↑ {showLessLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function ChangedRow({
  sample,
  reverted,
  onPickOld,
  onPickNew,
  pickOld,
  pickNew,
  disabled,
}: {
  sample: SamplePreview;
  reverted: Set<string>;
  onPickOld: (col: string) => void;
  onPickNew: (col: string) => void;
  pickOld: string;
  pickNew: string;
  disabled: boolean;
}) {
  const cells = sample.cellDiffs ?? [];
  return (
    <div className="rounded border border-zinc-200 bg-white px-3 py-2">
      <div className="font-mono text-[11px] text-zinc-500 mb-1.5">
        {sample.preview}
      </div>
      <div className="space-y-1">
        {cells.map((c) => {
          const isOld = reverted.has(c.column);
          return (
            <div
              key={c.column}
              className="grid grid-cols-[10rem_1fr_1fr] gap-2 items-stretch text-xs"
            >
              <span className="font-mono text-zinc-600 self-center truncate" title={c.column}>
                {c.column}
              </span>
              <ValueCell
                role="old"
                label={pickOld}
                value={c.oldValue}
                selected={isOld}
                disabled={disabled}
                onClick={() => onPickOld(c.column)}
              />
              <ValueCell
                role="new"
                label={pickNew}
                value={c.newValue}
                selected={!isOld}
                disabled={disabled}
                onClick={() => onPickNew(c.column)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ValueCell({
  role,
  label,
  value,
  selected,
  disabled,
  onClick,
}: {
  role: "old" | "new";
  label: string;
  value: string;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const accent =
    role === "old"
      ? selected
        ? "border-amber-400 bg-amber-50 text-amber-900"
        : "border-zinc-200 bg-white text-zinc-500 hover:border-amber-200"
      : selected
      ? "border-emerald-400 bg-emerald-50 text-emerald-900"
      : "border-zinc-200 bg-white text-zinc-500 hover:border-emerald-200";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      title={value}
      className={`
        flex items-baseline gap-2 rounded border px-2 py-1 text-left
        whitespace-pre-wrap break-all
        ${accent}
        ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
      `}
    >
      <span className="text-[9px] uppercase tracking-wider opacity-70 shrink-0">
        {label}
      </span>
      <span className="min-w-0 flex-1 font-mono">{value}</span>
    </button>
  );
}
