import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseDump } from "../parser";

let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "sqldiff-parser-"));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function dump(name: string, content: string): Promise<string> {
  const path = join(workDir, `${name}.sql`);
  await writeFile(path, content, "utf8");
  return path;
}

describe("parseDump — mysqldump extended-insert format", () => {
  it("parses single-line INSERT with multiple tuples", async () => {
    const path = await dump(
      "single",
      `CREATE TABLE \`posts\` (
  \`id\` int NOT NULL,
  \`title\` varchar(100) NOT NULL,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB;

INSERT INTO \`posts\` (\`id\`,\`title\`) VALUES (1,'A'),(2,'B'),(3,'C');
`
    );
    const snap = await parseDump(path);
    const posts = snap.get("posts");
    expect(posts).toBeDefined();
    expect(posts!.rows.size).toBe(3);
    expect(posts!.pkColumns).toEqual(["id"]);
    expect(posts!.rows.get("1")?.values).toContain("'A'");
  });
});

describe("parseDump — phpMyAdmin multi-line INSERT format", () => {
  it("parses multi-line INSERT where tuples are on separate lines", async () => {
    const path = await dump(
      "phpmyadmin",
      `CREATE TABLE \`admins\` (
  \`id\` bigint(20) UNSIGNED NOT NULL,
  \`name\` varchar(191) NOT NULL,
  \`email\` varchar(191) NOT NULL
) ENGINE=InnoDB;

INSERT INTO \`admins\` (\`id\`, \`name\`, \`email\`) VALUES
(1, 'alice', 'alice@x.com'),
(6, 'bob', 'bob@x.com'),
(13, 'gorkem', 'g@x.com');

ALTER TABLE \`admins\`
  ADD PRIMARY KEY (\`id\`);
`
    );
    const snap = await parseDump(path);
    const admins = snap.get("admins");
    expect(admins).toBeDefined();
    expect(admins!.rows.size).toBe(3);
    expect(admins!.pkColumns).toEqual(["id"]);
    expect(admins!.rows.get("1")?.values).toContain("'alice'");
    expect(admins!.rows.get("13")?.values).toContain("'gorkem'");
  });

  it("retroactively reindexes rows when ALTER TABLE ADD PRIMARY KEY follows INSERTs", async () => {
    // INSERT comes BEFORE the PK is known. Without reindex, rows would be keyed by the full tuple.
    const path = await dump(
      "reindex",
      `CREATE TABLE \`users\` (
  \`id\` int NOT NULL,
  \`email\` varchar(100) NOT NULL
);

INSERT INTO \`users\` (\`id\`, \`email\`) VALUES
(1, 'a@x.com'),
(2, 'b@x.com');

ALTER TABLE \`users\` ADD PRIMARY KEY (\`id\`);
`
    );
    const snap = await parseDump(path);
    const users = snap.get("users");
    expect(users!.rows.size).toBe(2);
    expect(users!.pkColumns).toEqual(["id"]);
    // After reindex, rowKey should be just the PK value, not full tuple
    expect(users!.rows.has("1")).toBe(true);
    expect(users!.rows.has("2")).toBe(true);
    expect(users!.rows.get("1")?.pkValues).toEqual(["1"]);
  });

  it("supports composite primary keys from ALTER TABLE", async () => {
    const path = await dump(
      "composite",
      `CREATE TABLE \`user_roles\` (
  \`user_id\` int NOT NULL,
  \`role_id\` int NOT NULL,
  \`granted_at\` datetime NOT NULL
);

INSERT INTO \`user_roles\` VALUES
(1, 5, '2026-01-01 00:00:00'),
(2, 5, '2026-01-02 00:00:00');

ALTER TABLE \`user_roles\` ADD PRIMARY KEY (\`user_id\`,\`role_id\`);
`
    );
    const snap = await parseDump(path);
    const t = snap.get("user_roles");
    expect(t!.pkColumns).toEqual(["user_id", "role_id"]);
    expect(t!.rows.has("1 5")).toBe(true);
    expect(t!.rows.has("2 5")).toBe(true);
  });
});

