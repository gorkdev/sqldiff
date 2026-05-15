import { describe, it, expect } from "vitest";
import { writeSyncSql, pkKey } from "../sql-writer";
import type { DiffSummary, RowData, TableDiff } from "../types";

function row(values: string[], cols: string[], pkCols: string[]): RowData {
  const pkVals = pkCols.map((pk) => values[cols.indexOf(pk)] ?? "");
  return {
    hash: values.join("|"),
    values: values.join(","),
    columns: cols,
    pkColumns: pkCols,
    pkValues: pkVals,
  };
}

describe("end-to-end realistic scenario", () => {
  it("produces a complete sync.sql with mixed missing + per-cell reverts", () => {
    const cols = ["id", "name", "email", "password", "updated_at"];
    const pk = ["id"];

    const admins: TableDiff = {
      table: "admins",
      columns: cols,
      pkColumns: pk,
      status: "common",
      inserts: [],
      updates: [
        {
          kind: "update",
          pkValues: ["1"],
          oldRow: row(
            ["1", "'Görkem'", "'g@old.com'", "'hash1'", "'2026-01-01 10:00:00'"],
            cols,
            pk
          ),
          newRow: row(
            [
              "1",
              "'Görkem Yeni'",
              "'g.yeni@new.com'",
              "'hash1'",
              "'2026-05-15 16:23:00'",
            ],
            cols,
            pk
          ),
        },
        {
          kind: "update",
          pkValues: ["2"],
          oldRow: row(
            ["2", "'Cihan'", "'c@old.com'", "'hash2'", "'2026-01-02 11:00:00'"],
            cols,
            pk
          ),
          newRow: row(
            ["2", "'Cihan'", "'c@old.com'", "'hash2'", "'2026-05-15 17:00:00'"],
            cols,
            pk
          ),
        },
      ],
      deletes: [
        {
          kind: "delete",
          pkValues: ["99"],
          oldRow: row(
            [
              "99",
              "'EskiAdmin'",
              "'eski@admin.com'",
              "'hash99'",
              "'2025-12-01 00:00:00'",
            ],
            cols,
            pk
          ),
        },
      ],
    };

    const summary: DiffSummary = {
      oldFileName: "old.sql",
      newFileName: "new.sql",
      oldFileSize: 10240,
      newFileSize: 12345,
      generatedAt: "2026-05-15T16:50:00.000Z",
      tables: [admins],
    };

    const overrides = new Map([
      [
        "admins",
        new Map([
          [pkKey(["1"]), new Set(["name", "email"])],
          [pkKey(["2"]), new Set(["updated_at"])],
        ]),
      ],
    ]);

    const sql = writeSyncSql(summary, {
      tables: new Set(["admins"]),
      updateOverrides: overrides,
    });

    // 1 INSERT IGNORE (missing row 99)
    expect((sql.match(/INSERT IGNORE INTO/g) || []).length).toBe(1);
    expect(sql).toContain(
      "INSERT IGNORE INTO `admins` (`id`,`name`,`email`,`password`,`updated_at`) VALUES (99,'EskiAdmin','eski@admin.com','hash99','2025-12-01 00:00:00');"
    );

    // 2 UPDATE statements
    expect((sql.match(/^UPDATE/gm) || []).length).toBe(2);

    // Row 1: name + email reverted to OLD; password and updated_at untouched
    expect(sql).toContain(
      "UPDATE `admins` SET `name`='Görkem', `email`='g@old.com' WHERE `id`=1;"
    );

    // Row 2: only updated_at reverted (name/email/password unchanged in source)
    expect(sql).toContain(
      "UPDATE `admins` SET `updated_at`='2026-01-02 11:00:00' WHERE `id`=2;"
    );

    // PK column never appears in SET (only in WHERE)
    const updates = sql.match(/^UPDATE[^;]+;$/gm) ?? [];
    for (const stmt of updates) {
      const setPart = stmt.match(/SET (.+?) WHERE/)?.[1] ?? "";
      expect(setPart).not.toMatch(/`id`=/);
    }

    // header sanity
    expect(sql).toMatch(/SET NAMES utf8mb4;/);
    expect(sql).toMatch(/SET FOREIGN_KEY_CHECKS = 0;/);
    expect(sql).toMatch(/COMMIT;/);
    expect(sql).toMatch(/SET FOREIGN_KEY_CHECKS = 1;/);
    expect(sql).toMatch(/SET SQL_MODE = @OLD_SQL_MODE;/);
    expect(sql).toMatch(/-- admins: 1 missing, 2 reverted to OLD/);
  });

  it("handles a 3-status mix: common updates + old-only CREATE + new-only DROP", () => {
    const createMissing = `CREATE TABLE \`new_feature_log\` (
  \`id\` int NOT NULL AUTO_INCREMENT,
  \`event\` varchar(64) NOT NULL,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB`;

    const commonTable: TableDiff = {
      table: "admins",
      columns: ["id", "name"],
      pkColumns: ["id"],
      status: "common",
      inserts: [],
      updates: [
        {
          kind: "update",
          pkValues: ["1"],
          oldRow: row(["1", "'Görkem'"], ["id", "name"], ["id"]),
          newRow: row(["1", "'Görkem Yeni'"], ["id", "name"], ["id"]),
        },
      ],
      deletes: [
        {
          kind: "delete",
          pkValues: ["7"],
          oldRow: row(["7", "'EskiAdmin'"], ["id", "name"], ["id"]),
        },
      ],
    };

    const oldOnly: TableDiff = {
      table: "new_feature_log",
      columns: ["id", "event"],
      pkColumns: ["id"],
      status: "old-only",
      createSql: createMissing,
      inserts: [],
      updates: [],
      deletes: [
        {
          kind: "delete",
          pkValues: ["1"],
          oldRow: row(["1", "'start'"], ["id", "event"], ["id"]),
        },
        {
          kind: "delete",
          pkValues: ["2"],
          oldRow: row(["2", "'stop'"], ["id", "event"], ["id"]),
        },
      ],
    };

    const newOnly: TableDiff = {
      table: "legacy_garbage",
      columns: ["id"],
      pkColumns: ["id"],
      status: "new-only",
      inserts: [
        {
          kind: "insert",
          pkValues: ["1"],
          newRow: row(["1"], ["id"], ["id"]),
        },
      ],
      updates: [],
      deletes: [],
    };

    const summary: DiffSummary = {
      oldFileName: "old.sql",
      newFileName: "new.sql",
      oldFileSize: 1000,
      newFileSize: 2000,
      generatedAt: "2026-05-15T17:00:00.000Z",
      tables: [commonTable, oldOnly, newOnly],
    };

    const overrides = new Map([
      ["admins", new Map([[pkKey(["1"]), new Set(["name"])]])],
    ]);

    const sql = writeSyncSql(summary, {
      tables: new Set(["admins", "new_feature_log"]),
      dropTables: new Set(["legacy_garbage"]),
      updateOverrides: overrides,
    });

    // DDL section
    expect(sql).toContain("DROP TABLE IF EXISTS `legacy_garbage`;");
    expect(sql).toContain("DROP TABLE IF EXISTS `new_feature_log`;");
    expect(sql).toContain("CREATE TABLE `new_feature_log`");
    expect(sql).toMatch(/-- DDL create: new_feature_log/);
    expect(sql).toMatch(/-- DDL drop: legacy_garbage/);

    // DML: missing row for common admin
    expect(sql).toContain(
      "INSERT IGNORE INTO `admins` (`id`,`name`) VALUES (7,'EskiAdmin');"
    );
    // DML: revert for admin 1
    expect(sql).toContain(
      "UPDATE `admins` SET `name`='Görkem' WHERE `id`=1;"
    );
    // DML: insert all rows of recreated old-only table
    expect(sql).toContain(
      "INSERT IGNORE INTO `new_feature_log` (`id`,`event`) VALUES (1,'start'),(2,'stop');"
    );

    // legacy_garbage rows must NOT be inserted (DROP only, no recreation)
    expect(sql).not.toMatch(/INSERT IGNORE INTO `legacy_garbage`/);

    // DDL is outside transaction
    const ddlCreate = sql.indexOf("CREATE TABLE `new_feature_log`");
    const startTx = sql.indexOf("START TRANSACTION;");
    const commitTx = sql.indexOf("COMMIT;");
    expect(ddlCreate).toBeLessThan(startTx);
    expect(sql.indexOf("DROP TABLE IF EXISTS `legacy_garbage`;")).toBeLessThan(
      startTx
    );

    // INSERT and UPDATE for admins are inside the transaction
    expect(sql.indexOf("UPDATE `admins`")).toBeGreaterThan(startTx);
    expect(sql.indexOf("UPDATE `admins`")).toBeLessThan(commitTx);

    // mode header
    expect(sql).toMatch(/-- mode: missing-only \+ manual reverts \+ DDL/);
  });

  it("respects per-row missing exclusion alongside reverts and DDL", () => {
    // Common table with 4 missing rows; user excludes 2 of them.
    const cols = ["id", "label"];
    const pk = ["id"];

    const commonTable: TableDiff = {
      table: "items",
      columns: cols,
      pkColumns: pk,
      status: "common",
      inserts: [],
      updates: [],
      deletes: [
        { kind: "delete", pkValues: ["1"], oldRow: row(["1", "'a'"], cols, pk) },
        { kind: "delete", pkValues: ["2"], oldRow: row(["2", "'b'"], cols, pk) },
        { kind: "delete", pkValues: ["3"], oldRow: row(["3", "'c'"], cols, pk) },
        { kind: "delete", pkValues: ["4"], oldRow: row(["4", "'d'"], cols, pk) },
      ],
    };

    const summary: DiffSummary = {
      oldFileName: "old.sql",
      newFileName: "new.sql",
      oldFileSize: 1,
      newFileSize: 1,
      generatedAt: "2026-05-15T17:00:00.000Z",
      tables: [commonTable],
    };

    const excludeMissing = new Map([
      ["items", new Set([pkKey(["2"]), pkKey(["4"])])],
    ]);

    const sql = writeSyncSql(summary, {
      tables: new Set(["items"]),
      excludeMissing,
    });

    // Only id=1 and id=3 emitted
    expect(sql).toContain(
      "INSERT IGNORE INTO `items` (`id`,`label`) VALUES (1,'a'),(3,'c');"
    );
    expect(sql).not.toContain("(2,'b')");
    expect(sql).not.toContain("(4,'d')");
    expect(sql).toMatch(/-- items: 2 of 4 missing/);
  });
});
