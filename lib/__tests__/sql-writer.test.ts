import { describe, it, expect } from "vitest";
import { writeSyncSql, pkKey } from "../sql-writer";
import type { DiffSummary, RowData, TableDiff } from "../types";

function row(values: string[], columns: string[], pkColumns: string[] = ["id"]): RowData {
  const pkValues = pkColumns.map((pk) => values[columns.indexOf(pk)] ?? "");
  return {
    hash: values.join("|"),
    values: values.join(","),
    columns,
    pkColumns,
    pkValues,
  };
}

function table(name: string, columns: string[], pkColumns: string[], opts: {
  oldOnly?: string[][];
  newOnly?: string[][];
  changed?: { oldValues: string[]; newValues: string[] }[];
}): TableDiff {
  // Mapping to differ's categories:
  //   "oldOnly" rows = differ.deletes (in OLD but not in NEW) → these are the rows we want to emit
  //   "newOnly" rows = differ.inserts (in NEW but not in OLD) → ignored by missing-only writer
  //   "changed" rows = differ.updates → ignored by missing-only writer
  return {
    table: name,
    columns,
    pkColumns,
    inserts: (opts.newOnly ?? []).map((v) => ({
      kind: "insert" as const,
      pkValues: pkColumns.map((pk) => v[columns.indexOf(pk)] ?? ""),
      newRow: row(v, columns, pkColumns),
    })),
    updates: (opts.changed ?? []).map((c) => ({
      kind: "update" as const,
      pkValues: pkColumns.map((pk) => c.newValues[columns.indexOf(pk)] ?? ""),
      oldRow: row(c.oldValues, columns, pkColumns),
      newRow: row(c.newValues, columns, pkColumns),
    })),
    deletes: (opts.oldOnly ?? []).map((v) => ({
      kind: "delete" as const,
      pkValues: pkColumns.map((pk) => v[columns.indexOf(pk)] ?? ""),
      oldRow: row(v, columns, pkColumns),
    })),
    status: "common" as const,
  };
}

function summary(tables: TableDiff[]): DiffSummary {
  return {
    oldFileName: "old.sql",
    newFileName: "new.sql",
    oldFileSize: 100,
    newFileSize: 200,
    generatedAt: "2026-05-11T00:00:00.000Z",
    tables,
  };
}

