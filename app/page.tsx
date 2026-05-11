"use client";

import { useEffect, useState } from "react";
import { UploadZone } from "@/components/UploadZone";
import { ProgressView } from "@/components/ProgressView";
import { DiffTableList, type DiffSummaryDto } from "@/components/DiffTableList";
import { LocaleToggle, useLocale } from "@/lib/i18n";

type JobDto = {
  id: string;
  status: "queued" | "parsing-old" | "parsing-new" | "diffing" | "done" | "error";
  progress: {
    currentTable: string | null;
    bytesRead: number;
    totalBytes: number;
    rowsSeen: number;
  };
  error?: string;
  summary?: DiffSummaryDto;
};

export default function Page() {
  const { t } = useLocale();
  const [oldFile, setOldFile] = useState<File | null>(null);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobDto | null>(null);

  const handleCompare = async () => {
    if (!oldFile || !newFile) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const fd = new FormData();
      fd.append("oldDump", oldFile);
      fd.append("newDump", newFile);
      const res = await fetch("/api/jobs", { method: "POST", body: fd });
      const body = await res.json();
      if (!res.ok) {
        setSubmitError(body?.error ?? t("error"));
        return;
      }
      setJobId(body.jobId);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : t("error"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = async () => {
    if (jobId) {
      await fetch(`/api/jobs/${jobId}`, { method: "DELETE" }).catch(() => {});
    }
    setJobId(null);
    setJob(null);
    setOldFile(null);
    setNewFile(null);
    setSubmitError(null);
  };

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        if (!res.ok) throw new Error("Job not found");
        const body: JobDto = await res.json();
        if (cancelled) return;
        setJob(body);
        if (body.status !== "done" && body.status !== "error") {
          timer = setTimeout(tick, 1500);
        }
      } catch (err) {
        if (cancelled) return;
        setJob({
          id: jobId,
          status: "error",
          progress: { currentTable: null, bytesRead: 0, totalBytes: 0, rowsSeen: 0 },
          error: err instanceof Error ? err.message : t("error"),
        });
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, t]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 md:py-16">
      <header className="flex items-baseline justify-between mb-10">
        <div>
          <h1 className="font-mono text-lg font-medium tracking-tight text-zinc-900">
            {t("title")}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-4">
          {jobId && (
            <button
              type="button"
              onClick={handleReset}
              className="text-xs text-zinc-500 hover:text-zinc-900 transition-colors"
            >
              {t("reset")}
            </button>
          )}
          <LocaleToggle />
        </div>
      </header>

      {!jobId && (
        <section className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <UploadZone
              label={t("oldLabel")}
              hint={t("oldHint")}
              file={oldFile}
              onFileChange={setOldFile}
            />
            <UploadZone
              label={t("newLabel")}
              hint={t("newHint")}
              file={newFile}
              onFileChange={setNewFile}
            />
          </div>

          {submitError && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700">
              {submitError}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleCompare}
              disabled={!oldFile || !newFile || submitting}
              className="
                inline-flex items-center gap-2 px-5 py-2 rounded-md
                bg-emerald-600 text-white font-medium text-sm
                hover:bg-emerald-500 transition-colors
                disabled:bg-zinc-200 disabled:text-zinc-400 disabled:cursor-not-allowed
              "
            >
              {submitting ? t("uploading") : t("compare")}
            </button>
          </div>
        </section>
      )}

      {jobId && job && (
        <section className="space-y-4">
          {job.status === "error" && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {job.error ?? t("error")}
            </div>
          )}

          {(job.status === "queued" ||
            job.status === "parsing-old" ||
            job.status === "parsing-new" ||
            job.status === "diffing") && (
            <ProgressView
              status={job.status}
              currentTable={job.progress.currentTable}
              bytesRead={job.progress.bytesRead}
              totalBytes={job.progress.totalBytes}
              rowsSeen={job.progress.rowsSeen}
            />
          )}

          {job.status === "done" && job.summary && (
            <DiffTableList jobId={jobId} summary={job.summary} />
          )}
        </section>
      )}
    </main>
  );
}