describe("parseDump — quoting and escape edge cases", () => {
  it("handles backslash-escaped quotes inside string values", async () => {
    const path = await dump(
      "escape1",
      `CREATE TABLE \`t\` (
  \`id\` int NOT NULL,
  \`s\` varchar(100),
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB;
INSERT INTO \`t\` VALUES (1,'O\\'Brien');
`
    );
    const snap = await parseDump(path);
    expect(snap.get("t")!.rows.size).toBe(1);
  });

  it("handles doubled-quote escaped strings", async () => {
    const path = await dump(
      "escape2",
      `CREATE TABLE \`t\` (
  \`id\` int NOT NULL,
  \`s\` varchar(100),
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB;
INSERT INTO \`t\` VALUES (1,'O''Brien');
`
    );
    const snap = await parseDump(path);
    expect(snap.get("t")!.rows.size).toBe(1);
  });

  it("handles hex literals (0x...) and NULL as raw values", async () => {
    const path = await dump(
      "hex",
      `CREATE TABLE \`b\` (
  \`id\` int NOT NULL,
  \`data\` blob,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB;
INSERT INTO \`b\` VALUES (1,0xDEADBEEF),(2,NULL),(3,_binary 0xCAFE);
`
    );
    const snap = await parseDump(path);
    const t = snap.get("b")!;
    expect(t.rows.size).toBe(3);
    expect(t.rows.get("1")?.values).toContain("0xDEADBEEF");
    expect(t.rows.get("2")?.values).toContain("NULL");
  });
});

describe("parseDump — robustness", () => {
  it("returns empty snapshot on empty file", async () => {
    const path = await dump("empty", "");
    const snap = await parseDump(path);
    expect(snap.size).toBe(0);
  });

  it("ignores CREATE VIEW and trigger bodies", async () => {
    const path = await dump(
      "trigger",
      `CREATE VIEW \`v\` AS SELECT 1 AS id;

CREATE TABLE \`real\` (
  \`id\` int NOT NULL,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB;
INSERT INTO \`real\` VALUES (1);

DELIMITER ;;
CREATE TRIGGER \`tr\` AFTER INSERT ON \`real\` FOR EACH ROW BEGIN
  INSERT INTO \`audit\` VALUES (NEW.id);
END ;;
DELIMITER ;
`
    );
    const snap = await parseDump(path);
    expect(snap.has("v")).toBe(false);
    expect(snap.has("audit")).toBe(false);
    expect(snap.get("real")!.rows.size).toBe(1);
  });

  it("supports CREATE TABLE IF NOT EXISTS", async () => {
    const path = await dump(
      "ifnotexists",
      `CREATE TABLE IF NOT EXISTS \`t\` (
  \`id\` int NOT NULL,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB;
INSERT INTO \`t\` VALUES (1);
`
    );
    const snap = await parseDump(path);
    expect(snap.get("t")!.rows.size).toBe(1);
  });

  it("captures the raw CREATE TABLE block as createSql", async () => {
    const path = await dump(
      "createsql",
      `CREATE TABLE \`posts\` (
  \`id\` int NOT NULL AUTO_INCREMENT,
  \`title\` varchar(255) NOT NULL,
  \`body\` text,
  PRIMARY KEY (\`id\`),
  KEY \`idx_title\` (\`title\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`
    );
    const snap = await parseDump(path);
    const t = snap.get("posts")!;
    expect(t.createSql).toBeDefined();
    expect(t.createSql).toContain("CREATE TABLE `posts`");
    expect(t.createSql).toContain("AUTO_INCREMENT");
    expect(t.createSql).toContain("PRIMARY KEY (`id`)");
    expect(t.createSql).toContain("KEY `idx_title`");
    expect(t.createSql).toContain("ENGINE=InnoDB");
  });
});