describe("writeSyncSql — missing-only mode", () => {
  it("emits INSERT IGNORE for rows present in OLD but not in NEW", () => {
    const t = table("posts", ["id", "title"], ["id"], {
      oldOnly: [["3", "'Eski post'"]],
    });
    const sql = writeSyncSql(summary([t]), { tables: new Set(["posts"]) });

    expect(sql).toContain("INSERT IGNORE INTO `posts` (`id`,`title`) VALUES (3,'Eski post');");
  });

  it("does NOT emit DELETE statements (target NEW is preserved)", () => {
    const t = table("posts", ["id", "title"], ["id"], {
      oldOnly: [["3", "'Eski'"]],
      newOnly: [["5", "'Yeni'"]],
    });
    const sql = writeSyncSql(summary([t]), { tables: new Set(["posts"]) });

    expect(sql).not.toMatch(/\bDELETE\b/);
  });

  it("does NOT emit UPDATE statements by default (no updateOverrides)", () => {
    const t = table("posts", ["id", "title"], ["id"], {
      changed: [{ oldValues: ["3", "'old'"], newValues: ["3", "'new'"] }],
    });
    const sql = writeSyncSql(summary([t]), { tables: new Set(["posts"]) });

    expect(sql).not.toMatch(/\bUPDATE\b/);
  });

  it("does NOT emit rows that are NEW-only (those exist on target already)", () => {
    const t = table("posts", ["id", "title"], ["id"], {
      newOnly: [["5", "'Yeni'"]],
    });
    const sql = writeSyncSql(summary([t]), { tables: new Set(["posts"]) });

    expect(sql).not.toContain("'Yeni'");
    expect(sql).not.toMatch(/INSERT (IGNORE )?INTO `posts`.*'Yeni'/);
  });

  it("wraps output with FOREIGN_KEY_CHECKS=0 + TRANSACTION", () => {
    const t = table("posts", ["id", "title"], ["id"], {
      oldOnly: [["3", "'X'"]],
    });
    const sql = writeSyncSql(summary([t]), { tables: new Set(["posts"]) });

    expect(sql).toMatch(/SET FOREIGN_KEY_CHECKS = 0;[\s\S]*START TRANSACTION;/);
    expect(sql).toMatch(/COMMIT;[\s\S]*SET FOREIGN_KEY_CHECKS = 1;/);
  });

  it("preserves NULL literal in INSERT body (no IS NULL conversion)", () => {
    const t = table("posts", ["id", "subtitle"], ["id"], {
      oldOnly: [["3", "NULL"]],
    });
    const sql = writeSyncSql(summary([t]), { tables: new Set(["posts"]) });

    expect(sql).toContain("(3,NULL)");
    expect(sql).not.toMatch(/IS NULL/);
  });

  it("preserves hex literal in INSERT body", () => {
    const t = table("blobs", ["id", "data"], ["id"], {
      oldOnly: [["1", "0xDEADBEEF"]],
    });
    const sql = writeSyncSql(summary([t]), { tables: new Set(["blobs"]) });

    expect(sql).toContain("(1,0xDEADBEEF)");
  });

  it("preserves doubled-quote escape in string values", () => {
    const t = table("escapes", ["id", "text"], ["id"], {
      oldOnly: [["2", "'O''Brien'"]],
    });
    const sql = writeSyncSql(summary([t]), { tables: new Set(["escapes"]) });

    expect(sql).toContain("(2,'O''Brien')");
  });

  it("supports composite primary keys", () => {
    const t = table(
      "user_roles",
      ["user_id", "role_id", "granted_at"],
      ["user_id", "role_id"],
      { oldOnly: [["1", "5", "'2026-01-01'"]] }
    );
    const sql = writeSyncSql(summary([t]), { tables: new Set(["user_roles"]) });

    expect(sql).toContain(
      "INSERT IGNORE INTO `user_roles` (`user_id`,`role_id`,`granted_at`) VALUES (1,5,'2026-01-01');"
    );
  });

  it("emits a 'no primary key' WARNING comment for PK-less tables", () => {
    const t = table("audit_log", ["event", "payload"], [], {
      oldOnly: [["'login'", "'data'"]],
    });
    const sql = writeSyncSql(summary([t]), { tables: new Set(["audit_log"]) });

    expect(sql).toMatch(/-- WARNING: no primary key.*audit_log/);
    expect(sql).toContain("INSERT IGNORE INTO `audit_log`");
  });

  it("does NOT emit AUTO_INCREMENT trailer (target NEW already has correct counter)", () => {
    const t = table("posts", ["id", "title"], ["id"], {
      oldOnly: [["3", "'X'"]],
    });
    const sql = writeSyncSql(summary([t]), { tables: new Set(["posts"]) });

    expect(sql).not.toMatch(/AUTO_INCREMENT/i);
  });

  it("filters by selected tables only", () => {
    const t1 = table("posts", ["id", "title"], ["id"], { oldOnly: [["1", "'A'"]] });
    const t2 = table("users", ["id", "name"], ["id"], { oldOnly: [["1", "'B'"]] });
    const sql = writeSyncSql(summary([t1, t2]), { tables: new Set(["posts"]) });

    expect(sql).toContain("INSERT IGNORE INTO `posts`");
    expect(sql).not.toContain("INSERT IGNORE INTO `users`");
  });

  it("skips tables that have no missing rows", () => {
    const t1 = table("posts", ["id", "title"], ["id"], { oldOnly: [["1", "'A'"]] });
    const t2 = table("users", ["id", "name"], ["id"], {
      newOnly: [["1", "'B'"]],
      changed: [{ oldValues: ["2", "'x'"], newValues: ["2", "'y'"] }],
    });
    const sql = writeSyncSql(summary([t1, t2]), { tables: new Set(["posts", "users"]) });

    expect(sql).toContain("INSERT IGNORE INTO `posts`");
    expect(sql).not.toContain("INSERT IGNORE INTO `users`");
    // users should not appear in the "tables included" comment either
    expect(sql).toMatch(/tables included: posts$/m);
  });

  it("includes mode and target metadata in the header comments", () => {
    const t = table("posts", ["id", "title"], ["id"], { oldOnly: [["1", "'A'"]] });
    const sql = writeSyncSql(summary([t]), { tables: new Set(["posts"]) });

    expect(sql).toMatch(/-- mode: missing-only/);
    expect(sql).toMatch(/-- target: new\.sql/i);
    expect(sql).toMatch(/-- source: old\.sql/i);
  });

  it("emits SET NAMES utf8mb4 before the data block (phpMyAdmin charset safety)", () => {
    const t = table("posts", ["id", "title"], ["id"], { oldOnly: [["1", "'A'"]] });
    const sql = writeSyncSql(summary([t]), { tables: new Set(["posts"]) });

    expect(sql).toMatch(
      /SET NAMES utf8mb4;[\s\S]*START TRANSACTION;[\s\S]*INSERT IGNORE INTO `posts`/
    );
  });

  it("saves and restores SQL_MODE around the transaction", () => {
    const t = table("posts", ["id", "title"], ["id"], { oldOnly: [["1", "'A'"]] });
    const sql = writeSyncSql(summary([t]), { tables: new Set(["posts"]) });

    expect(sql).toMatch(/SET @OLD_SQL_MODE = @@SQL_MODE;/);
    expect(sql).toMatch(/SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';/);
    expect(sql).toMatch(/SET SQL_MODE = @OLD_SQL_MODE;/);
  });

  it("batches multiple missing rows into a single multi-row INSERT statement", () => {
    const t = table("posts", ["id", "title"], ["id"], {
      oldOnly: [
        ["1", "'A'"],
        ["2", "'B'"],
        ["3", "'C'"],
      ],
    });
    const sql = writeSyncSql(summary([t]), { tables: new Set(["posts"]) });

    expect(sql).toContain(
      "INSERT IGNORE INTO `posts` (`id`,`title`) VALUES (1,'A'),(2,'B'),(3,'C');"
    );
    // Only one INSERT statement should be emitted for this table.
    const insertCount = (sql.match(/INSERT IGNORE INTO `posts`/g) ?? []).length;
    expect(insertCount).toBe(1);
  });

  it("splits batches when row count exceeds maxRowsPerInsert", () => {
    const t = table("posts", ["id", "title"], ["id"], {
      oldOnly: Array.from({ length: 5 }, (_, i) => [String(i + 1), `'x'`]),
    });
    const sql = writeSyncSql(summary([t]), {
      tables: new Set(["posts"]),
      maxRowsPerInsert: 2,
    });

    // 5 rows, batch size 2 → 3 INSERT statements (2 + 2 + 1).
    const insertCount = (sql.match(/INSERT IGNORE INTO `posts`/g) ?? []).length;
    expect(insertCount).toBe(3);
  });

  describe("updateOverrides — per-column revert to OLD", () => {
    const overrideOf = (
      table: string,
      pk: string[],
      cols: string[]
    ): Map<string, Map<string, Set<string>>> =>
      new Map([[table, new Map([[pkKey(pk), new Set(cols)]])]]);

    it("emits SET only for explicitly selected columns (not all changed columns)", () => {
      const t = table("posts", ["id", "title", "body"], ["id"], {
        changed: [
          {
            oldValues: ["3", "'eski başlık'", "'eski içerik'"],
            newValues: ["3", "'yeni başlık'", "'yeni içerik'"],
          },
        ],
      });
      const sql = writeSyncSql(summary([t]), {
        tables: new Set(["posts"]),
        updateOverrides: overrideOf("posts", ["3"], ["title"]),
      });

      expect(sql).toContain(
        "UPDATE `posts` SET `title`='eski başlık' WHERE `id`=3;"
      );
      expect(sql).not.toContain("`body`=");
    });

    it("emits multi-column SET when multiple columns are selected", () => {
      const t = table("posts", ["id", "title", "body"], ["id"], {
        changed: [
          {
            oldValues: ["3", "'eski t'", "'eski b'"],
            newValues: ["3", "'yeni t'", "'yeni b'"],
          },
        ],
      });
      const sql = writeSyncSql(summary([t]), {
        tables: new Set(["posts"]),
        updateOverrides: overrideOf("posts", ["3"], ["title", "body"]),
      });

      expect(sql).toContain(
        "UPDATE `posts` SET `title`='eski t', `body`='eski b' WHERE `id`=3;"
      );
    });

    it("skips selected column when its value did not actually change", () => {
      const t = table("posts", ["id", "title", "body"], ["id"], {
        changed: [
          {
            oldValues: ["3", "'same'", "'eski'"],
            newValues: ["3", "'same'", "'yeni'"],
          },
        ],
      });
      const sql = writeSyncSql(summary([t]), {
        tables: new Set(["posts"]),
        updateOverrides: overrideOf("posts", ["3"], ["title"]),
      });

      // 'title' selected but unchanged → no UPDATE emitted
      expect(sql).not.toMatch(/\bUPDATE\b/);
    });

    it("uses AND for composite PK in WHERE clause", () => {
      const t = table(
        "user_roles",
        ["user_id", "role_id", "granted_at"],
        ["user_id", "role_id"],
        {
          changed: [
            {
              oldValues: ["1", "5", "'2026-01-01'"],
              newValues: ["1", "5", "'2026-05-01'"],
            },
          ],
        }
      );
      const sql = writeSyncSql(summary([t]), {
        tables: new Set(["user_roles"]),
        updateOverrides: overrideOf("user_roles", ["1", "5"], ["granted_at"]),
      });

      expect(sql).toContain(
        "UPDATE `user_roles` SET `granted_at`='2026-01-01' WHERE `user_id`=1 AND `role_id`=5;"
      );
    });

    it("skips revert when table has no primary key", () => {
      const t = table("audit_log", ["event", "payload"], [], {
        changed: [
          { oldValues: ["'login'", "'a'"], newValues: ["'login'", "'b'"] },
        ],
      });
      const sql = writeSyncSql(summary([t]), {
        tables: new Set(["audit_log"]),
        updateOverrides: overrideOf("audit_log", [], ["payload"]),
      });

      expect(sql).not.toMatch(/\bUPDATE\b/);
    });

    it("includes a table with reverts even when it has no missing rows", () => {
      const t = table("posts", ["id", "title"], ["id"], {
        changed: [{ oldValues: ["3", "'old'"], newValues: ["3", "'new'"] }],
      });
      const sql = writeSyncSql(summary([t]), {
        tables: new Set(["posts"]),
        updateOverrides: overrideOf("posts", ["3"], ["title"]),
      });

      expect(sql).toMatch(/tables included: posts/);
      expect(sql).toContain("UPDATE `posts`");
    });

    it("adds 'manual reverts' to the mode header when any revert is selected", () => {
      const t = table("posts", ["id", "title"], ["id"], {
        changed: [{ oldValues: ["1", "'a'"], newValues: ["1", "'b'"] }],
      });
      const sql = writeSyncSql(summary([t]), {
        tables: new Set(["posts"]),
        updateOverrides: overrideOf("posts", ["1"], ["title"]),
      });

      expect(sql).toMatch(/-- mode: missing-only \+ manual reverts/);
    });
  });

  describe("DDL — old-only and new-only tables", () => {
    const oldOnlyTable = (
      name: string,
      cols: string[],
      pkCols: string[],
      rows: string[][],
      createSql: string
    ): TableDiff => {
      const t = table(name, cols, pkCols, { oldOnly: rows });
      return { ...t, status: "old-only", createSql };
    };

    const newOnlyTable = (
      name: string,
      cols: string[],
      pkCols: string[],
      rows: string[][]
    ): TableDiff => {
      const t = table(name, cols, pkCols, { newOnly: rows });
      return { ...t, status: "new-only" };
    };

    it("emits DROP IF EXISTS + CREATE for selected old-only table", () => {
      const create = `CREATE TABLE \`missing_t\` (\n  \`id\` int NOT NULL,\n  PRIMARY KEY (\`id\`)\n) ENGINE=InnoDB`;
      const t = oldOnlyTable("missing_t", ["id"], ["id"], [["1"], ["2"]], create);
      const sql = writeSyncSql(summary([t]), {
        tables: new Set(["missing_t"]),
      });

      expect(sql).toContain("DROP TABLE IF EXISTS `missing_t`;");
      expect(sql).toContain("CREATE TABLE `missing_t`");
      expect(sql).toMatch(/-- DDL create: missing_t/);
      // Followed by INSERT IGNOREs for its rows
      expect(sql).toContain(
        "INSERT IGNORE INTO `missing_t` (`id`) VALUES (1),(2);"
      );
    });

    it("does NOT emit CREATE for unselected old-only table", () => {
      const create = `CREATE TABLE \`x\` (\`id\` int NOT NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`;
      const t = oldOnlyTable("x", ["id"], ["id"], [["1"]], create);
      const sql = writeSyncSql(summary([t]), { tables: new Set() });

      expect(sql).not.toContain("CREATE TABLE `x`");
      expect(sql).not.toContain("INSERT IGNORE INTO `x`");
    });

    it("emits DROP for new-only table when listed in dropTables", () => {
      const t = newOnlyTable("extra_t", ["id"], ["id"], [["1"]]);
      const sql = writeSyncSql(summary([t]), {
        tables: new Set(),
        dropTables: new Set(["extra_t"]),
      });

      expect(sql).toContain("DROP TABLE IF EXISTS `extra_t`;");
      expect(sql).toMatch(/-- DDL drop: extra_t/);
    });

    it("does NOT emit DROP for new-only table when not in dropTables", () => {
      const t = newOnlyTable("extra_t", ["id"], ["id"], [["1"]]);
      const sql = writeSyncSql(summary([t]), {
        tables: new Set(["extra_t"]),
        dropTables: new Set(),
      });

      expect(sql).not.toContain("DROP TABLE IF EXISTS `extra_t`");
    });

    it("keeps DDL outside the transaction wrapper", () => {
      const create = `CREATE TABLE \`m\` (\`id\` int NOT NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`;
      const t = oldOnlyTable("m", ["id"], ["id"], [], create);
      const sql = writeSyncSql(summary([t]), { tables: new Set(["m"]) });

      const ddlPos = sql.indexOf("CREATE TABLE `m`");
      const startTx = sql.indexOf("START TRANSACTION;");
      expect(ddlPos).toBeGreaterThan(-1);
      expect(startTx).toBeGreaterThan(ddlPos);
    });

    it("emits warning when old-only table has no captured createSql", () => {
      const t = oldOnlyTable("legacy", ["id"], ["id"], [["1"]], "");
      const sql = writeSyncSql(summary([t]), { tables: new Set(["legacy"]) });

      expect(sql).toMatch(/-- WARNING: missing CREATE TABLE.*legacy/);
      // Still tries to DROP IF EXISTS + INSERT (will fail at runtime but explicit)
      expect(sql).toContain("DROP TABLE IF EXISTS `legacy`;");
    });

    it("excludeMissing omits specified rows from INSERT IGNORE", () => {
      const t = table("posts", ["id", "title"], ["id"], {
        oldOnly: [["1", "'A'"], ["2", "'B'"], ["3", "'C'"]],
      });
      const sql = writeSyncSql(summary([t]), {
        tables: new Set(["posts"]),
        excludeMissing: new Map([
          ["posts", new Set([pkKey(["2"])])],
        ]),
      });

      expect(sql).toContain("(1,'A')");
      expect(sql).toContain("(3,'C')");
      expect(sql).not.toContain("(2,'B')");
      // Comment reflects partial selection
      expect(sql).toMatch(/-- posts: 2 of 3 missing/);
    });

    it("excludeMissing covering all rows produces no INSERT for that table", () => {
      const t = table("posts", ["id"], ["id"], {
        oldOnly: [["1"], ["2"]],
      });
      const sql = writeSyncSql(summary([t]), {
        tables: new Set(["posts"]),
        excludeMissing: new Map([
          ["posts", new Set([pkKey(["1"]), pkKey(["2"])])],
        ]),
      });

      expect(sql).not.toContain("INSERT IGNORE INTO `posts`");
    });

    it("mode header includes 'DDL' when any DDL is emitted", () => {
      const t = newOnlyTable("e", ["id"], ["id"], [["1"]]);
      const sql = writeSyncSql(summary([t]), {
        tables: new Set(),
        dropTables: new Set(["e"]),
      });

      expect(sql).toMatch(/-- mode: missing-only \+ DDL/);
    });
  });

  it("splits batches when byte size exceeds maxBytesPerInsert", () => {
    // Long string values to push past a tight byte limit.
    const t = table("posts", ["id", "body"], ["id"], {
      oldOnly: [
        ["1", `'${"a".repeat(200)}'`],
        ["2", `'${"b".repeat(200)}'`],
      ],
    });
    const sql = writeSyncSql(summary([t]), {
      tables: new Set(["posts"]),
      maxBytesPerInsert: 300,
    });

    const insertCount = (sql.match(/INSERT IGNORE INTO `posts`/g) ?? []).length;
    expect(insertCount).toBe(2);
  });
});
