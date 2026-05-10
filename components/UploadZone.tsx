"use client";

import { useRef, useState } from "react";

type Props = {
  label: string;
  file: File | null;
  onFileChange: (file: File | null) => void;
};

export function UploadZone({ label, file, onFileChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const openPicker = () => inputRef.current?.click();

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) onFileChange(dropped);
  };

  return (
    <div
      onClick={file ? undefined : openPicker}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={`
        relative rounded-lg border border-dashed transition-colors
        ${dragOver ? "border-emerald-500 bg-emerald-50" : "border-zinc-300 hover:border-zinc-400 bg-white"}
        ${file ? "cursor-default" : "cursor-pointer"}
        h-44 px-6 py-5 flex flex-col justify-between
      `}
    >
      <span className="text-xs uppercase tracking-wider text-zinc-500">
        {label}
      </span>

      {file ? (
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-sm text-zinc-900 truncate">
              {file.name}
            </div>
            <div className="text-xs text-zinc-500 mt-0.5">
              {formatBytes(file.size)}
            </div>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onFileChange(null);
            }}
            className="text-xs text-zinc-500 hover:text-zinc-900 transition-colors"
          >
            remove
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-1">
          <span className="text-sm text-zinc-700">drop or click</span>
          <span className="text-xs text-zinc-400">.sql</span>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".sql,application/sql,text/plain"
        onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
        className="hidden"
      />
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
