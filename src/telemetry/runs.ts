import { storage } from "@/src/utils/storage";

import { RunRecord, RunSummary } from "./types";

// Each run's track lives in its own key (keeps every entry small on Android).
const INDEX_KEY = "mtb_runs_index";
const COUNTER_KEY = "mtb_run_counter";
const runKey = (id: string) => `mtb_run_${id}`;

export async function listRuns(): Promise<RunSummary[]> {
  const raw = await storage.getItem(INDEX_KEY, "[]");
  try {
    return JSON.parse(String(raw ?? "[]")) as RunSummary[];
  } catch {
    return [];
  }
}

export async function getRun(id: string): Promise<RunRecord | null> {
  const raw = await storage.getItem(runKey(id), null);
  if (!raw) return null;
  try {
    return JSON.parse(String(raw)) as RunRecord;
  } catch {
    return null;
  }
}

export async function saveRun(
  data: Omit<RunRecord, "id" | "number" | "name">,
): Promise<RunRecord> {
  const last = Number((await storage.getItem(COUNTER_KEY, 0)) ?? 0);
  const number = last + 1;
  const id = `${data.startedAt}_${number}`;
  const record: RunRecord = { ...data, id, number, name: `Run #${number}` };
  const ok = await storage.setItem(runKey(id), JSON.stringify(record));
  if (!ok) throw new Error("Storage full or unavailable");
  const { track: _t, jumps: _j, ...summary } = record;
  const index = await listRuns();
  index.unshift(summary);
  if (!(await storage.setItem(INDEX_KEY, JSON.stringify(index)))) {
    await storage.removeItem(runKey(id));
    throw new Error("Storage full or unavailable");
  }
  await storage.setItem(COUNTER_KEY, number);
  return record;
}

export async function deleteRun(id: string): Promise<void> {
  await storage.removeItem(runKey(id));
  const index = (await listRuns()).filter((r) => r.id !== id);
  await storage.setItem(INDEX_KEY, JSON.stringify(index));
}
