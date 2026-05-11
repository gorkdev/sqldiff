import { describe, it, expect } from "vitest";
import { writeSyncSql } from "../sql-writer";
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

  it("does NOT emit UPDATE statements (NEW is treated as authoritative)", () => {
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
});
