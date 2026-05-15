import type { DiffSummary, RowChange, TableDiff } from "./types";
import { splitTupleValues } from "./parser";

export type WriteOptions = {
  tables: Set<string>;
  dropTables?: Set<string>;
  updateOverrides?: Map<string, Map<string, Set<string>>>;
  excludeMissing?: Map<string, Set<string>>;
  maxRowsPerInsert?: number;
  maxBytesPerInsert?: number;
};

const DEFAULT_MAX_ROWS_PER_INSERT = 100;
const DEFAULT_MAX_BYTES_PER_INSERT = 256 * 1024;

export const pkKey = (pkValues: string[]): string => JSON.stringify(pkValues);

function nonEmptyRows(m: Map<string, Set<string>> | undefined): number {
  if (!m) return 0;
  let n = 0;
  for (const s of m.values()) if (s.size > 0) n++;
  return n;
}

export function writeSyncSql(summary: DiffSummary, opts: WriteOptions): string {
  const maxRows = opts.maxRowsPerInsert ?? DEFAULT_MAX_ROWS_PER_INSERT;
  const maxBytes = opts.maxBytesPerInsert ?? DEFAULT_MAX_BYTES_PER_INSERT;
  const overrides =
    opts.updateOverrides ?? new Map<string, Map<string, Set<string>>>();
  const dropTables = opts.dropTables ?? new Set<string>();
  const excludeMissing =
    opts.excludeMissing ?? new Map<string, Set<string>>();

  const effectiveMissingCount = (t: TableDiff): number => {
    const excl = excludeMissing.get(t.table);
    if (!excl || excl.size === 0) return t.deletes.length;
    let n = 0;
    for (const change of t.deletes) {
      if (!excl.has(pkKey(change.pkValues))) n++;
    }
    return n;
  };
  const hasAnyRevert = Array.from(overrides.values()).some(
    (m) => nonEmptyRows(m) > 0
  );

  // DDL section (DROP for new-only, DROP+CREATE for old-only)
  const oldOnlyTables = summary.tables.filter(
    (t) => t.status === "old-only" && opts.tables.has(t.table)
  );
  const newOnlyDrops = summary.tables.filter(
    (t) => t.status === "new-only" && dropTables.has(t.table)
  );
  const hasDdl = oldOnlyTables.length > 0 || newOnlyDrops.length > 0;

  // DML tables: common + old-only that are selected, with at least one effective
  // missing row (after applying excludeMissing) or any selected revert.
  const dmlTables = summary.tables.filter((t) => {
    if (t.status === "new-only") return false;
    if (!opts.tables.has(t.table)) return false;
    const hasMissing = effectiveMissingCount(t) > 0;
    const hasReverts = nonEmptyRows(overrides.get(t.table)) > 0;
    return hasMissing || hasReverts;
  });

  const modeParts = ["missing-only"];
  if (hasAnyRevert) modeParts.push("manual reverts");
  if (hasDdl) modeParts.push("DDL");

  const lines: string[] = [];
  lines.push(`-- sqldiff sync · ${summary.generatedAt}`);
  lines.push(`-- mode: ${modeParts.join(" + ")}`);
  lines.push(`-- source: ${summary.oldFileName} (${formatBytes(summary.oldFileSize)})`);
  lines.push(`-- target: ${summary.newFileName} (${formatBytes(summary.newFileSize)})`);
  lines.push(
    `-- tables included: ${dmlTables.map((t) => t.table).join(", ") || "(none)"}`
  );
  if (oldOnlyTables.length > 0) {
    lines.push(
      `-- DDL create: ${oldOnlyTables.map((t) => t.table).join(", ")}`
    );
  }
  if (newOnlyDrops.length > 0) {
    lines.push(
      `-- DDL drop: ${newOnlyDrops.map((t) => t.table).join(", ")}`
    );
  }
  lines.push("");
  lines.push("SET NAMES utf8mb4;");
  lines.push("SET @OLD_SQL_MODE = @@SQL_MODE;");
  lines.push("SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';");
  lines.push("SET FOREIGN_KEY_CHECKS = 0;");

  if (hasDdl) {
    lines.push("");
    lines.push("-- DDL (auto-commits per statement, kept outside transaction)");
    for (const t of newOnlyDrops) {
      lines.push(`DROP TABLE IF EXISTS ${quoteIdent(t.table)};`);
    }
    for (const t of oldOnlyTables) {
      lines.push(`DROP TABLE IF EXISTS ${quoteIdent(t.table)};`);
      if (t.createSql && t.createSql.trim().length > 0) {
        const ddl = t.createSql.trim();
        lines.push(ddl.endsWith(";") ? ddl : ddl + ";");
      } else {
        lines.push(
          `-- WARNING: missing CREATE TABLE source for \`${t.table}\`; cannot recreate.`
        );
      }
    }
    lines.push("");
  }

  lines.push("START TRANSACTION;");
  lines.push("");

  for (const table of dmlTables) {
    const reverts = overrides.get(table.table);
    const revertRowCount = nonEmptyRows(reverts);
    const excluded = excludeMissing.get(table.table);
    const emittedMissing = effectiveMissingCount(table);
    const totalMissing = table.deletes.length;
    const missingLabel =
      excluded && excluded.size > 0
        ? `${emittedMissing} of ${totalMissing} missing`
        : `${totalMissing} missing`;

    lines.push(
      `-- ${table.table}: ${missingLabel}` +
        (revertRowCount > 0 ? `, ${revertRowCount} reverted to OLD` : "")
    );

    if (table.pkColumns.length === 0 && emittedMissing > 0) {
      lines.push(
        `-- WARNING: no primary key detected for \`${table.table}\` — INSERT IGNORE cannot de-duplicate against the target.`
      );
    }

    for (const statement of batchedInserts(table, maxRows, maxBytes, excluded)) {
      lines.push(statement);
    }

    if (reverts && reverts.size > 0) {
      for (const change of table.updates) {
        const cols = reverts.get(pkKey(change.pkValues));
        if (!cols || cols.size === 0) continue;
        const stmt = updateRevertSql(table, change, cols);
        if (stmt) lines.push(stmt);
      }
    }

    lines.push("");
  }

  lines.push("COMMIT;");
  lines.push("SET FOREIGN_KEY_CHECKS = 1;");
  lines.push("SET SQL_MODE = @OLD_SQL_MODE;");
  lines.push("");

  return lines.join("\n");
}

