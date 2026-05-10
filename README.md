# sqldiff

Compare two MySQL dumps. Extract only what changed.

Use case: you pull production into local, work on the codebase for a day or two, and during that time prod gets new data (orders, comments, members, …). `sqldiff` takes the **old** prod snapshot and the **new** prod snapshot, computes the difference per table, and gives you a single `sync.sql` file that you can apply on your local DB.

## Run

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

1. Drop the **old** dump (the snapshot you took when you started working locally).
2. Drop the **new** dump (the current production snapshot).
3. Hit **Compare**.
4. Review the per-table summary, tick the tables you want to sync, and download `sync.sql`.
5. Apply on your local DB: `mysql -u root -p mydb < sync.sql`.

## How it works

- Streaming line-by-line parser reads each `mysqldump` file, extracts `CREATE TABLE` definitions (column list + primary key) and every `INSERT INTO ... VALUES (...)` tuple.
- Each row is hashed (`md5(values)`) and indexed by its primary key.
- The differ compares the two per-table snapshots: present in new only → **insert**, present in old only → **delete**, same key but different hash → **update**.
- Output `sync.sql` is wrapped in `SET FOREIGN_KEY_CHECKS=0; START TRANSACTION; … COMMIT;` so child rows can reference parent rows that are still pending in the same batch. Updates are emitted as `DELETE` + `INSERT` for safety.

## Try with the bundled fixtures

`test/fixtures/old.sql` and `test/fixtures/new.sql` are small `mysqldump`-format files with realistic differences across 6 tables. Drop them in to see the tool end-to-end without needing your own database.

## Notes

- Tables without a primary key are still detected, but `UPDATE`/`DELETE` may match unintended rows. The UI flags them with a `no pk` badge.
- Schema differences (added/dropped columns, changed types) are not handled — this tool focuses on **row data**, not DDL.
- The dev server's process holds parsed snapshots in memory; restarting drops in-flight jobs.
