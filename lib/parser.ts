import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import type { DumpSnapshot, ParseProgress, RowData, TableSnapshot } from "./types";

export type ParserHooks = {
  onProgress?: (progress: ParseProgress) => void;
  progressIntervalBytes?: number;
};

const CREATE_TABLE_RE = /^CREATE TABLE (?:IF NOT EXISTS\s+)?[`"]([^`"]+)[`"]\s*\(/i;
const COLUMN_RE = /^\s*[`"]([^`"]+)[`"]\s+/;
const PRIMARY_KEY_RE = /^\s*PRIMARY KEY\s*\(([^)]+)\)/i;
const TABLE_END_RE = /^\)\s*(ENGINE|;)/i;
const INSERT_RE = /^INSERT INTO [`"]([^`"]+)[`"](?:\s*\(([^)]+)\))?\s*VALUES\s*/i;
const ALTER_TABLE_RE = /^ALTER TABLE [`"]([^`"]+)[`"]/i;
const ADD_PRIMARY_KEY_RE = /ADD\s+PRIMARY\s+KEY\s*\(([^)]+)\)/i;

export async function parseDump(
  filePath: string,
  hooks: ParserHooks = {}
): Promise<DumpSnapshot> {
  const stats = await stat(filePath);
  const totalBytes = stats.size;
  const progressInterval = hooks.progressIntervalBytes ?? 2 * 1024 * 1024;

  const snapshot: DumpSnapshot = new Map();
  const tableMeta = new Map<string, { columns: string[]; pkColumns: string[] }>();

  const stream = createReadStream(filePath, { encoding: "utf8", highWaterMark: 1 << 16 });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let bytesRead = 0;
  let lastReportedBytes = 0;
  let rowsSeen = 0;
  let currentTable: string | null = null;

  let inCreate: {
    name: string;
    columns: string[];
    pkColumns: string[];
    rawLines: string[];
  } | null = null;
  let inInsert: { tableName: string; explicitColumns: string[] | null; buffer: string } | null = null;
  let inAlter: { tableName: string; buffer: string } | null = null;

  const reportProgress = (force = false) => {
    if (!hooks.onProgress) return;
    if (!force && bytesRead - lastReportedBytes < progressInterval) return;
    lastReportedBytes = bytesRead;
    hooks.onProgress({ currentTable, bytesRead, totalBytes, rowsSeen });
  };

  const flushInsert = (state: NonNullable<typeof inInsert>) => {
    const { tableName, explicitColumns, buffer } = state;
    let snap = snapshot.get(tableName);
    if (!snap) {
      const meta = tableMeta.get(tableName);
      snap = {
        table: tableName,
        columns: explicitColumns ?? meta?.columns ?? [],
        pkColumns: meta?.pkColumns ?? [],
        rows: new Map(),
      };
      snapshot.set(tableName, snap);
    } else if (explicitColumns && snap.columns.length === 0) {
      snap.columns = explicitColumns;
    }

    const cols = explicitColumns ?? snap.columns;
    const pkColumns = snap.pkColumns;

    for (const tuple of iterateTuples(buffer)) {
      const pkValues = pkColumns.length
        ? pkColumns.map((pk) => {
            const idx = cols.indexOf(pk);
            return idx >= 0 ? tuple[idx] : "";
          })
        : tuple;
      const rowKey = pkValues.join(" ");
      const valuesJoined = tuple.join(",");
      const hash = createHash("md5").update(valuesJoined).digest("hex");
      const row: RowData = {
        hash,
        values: valuesJoined,
        columns: cols,
        pkColumns,
        pkValues,
      };
      snap.rows.set(rowKey, row);
      rowsSeen++;
    }
  };

  const flushAlter = (state: NonNullable<typeof inAlter>) => {
    const { tableName, buffer } = state;
    const pkMatch = buffer.match(ADD_PRIMARY_KEY_RE);
    if (!pkMatch) return;
    const pkColumns = pkMatch[1]
      .split(",")
      .map((s) => s.trim().replace(/^[`"]|[`"]$/g, ""));
    const meta = tableMeta.get(tableName);
    if (meta) meta.pkColumns = pkColumns;
    const snap = snapshot.get(tableName);
    if (!snap) return;
    snap.pkColumns = pkColumns;
    if (snap.rows.size === 0) return;
    // Reindex rows: previous rowKey was full-tuple fallback; rebuild with new PK.
    const oldRows = Array.from(snap.rows.values());
    const newMap = new Map<string, RowData>();
    for (const row of oldRows) {
      const tuple = splitTupleValues(row.values);
      const pkValues = pkColumns.map((pk) => {
        const idx = row.columns.indexOf(pk);
        return idx >= 0 ? tuple[idx] : "";
      });
      const newKey = pkValues.join(" ");
      newMap.set(newKey, { ...row, pkColumns, pkValues });
    }
    snap.rows = newMap;
  };

  for await (const line of rl) {
    bytesRead += Buffer.byteLength(line, "utf8") + 1;

    if (inInsert) {
      inInsert.buffer += " " + line;
      if (line.trimEnd().endsWith(";")) {
        flushInsert(inInsert);
        inInsert = null;
        reportProgress();
      }
      continue;
    }

    if (inAlter) {
      inAlter.buffer += " " + line;
      if (line.trimEnd().endsWith(";")) {
        flushAlter(inAlter);
        inAlter = null;
      }
      continue;
    }

    if (inCreate) {
      inCreate.rawLines.push(line);
      if (TABLE_END_RE.test(line)) {
        tableMeta.set(inCreate.name, {
          columns: inCreate.columns,
          pkColumns: inCreate.pkColumns,
        });
        snapshot.set(inCreate.name, {
          table: inCreate.name,
          columns: inCreate.columns,
          pkColumns: inCreate.pkColumns,
          rows: new Map(),
          createSql: inCreate.rawLines.join("\n"),
        });
        inCreate = null;
        continue;
      }
      const pkMatch = line.match(PRIMARY_KEY_RE);
      if (pkMatch) {
        inCreate.pkColumns = pkMatch[1]
          .split(",")
          .map((s) => s.trim().replace(/^[`"]|[`"]$/g, ""));
        continue;
      }
      if (/^\s*(KEY|UNIQUE KEY|INDEX|FULLTEXT|SPATIAL|CONSTRAINT|FOREIGN KEY)\b/i.test(line)) {
        continue;
      }
      const colMatch = line.match(COLUMN_RE);
      if (colMatch) {
        inCreate.columns.push(colMatch[1]);
      }
      continue;
    }

    const createMatch = line.match(CREATE_TABLE_RE);
    if (createMatch) {
      inCreate = {
        name: createMatch[1],
        columns: [],
        pkColumns: [],
        rawLines: [line],
      };
      currentTable = createMatch[1];
      reportProgress(true);
      continue;
    }

    const insertMatch = line.match(INSERT_RE);
    if (insertMatch) {
      const tableName = insertMatch[1];
      currentTable = tableName;
      const explicitColumns = insertMatch[2]
        ? insertMatch[2].split(",").map((s) => s.trim().replace(/^[`"]|[`"]$/g, ""))
        : null;
      const rest = line.slice(insertMatch[0].length);
      const state = { tableName, explicitColumns, buffer: rest };
      if (rest.trimEnd().endsWith(";")) {
        flushInsert(state);
        reportProgress();
      } else {
        inInsert = state;
      }
      continue;
    }

    const alterMatch = line.match(ALTER_TABLE_RE);
    if (alterMatch) {
      const tableName = alterMatch[1];
      const rest = line.slice(alterMatch[0].length);
      const state = { tableName, buffer: rest };
      if (line.trimEnd().endsWith(";")) {
        flushAlter(state);
      } else {
        inAlter = state;
      }
      continue;
    }

    reportProgress();
  }

  if (inInsert) {
    flushInsert(inInsert);
    inInsert = null;
  }
  if (inAlter) {
    flushAlter(inAlter);
    inAlter = null;
  }

  reportProgress(true);
  return snapshot;
}

export function* iterateTuples(input: string): Generator<string[]> {
  let i = 0;
  const n = input.length;
  while (i < n) {
    while (i < n && input[i] !== "(") i++;
    if (i >= n) return;
    const end = findMatchingParen(input, i);
    if (end < 0) return;
    yield splitTupleValues(input.slice(i + 1, end));
    i = end + 1;
  }
}

function findMatchingParen(s: string, start: number): number {
  let i = start + 1;
  const n = s.length;
  while (i < n) {
    const ch = s[i];
    if (ch === "'") {
      i = skipSingleQuoted(s, i);
    } else if (ch === '"') {
      i = skipDoubleQuoted(s, i);
    } else if (ch === ")") {
      return i;
    } else {
      i++;
    }
  }
  return -1;
}

function skipSingleQuoted(s: string, start: number): number {
  let i = start + 1;
  const n = s.length;
  while (i < n) {
    const ch = s[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "'") {
      if (s[i + 1] === "'") {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i++;
  }
  return n;
}

function skipDoubleQuoted(s: string, start: number): number {
  let i = start + 1;
  const n = s.length;
  while (i < n) {
    const ch = s[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === '"') {
      if (s[i + 1] === '"') {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i++;
  }
  return n;
}

export function splitTupleValues(content: string): string[] {
  const out: string[] = [];
  let buf = "";
  let i = 0;
  const n = content.length;
  while (i < n) {
    const ch = content[i];
    if (ch === "'") {
      const end = skipSingleQuoted(content, i);
      buf += content.slice(i, end);
      i = end;
    } else if (ch === '"') {
      const end = skipDoubleQuoted(content, i);
      buf += content.slice(i, end);
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

export function snapshotTableNames(snap: DumpSnapshot): string[] {
  return Array.from(snap.keys()).sort();
}

export function getTable(snap: DumpSnapshot, name: string): TableSnapshot | undefined {
  return snap.get(name);
}