function updateRevertSql(
  table: TableDiff,
  change: RowChange,
  selectedCols: Set<string>
): string | null {
  if (table.pkColumns.length === 0) return null;
  if (!change.oldRow || !change.newRow) return null;

  const cols = change.newRow.columns.length ? change.newRow.columns : table.columns;
  const oldCells = splitTupleValues(change.oldRow.values);
  const newCells = splitTupleValues(change.newRow.values);

  const setPairs: string[] = [];
  for (let i = 0; i < cols.length; i++) {
    if (!selectedCols.has(cols[i])) continue;
    if (table.pkColumns.includes(cols[i])) continue;
    const oldVal = oldCells[i] || "NULL";
    const newVal = newCells[i] || "NULL";
    if (oldVal === newVal) continue;
    setPairs.push(`${quoteIdent(cols[i])}=${oldVal}`);
  }

  if (setPairs.length === 0) return null;

  const whereClause = table.pkColumns
    .map((col, i) => `${quoteIdent(col)}=${change.pkValues[i] ?? "NULL"}`)
    .join(" AND ");

  return `UPDATE ${quoteIdent(table.table)} SET ${setPairs.join(", ")} WHERE ${whereClause};`;
}

function* batchedInserts(
  table: TableDiff,
  maxRows: number,
  maxBytes: number,
  excluded?: Set<string>
): Generator<string> {
  if (table.deletes.length === 0) return;

  // Build the included list first; bail if everything is excluded.
  const included = excluded && excluded.size > 0
    ? table.deletes.filter((c) => !excluded.has(pkKey(c.pkValues)))
    : table.deletes;
  if (included.length === 0) return;

  const firstRow = included[0].oldRow;
  if (!firstRow) throw new Error(`missing oldRow in delete change for ${table.table}`);
  const cols = firstRow.columns.length ? firstRow.columns : table.columns;
  const colList = cols.map(quoteIdent).join(",");
  const prefix = `INSERT IGNORE INTO ${quoteIdent(table.table)} (${colList}) VALUES `;
  const suffix = ";";
  const overhead = prefix.length + suffix.length;

  let tuples: string[] = [];
  let bytes = overhead;

  for (const change of included) {
    const row = change.oldRow;
    if (!row) throw new Error(`missing oldRow in delete change for ${table.table}`);
    const tuple = `(${row.values})`;
    const sep = tuples.length > 0 ? 1 : 0;
    const addedBytes = tuple.length + sep;

    const wouldExceedBytes =
      tuples.length > 0 && bytes + addedBytes > maxBytes;
    const wouldExceedRows = tuples.length >= maxRows;

    if (wouldExceedBytes || wouldExceedRows) {
      yield prefix + tuples.join(",") + suffix;
      tuples = [];
      bytes = overhead;
    }

    tuples.push(tuple);
    bytes += tuples.length === 1 ? tuple.length : addedBytes;
  }

  if (tuples.length > 0) {
    yield prefix + tuples.join(",") + suffix;
  }
}

function quoteIdent(name: string): string {
  return "`" + name.replace(/`/g, "``") + "`";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
