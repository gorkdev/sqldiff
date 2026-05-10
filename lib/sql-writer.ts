import type { DiffSummary, RowChange, TableDiff } from "./types";

export type WriteOptions = {
  tables: Set<string>;
};

export function writeSyncSql(summary: DiffSummary, opts: WriteOptions): string {
  const lines: string[] = [];
  const tables = summary.tables.filter(
    (t) => opts.tables.has(t.table) && (t.inserts.length || t.updates.length || t.deletes.length)
  );

  lines.push(`-- sqldiff sync · ${summary.generatedAt}`);
  lines.push(`-- old: ${summary.oldFileName} (${formatBytes(summary.oldFileSize)})`);
  lines.push(`-- new: ${summary.newFileName} (${formatBytes(summary.newFileSize)})`);
  lines.push(`-- tables included: ${tables.map((t) => t.table).join(", ") || "(none)"}`);
  lines.push("");
  lines.push("SET FOREIGN_KEY_CHECKS = 0;");
  lines.push("START TRANSACTION;");
  lines.push("");

  for (const table of tables) {
    const counts = `+${table.inserts.length} ~${table.updates.length} −${table.deletes.length}`;
    lines.push(`-- ${table.table}: ${counts}`);

    if (table.pkColumns.length === 0) {
      lines.push(
        `-- WARNING: no primary key detected for \`${table.table}\` — UPDATE/DELETE statements may match unintended rows.`
      );
    }

    for (const change of table.deletes) {
      lines.push(deleteSql(table, change));
    }
    for (const change of table.updates) {
      lines.push(deleteSql(table, change));
      lines.push(insertSql(table, change));
    }
    for (const change of table.inserts) {
      lines.push(insertSql(table, change));
    }
    lines.push("");
  }

  lines.push("COMMIT;");
  lines.push("SET FOREIGN_KEY_CHECKS = 1;");
  lines.push("");

  return lines.join("\n");
}

function insertSql(table: TableDiff, change: RowChange): string {
  const row = change.newRow!;
  const cols = row.columns.map(quoteIdent).join(",");
  return `INSERT INTO ${quoteIdent(table.table)} (${cols}) VALUES (${row.values});`;
}

function deleteSql(table: TableDiff, change: RowChange): string {
  const row = change.oldRow ?? change.newRow!;
  const pkCols = table.pkColumns.length ? table.pkColumns : row.columns;
  const pkVals = table.pkColumns.length
    ? row.pkValues
    : splitValuesString(row.values);
  const where = pkCols
    .map((col, idx) => {
      const v = pkVals[idx] ?? "NULL";
      if (v === "NULL" || v === "null") return `${quoteIdent(col)} IS NULL`;
      return `${quoteIdent(col)}=${v}`;
    })
    .join(" AND ");
  return `DELETE FROM ${quoteIdent(table.table)} WHERE ${where};`;
}

function quoteIdent(name: string): string {
  return "`" + name.replace(/`/g, "``") + "`";
}

function splitValuesString(values: string): string[] {
  const out: string[] = [];
  let buf = "";
  let i = 0;
  const n = values.length;
  while (i < n) {
    const ch = values[i];
    if (ch === "'") {
      const end = skipQuoted(values, i, "'");
      buf += values.slice(i, end);
      i = end;
    } else if (ch === ",") {
      out.push(buf.trim());
      buf = "";
      i++;
    } else {
      buf += ch;
      i++;
    }
  }
  out.push(buf.trim());
  return out;
}

function skipQuoted(s: string, start: number, q: string): number {
  let i = start + 1;
  const n = s.length;
  while (i < n) {
    if (s[i] === "\\") {
      i += 2;
      continue;
    }
    if (s[i] === q) {
      if (s[i + 1] === q) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i++;
  }
  return n;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
