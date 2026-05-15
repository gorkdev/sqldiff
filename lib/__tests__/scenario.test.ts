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
});
