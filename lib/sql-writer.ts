import type { DiffSummary, RowChange, TableDiff } from "./types";

export type WriteOptions = {
  tables: Set<string>;
};

export function writeSyncSql(summary: DiffSummary, opts: WriteOptions): string {
  const lines: string[] = [];
  const tables = summary.tables.filter(
    (t) => opts.tables.has(t.table) && t.deletes.length > 0
  );

  lines.push(`-- sqldiff sync · ${summary.generatedAt}`);
  lines.push(`-- mode: missing-only`);
  lines.push(`-- source: ${summary.oldFileName} (${formatBytes(summary.oldFileSize)})`);
  lines.push(`-- target: ${summary.newFileName} (${formatBytes(summary.newFileSize)})`);
  lines.push(`-- tables included: ${tables.map((t) => t.table).join(", ") || "(none)"}`);
  lines.push("");
  lines.push("SET FOREIGN_KEY_CHECKS = 0;");
  lines.push("START TRANSACTION;");
  lines.push("");

  for (const table of tables) {
    lines.push(`-- ${table.table}: ${table.deletes.length} missing`);

    if (table.pkColumns.length === 0) {
      lines.push(
        `-- WARNING: no primary key detected for \`${table.table}\` — INSERT IGNORE cannot de-duplicate against the target.`
      );
    }

    for (const change of table.deletes) {
      lines.push(insertIgnoreSql(table, change));
    }
    lines.push("");
  }

  lines.push("COMMIT;");
  lines.push("SET FOREIGN_KEY_CHECKS = 1;");
  lines.push("");

  return lines.join("\n");
}

function insertIgnoreSql(table: TableDiff, change: RowChange): string {
  const row = change.oldRow;
  if (!row) throw new Error(`missing oldRow in delete change for ${table.table}`);
  const cols = row.columns.length ? row.columns : table.columns;
  const colList = cols.map(quoteIdent).join(",");
  return `INSERT IGNORE INTO ${quoteIdent(table.table)} (${colList}) VALUES (${row.values});`;
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
