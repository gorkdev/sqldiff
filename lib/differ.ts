import type { DumpSnapshot, RowChange, TableDiff, TableSnapshot } from "./types";

export function diffSnapshots(
  oldSnap: DumpSnapshot,
  newSnap: DumpSnapshot
): TableDiff[] {
  const tableNames = new Set<string>([...oldSnap.keys(), ...newSnap.keys()]);
  const out: TableDiff[] = [];

  for (const name of Array.from(tableNames).sort()) {
    const oldTable = oldSnap.get(name);
    const newTable = newSnap.get(name);

    if (!newTable) {
      out.push(makeDroppedTable(oldTable!));
      continue;
    }
    if (!oldTable) {
      out.push(makeNewTable(newTable));
      continue;
    }

    out.push(diffTable(oldTable, newTable));
  }

  return out;
}

function diffTable(oldTable: TableSnapshot, newTable: TableSnapshot): TableDiff {
  const inserts: RowChange[] = [];
  const updates: RowChange[] = [];
  const deletes: RowChange[] = [];

  for (const [key, newRow] of newTable.rows) {
    const oldRow = oldTable.rows.get(key);
    if (!oldRow) {
      inserts.push({ kind: "insert", pkValues: newRow.pkValues, newRow });
    } else if (oldRow.hash !== newRow.hash) {
      updates.push({ kind: "update", pkValues: newRow.pkValues, oldRow, newRow });
    }
  }

  for (const [key, oldRow] of oldTable.rows) {
    if (!newTable.rows.has(key)) {
      deletes.push({ kind: "delete", pkValues: oldRow.pkValues, oldRow });
    }
  }

  return {
    table: newTable.table,
    columns: newTable.columns,
    pkColumns: newTable.pkColumns,
    inserts,
    updates,
    deletes,
    status: "common",
  };
}

function makeNewTable(table: TableSnapshot): TableDiff {
  const inserts: RowChange[] = [];
  for (const row of table.rows.values()) {
    inserts.push({ kind: "insert", pkValues: row.pkValues, newRow: row });
  }
  return {
    table: table.table,
    columns: table.columns,
    pkColumns: table.pkColumns,
    inserts,
    updates: [],
    deletes: [],
    status: "new-only",
  };
}

function makeDroppedTable(table: TableSnapshot): TableDiff {
  const deletes: RowChange[] = [];
  for (const row of table.rows.values()) {
    deletes.push({ kind: "delete", pkValues: row.pkValues, oldRow: row });
  }
  return {
    table: table.table,
    columns: table.columns,
    pkColumns: table.pkColumns,
    inserts: [],
    updates: [],
    deletes,
    status: "old-only",
    createSql: table.createSql,
  };
}

export function totalChanges(diff: TableDiff): number {
  return diff.inserts.length + diff.updates.length + diff.deletes.length;
}
