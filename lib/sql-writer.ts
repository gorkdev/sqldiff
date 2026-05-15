import type { DiffSummary, RowChange, TableDiff } from "./types";
import { splitTupleValues } from "./parser";

export type WriteOptions = {
  tables: Set<string>;
  updateOverrides?: Map<string, Map<string, Set<string>>>;
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
  const hasAnyRevert = Array.from(overrides.values()).some(
    (m) => nonEmptyRows(m) > 0
  );

  const lines: string[] = [];
  const tables = summary.tables.filter((t) => {
    if (!opts.tables.has(t.table)) return false;
    const hasMissing = t.deletes.length > 0;
    const hasReverts = nonEmptyRows(overrides.get(t.table)) > 0;
    return hasMissing || hasReverts;
  });

  lines.push(`-- sqldiff sync · ${summary.generatedAt}`);
  lines.push(
    `-- mode: missing-only${hasAnyRevert ? " + manual reverts" : ""}`
  );
  lines.push(`-- source: ${summary.oldFileName} (${formatBytes(summary.oldFileSize)})`);
  lines.push(`-- target: ${summary.newFileName} (${formatBytes(summary.newFileSize)})`);
  lines.push(`-- tables included: ${tables.map((t) => t.table).join(", ") || "(none)"}`);
  lines.push("");
  lines.push("SET NAMES utf8mb4;");
  lines.push("SET @OLD_SQL_MODE = @@SQL_MODE;");
  lines.push("SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';");
  lines.push("SET FOREIGN_KEY_CHECKS = 0;");
  lines.push("START TRANSACTION;");
  lines.push("");

  for (const table of tables) {
    const reverts = overrides.get(table.table);
    const revertRowCount = nonEmptyRows(reverts);
    const missingCount = table.deletes.length;

    lines.push(
      `-- ${table.table}: ${missingCount} missing` +
        (revertRowCount > 0 ? `, ${revertRowCount} reverted to OLD` : "")
    );

    if (table.pkColumns.length === 0 && missingCount > 0) {
      lines.push(
        `-- WARNING: no primary key detected for \`${table.table}\` — INSERT IGNORE cannot de-duplicate against the target.`
      );
    }

    for (const statement of batchedInserts(table, maxRows, maxBytes)) {
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
  maxBytes: number
): Generator<string> {
  if (table.deletes.length === 0) return;

  const firstRow = table.deletes[0].oldRow;
  if (!firstRow) throw new Error(`missing oldRow in delete change for ${table.table}`);
  const cols = firstRow.columns.length ? firstRow.columns : table.columns;
  const colList = cols.map(quoteIdent).join(",");
  const prefix = `INSERT IGNORE INTO ${quoteIdent(table.table)} (${colList}) VALUES `;
  const suffix = ";";
  const overhead = prefix.length + suffix.length;

  let tuples: string[] = [];
  let bytes = overhead;

  for (const change of table.deletes) {
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
