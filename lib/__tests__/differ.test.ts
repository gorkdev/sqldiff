import { describe, it, expect } from "vitest";
import { diffSnapshots } from "../differ";
import type { DumpSnapshot, RowData, TableSnapshot } from "../types";

function makeRow(values: string[], cols: string[], pkCols: string[]): RowData {
  const pkValues = pkCols.map((pk) => values[cols.indexOf(pk)] ?? "");
  return {
    hash: values.join("|"),
    values: values.join(","),
    columns: cols,
    pkColumns: pkCols,
    pkValues,
  };
}

function makeTable(name: string, cols: string[], pkCols: string[], rows: string[][]): TableSnapshot {
  const map = new Map<string, RowData>();
  for (const r of rows) {
    const row = makeRow(r, cols, pkCols);
    map.set(row.pkValues.join(" "), row);
  }
  return { table: name, columns: cols, pkColumns: pkCols, rows: map };
}

function snap(tables: TableSnapshot[]): DumpSnapshot {
  return new Map(tables.map((t) => [t.table, t]));
}

describe("diffSnapshots", () => {
  it("emits a row as 'delete' (= missing in target) when it exists in OLD but not in NEW", () => {
    const old = snap([makeTable("t", ["id", "name"], ["id"], [["1", "'A'"], ["2", "'B'"]])]);
    const next = snap([makeTable("t", ["id", "name"], ["id"], [["1", "'A'"]])]);
    const diff = diffSnapshots(old, next);
    expect(diff).toHaveLength(1);
    expect(diff[0].deletes.map((d) => d.pkValues[0])).toEqual(["2"]);
    expect(diff[0].inserts).toHaveLength(0);
    expect(diff[0].updates).toHaveLength(0);
  });

  it("emits a row as 'insert' when it exists in NEW but not in OLD (not selected by missing-only)", () => {
    const old = snap([makeTable("t", ["id"], ["id"], [["1"]])]);
    const next = snap([makeTable("t", ["id"], ["id"], [["1"], ["2"]])]);
    const diff = diffSnapshots(old, next);
    expect(diff[0].inserts.map((d) => d.pkValues[0])).toEqual(["2"]);
    expect(diff[0].deletes).toHaveLength(0);
  });

  it("emits an 'update' when keys match but hashes differ", () => {
    const old = snap([makeTable("t", ["id", "v"], ["id"], [["1", "'old'"]])]);
    const next = snap([makeTable("t", ["id", "v"], ["id"], [["1", "'new'"]])]);
    const diff = diffSnapshots(old, next);
    expect(diff[0].updates).toHaveLength(1);
    expect(diff[0].inserts).toHaveLength(0);
    expect(diff[0].deletes).toHaveLength(0);
  });

  it("table present in OLD but missing in NEW → all rows become 'deletes'", () => {
    const old = snap([makeTable("dropped", ["id"], ["id"], [["1"], ["2"]])]);
    const next: DumpSnapshot = new Map();
    const diff = diffSnapshots(old, next);
    expect(diff).toHaveLength(1);
    expect(diff[0].deletes).toHaveLength(2);
  });

  it("table present in NEW but missing in OLD → all rows become 'inserts'", () => {
    const old: DumpSnapshot = new Map();
    const next = snap([makeTable("brand_new", ["id"], ["id"], [["1"], ["2"]])]);
    const diff = diffSnapshots(old, next);
    expect(diff).toHaveLength(1);
    expect(diff[0].inserts).toHaveLength(2);
    expect(diff[0].deletes).toHaveLength(0);
  });

  it("rows identical in both snapshots are not emitted", () => {
    const old = snap([makeTable("t", ["id", "v"], ["id"], [["1", "'x'"], ["2", "'y'"]])]);
    const next = snap([makeTable("t", ["id", "v"], ["id"], [["1", "'x'"], ["2", "'y'"]])]);
    const diff = diffSnapshots(old, next);
    expect(diff[0].inserts).toHaveLength(0);
    expect(diff[0].updates).toHaveLength(0);
    expect(diff[0].deletes).toHaveLength(0);
  });

  it("supports composite primary key matching", () => {
    const old = snap([
      makeTable("ur", ["u", "r"], ["u", "r"], [["1", "5"], ["2", "5"]]),
    ]);
    const next = snap([
      makeTable("ur", ["u", "r"], ["u", "r"], [["1", "5"]]),
    ]);
    const diff = diffSnapshots(old, next);
    expect(diff[0].deletes).toHaveLength(1);
    expect(diff[0].deletes[0].pkValues).toEqual(["2", "5"]);
  });
});
