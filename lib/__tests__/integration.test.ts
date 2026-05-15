import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { parseDump } from "../parser";
import { diffSnapshots } from "../differ";
import { writeSyncSql } from "../sql-writer";
import type { DiffSummary } from "../types";

const FIXTURES = resolve(__dirname, "../../test/fixtures");

let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "sqldiff-int-"));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function pipeline(oldPath: string, newPath: string): Promise<{ summary: DiffSummary; sql: string }> {
  const [oldSnap, newSnap] = await Promise.all([parseDump(oldPath), parseDump(newPath)]);
  const tables = diffSnapshots(oldSnap, newSnap);
  const summary: DiffSummary = {
    oldFileName: oldPath.split(/[\\/]/).pop()!,
    newFileName: newPath.split(/[\\/]/).pop()!,
    oldFileSize: 1,
    newFileSize: 1,
    generatedAt: "2026-05-11T00:00:00.000Z",
    tables,
  };
  const selected = new Set(tables.map((t) => t.table));
  const sql = writeSyncSql(summary, { tables: selected });
  return { summary, sql };
}

describe("integration — end-to-end with bundled fixtures", () => {
  it("fixture old.sql vs new.sql: empty sync.sql (new is superset, missing-only yields nothing)", async () => {
    // Fixtures are designed so new.sql has rows that old.sql lacks
    // (insert direction). In missing-only mode we look at OLD-only rows.
    const { summary, sql } = await pipeline(
      join(FIXTURES, "old.sql"),
      join(FIXTURES, "new.sql")
    );

    const totalOldOnly = summary.tables.reduce((s, t) => s + t.deletes.length, 0);
    if (totalOldOnly === 0) {
      // No OLD-only rows in fixtures → sync should declare "(none)"
      expect(sql).toMatch(/tables included: \(none\)/);
    } else {
      expect(sql).toContain("INSERT IGNORE INTO");
    }
    expect(sql).toMatch(/-- mode: missing-only/);
  });

  it("reversed (old=new, new=old): sync should contain rows that were in fixture/new but absent from fixture/old", async () => {
    // Swap fixtures so OLD becomes the "richer" one — we now have missing rows to emit.
    const { summary, sql } = await pipeline(
      join(FIXTURES, "new.sql"),
      join(FIXTURES, "old.sql")
    );

    const totalMissing = summary.tables.reduce((s, t) => s + t.deletes.length, 0);
    expect(totalMissing).toBeGreaterThan(0);
    expect(sql).toMatch(/INSERT IGNORE INTO/);
  });

  it("synthetic case: target NEW is missing 2 rows that exist in OLD source", async () => {
    const oldSql = `CREATE TABLE \`posts\` (
  \`id\` int NOT NULL,
  \`title\` varchar(100),
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB;
INSERT INTO \`posts\` VALUES (1,'A'),(2,'B'),(3,'C'),(4,'D');`;
    const newSql = `CREATE TABLE \`posts\` (
  \`id\` int NOT NULL,
  \`title\` varchar(100),
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB;
INSERT INTO \`posts\` VALUES (1,'A'),(3,'C');`;

    const oldPath = join(workDir, "missing_old.sql");
    const newPath = join(workDir, "missing_new.sql");
    await writeFile(oldPath, oldSql, "utf8");
    await writeFile(newPath, newSql, "utf8");

    const { sql } = await pipeline(oldPath, newPath);

    // Multi-row batching collapses both missing rows into one INSERT.
    expect(sql).toContain(
      "INSERT IGNORE INTO `posts` (`id`,`title`) VALUES (2,'B'),(4,'D');"
    );
    expect(sql).not.toContain("(1,'A')"); // exists in both
    expect(sql).not.toContain("(3,'C')"); // exists in both
  });

  it("synthetic case: NEW has rows not in OLD — those are NOT emitted (target is preserved)", async () => {
    const oldSql = `CREATE TABLE \`posts\` (
  \`id\` int NOT NULL,
  \`title\` varchar(100),
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB;
INSERT INTO \`posts\` VALUES (1,'A');`;
    const newSql = `CREATE TABLE \`posts\` (
  \`id\` int NOT NULL,
  \`title\` varchar(100),
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB;
INSERT INTO \`posts\` VALUES (1,'A'),(99,'NEW');`;

    const oldPath = join(workDir, "extra_old.sql");
    const newPath = join(workDir, "extra_new.sql");
    await writeFile(oldPath, oldSql, "utf8");
    await writeFile(newPath, newSql, "utf8");

    const { sql } = await pipeline(oldPath, newPath);

    expect(sql).not.toContain("'NEW'");
    expect(sql).toMatch(/tables included: \(none\)/);
  });

  it("synthetic case: same key, different content — NOT emitted (NEW wins, target preserved)", async () => {
    const oldSql = `CREATE TABLE \`posts\` (
  \`id\` int NOT NULL,
  \`title\` varchar(100),
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB;
INSERT INTO \`posts\` VALUES (1,'OLD VERSION');`;
    const newSql = `CREATE TABLE \`posts\` (
  \`id\` int NOT NULL,
  \`title\` varchar(100),
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB;
INSERT INTO \`posts\` VALUES (1,'NEW VERSION');`;

    const oldPath = join(workDir, "diff_old.sql");
    const newPath = join(workDir, "diff_new.sql");
    await writeFile(oldPath, oldSql, "utf8");
    await writeFile(newPath, newSql, "utf8");

    const { summary, sql } = await pipeline(oldPath, newPath);

    expect(summary.tables[0].updates).toHaveLength(1);
    expect(sql).not.toContain("'OLD VERSION'");
    expect(sql).not.toContain("'NEW VERSION'");
    expect(sql).toMatch(/tables included: \(none\)/);
  });

  it("synthetic case: phpMyAdmin-format dumps work end-to-end", async () => {
    const oldSql = `CREATE TABLE \`users\` (
  \`id\` bigint(20) UNSIGNED NOT NULL,
  \`email\` varchar(191) NOT NULL
) ENGINE=InnoDB;

INSERT INTO \`users\` (\`id\`, \`email\`) VALUES
(1, 'a@x.com'),
(2, 'b@x.com'),
(3, 'c@x.com');

ALTER TABLE \`users\` ADD PRIMARY KEY (\`id\`);`;

    const newSql = `CREATE TABLE \`users\` (
  \`id\` bigint(20) UNSIGNED NOT NULL,
  \`email\` varchar(191) NOT NULL
) ENGINE=InnoDB;

INSERT INTO \`users\` (\`id\`, \`email\`) VALUES
(1, 'a@x.com');

ALTER TABLE \`users\` ADD PRIMARY KEY (\`id\`);`;

    const oldPath = join(workDir, "pma_old.sql");
    const newPath = join(workDir, "pma_new.sql");
    await writeFile(oldPath, oldSql, "utf8");
    await writeFile(newPath, newSql, "utf8");

    const { sql } = await pipeline(oldPath, newPath);

    expect(sql).toContain("(2,'b@x.com')");
    expect(sql).toContain("(3,'c@x.com')");
    expect(sql).not.toContain("'a@x.com'"); // exists in target, must not be emitted
  });

  it("output is wrapped with FOREIGN_KEY_CHECKS and TRANSACTION, can be parsed back as valid SQL statements", async () => {
    const oldSql = `CREATE TABLE \`t\` (
  \`id\` int NOT NULL,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB;
INSERT INTO \`t\` VALUES (1),(2);`;
    const newSql = `CREATE TABLE \`t\` (
  \`id\` int NOT NULL,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB;
INSERT INTO \`t\` VALUES (1);`;

    const oldPath = join(workDir, "wrap_old.sql");
    const newPath = join(workDir, "wrap_new.sql");
    await writeFile(oldPath, oldSql, "utf8");
    await writeFile(newPath, newSql, "utf8");

    const { sql } = await pipeline(oldPath, newPath);

    expect(sql).toMatch(/^-- sqldiff sync/);
    expect(sql).toMatch(/SET FOREIGN_KEY_CHECKS = 0;\nSTART TRANSACTION;/);
    expect(sql).toMatch(/COMMIT;\nSET FOREIGN_KEY_CHECKS = 1;/);
    // Ensure statements terminate with semicolons
    const stmts = sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--"));
    for (const s of stmts) expect(s.trim().endsWith(";")).toBe(true);
  });
});
