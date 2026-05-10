import type { JobState } from "./types";

declare global {
  // Persist across hot reloads in Next dev mode.

  var __sqldiffJobs: Map<string, JobState> | undefined;
}

const jobs: Map<string, JobState> =
  globalThis.__sqldiffJobs ?? (globalThis.__sqldiffJobs = new Map());

export function createJob(state: JobState): void {
  jobs.set(state.id, state);
}

export function getJob(id: string): JobState | undefined {
  return jobs.get(id);
}

export function updateJob(id: string, patch: Partial<JobState>): JobState | undefined {
  const current = jobs.get(id);
  if (!current) return undefined;
  const next = { ...current, ...patch } as JobState;
  jobs.set(id, next);
  return next;
}

export function deleteJob(id: string): boolean {
  return jobs.delete(id);
}

export function listJobs(): JobState[] {
  return Array.from(jobs.values());
}
