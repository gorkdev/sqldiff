"use client";

type Props = {
  status: "queued" | "parsing-old" | "parsing-new" | "diffing";
  currentTable: string | null;
  bytesRead: number;
  totalBytes: number;
  rowsSeen: number;
};

const LABELS: Record<Props["status"], string> = {
  queued: "Queued…",
  "parsing-old": "Parsing old dump",
  "parsing-new": "Parsing new dump",
  diffing: "Computing diff",
};

export function ProgressView({
  status,
  currentTable,
  bytesRead,
  totalBytes,
  rowsSeen,
}: Props) {
  const pct =
    status === "diffing"
      ? 100
      : totalBytes > 0
      ? Math.min(100, Math.round((bytesRead / totalBytes) * 100))
      : 0;

  return (
    <section className="rounded-lg border border-zinc-200 bg-white px-6 py-5">
      <div className="flex items-baseline justify-between gap-4 mb-4">
        <h2 className="text-sm font-medium text-zinc-900">{LABELS[status]}</h2>
        <span className="font-mono text-xs text-zinc-500">{pct}%</span>
      </div>

      <div className="h-1 rounded-full bg-zinc-100 overflow-hidden">
        <div
          className="h-full bg-emerald-600 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>

      <dl className="mt-5 grid grid-cols-3 gap-4 text-xs">
        <div>
          <dt className="text-zinc-500 uppercase tracking-wider">Current table</dt>
          <dd className="mt-1 font-mono text-zinc-900">
            {currentTable ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500 uppercase tracking-wider">Rows seen</dt>
          <dd className="mt-1 font-mono text-zinc-900">
            {rowsSeen.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500 uppercase tracking-wider">Read</dt>
          <dd className="mt-1 font-mono text-zinc-900">
            {formatBytes(bytesRead)} / {formatBytes(totalBytes)}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
