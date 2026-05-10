export type RowKey = string;
export type RowHash = string;

export type RowData = {
  hash: RowHash;
  values: string;
  columns: string[];
  pkColumns: string[];
  pkValues: string[];
};

export type TableSnapshot = {
  table: string;
  columns: string[];
  pkColumns: string[];
  rows: Map<RowKey, RowData>;
};

export type DumpSnapshot = Map<string, TableSnapshot>;

export type RowChangeKind = "insert" | "update" | "delete";

export type RowChange = {
  kind: RowChangeKind;
  pkValues: string[];
  oldRow?: RowData;
  newRow?: RowData;
};

export type TableDiff = {
  table: string;
  columns: string[];
  pkColumns: string[];
  inserts: RowChange[];
  updates: RowChange[];
  deletes: RowChange[];
};

export type DiffSummary = {
  oldFileName: string;
  newFileName: string;
  oldFileSize: number;
  newFileSize: number;
  generatedAt: string;
  tables: TableDiff[];
};

export type ParseProgress = {
  currentTable: string | null;
  bytesRead: number;
  totalBytes: number;
  rowsSeen: number;
};

export type JobStatus =
  | "queued"
  | "parsing-old"
  | "parsing-new"
  | "diffing"
  | "done"
  | "error";

export type JobState = {
  id: string;
  status: JobStatus;
  oldFile: { name: string; size: number; path: string };
  newFile: { name: string; size: number; path: string };
  progress: ParseProgress;
  summary?: DiffSummary;
  error?: string;
  createdAt: number;
};
