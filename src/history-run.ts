// SR-2 I/O, kept out of the pure parts: page through one wiki's recent changes politely, send the import, wait for the
// replay. Plain fetch (Node 22+); the script in scripts/import-wiki.ts wires the real fetch and prints.
import { USER_AGENT } from "./config.ts";
import { addChanges, type RcChange, rcUrl, type WikiCounts } from "./history.ts";
import type { ImportWatch } from "./history.ts";

export interface Io {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

/** Every edit and new page of `wiki` from `from` to `to`, counted per window. One request at a time, as Wikimedia asks;
 * waits and retries when the API says it is lagged or busy. Returns the counts and the first change's time. */
export async function fetchWikiHistory(wiki: string, from: number, to: number, io: Io): Promise<{ counts: WikiCounts; first: number | null; pages: number; changes: number }> {
  const counts: WikiCounts = new Map();
  let first: number | null = null;
  let cont: Record<string, string> | null = null;
  let pages = 0;
  let changes = 0;
  let tries = 0;
  for (;;) {
    type Page = { error?: { code?: string }; query?: { recentchanges?: RcChange[] }; continue?: Record<string, string> };
    let res: Response | null = null;
    let body: Page | null = null;
    let code = "";
    try {
      res = await io.fetch(rcUrl(wiki, from, to, cont), { headers: { "user-agent": USER_AGENT, "api-user-agent": USER_AGENT } });
      body = res.ok ? ((await res.json()) as Page) : null;
      code = body?.error?.code ?? (res.ok ? "" : `HTTP ${res.status}`);
    } catch (err) {
      code = `network: ${(err as Error).message}`; // a dropped connection is retried like a busy API
    }
    if (code) {
      if (++tries > 8) throw new Error(`${wiki}: the recent-changes API kept failing (${code})`);
      const wait = Number(res?.headers.get("retry-after")) * 1000 || 5_000 * tries;
      io.log(`${wiki}: ${code}, waiting ${Math.round(wait / 1000)} s`);
      await io.sleep(wait);
      continue;
    }
    tries = 0;
    const page = body?.query?.recentchanges ?? [];
    const oldest = addChanges(counts, page);
    if (first === null && oldest !== null) first = oldest;
    pages++;
    changes += page.length;
    if (pages % 50 === 0) io.log(`${wiki}: ${changes.toLocaleString("en-US")} changes so far, at ${page.at(-1)?.timestamp ?? "?"}`);
    if (!body?.continue) break;
    cont = body.continue;
  }
  return { counts, first, pages, changes };
}

export interface CountWatchApi {
  url: string;
  key: string;
}

/** CountWatch refuses an import body over 2 MB (413) and over 1,000 watch-days per request: the watches split into
 * requests that fit both, whole watches only, in order. */
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const IMPORT_MAX_WATCH_DAYS = 1000;
export function splitImport(watches: ImportWatch[], maxBytes = IMPORT_MAX_BYTES - 64 * 1024, maxWatchDays = IMPORT_MAX_WATCH_DAYS): ImportWatch[][] {
  const out: ImportWatch[][] = [];
  let cur: ImportWatch[] = [];
  let bytes = 0;
  let days = 0;
  for (const w of watches) {
    const b = JSON.stringify(w).length + 1;
    const d = Math.ceil(w.counts.length / 288);
    if (cur.length && (bytes + b > maxBytes || days + d > maxWatchDays)) {
      out.push(cur);
      cur = [];
      bytes = 0;
      days = 0;
    }
    cur.push(w);
    bytes += b;
    days += d;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** POST /v1/import; returns the parsed 202 body, or throws with CountWatch's own problem text. */
export async function sendImport(api: CountWatchApi, watches: ImportWatch[], io: Io): Promise<{ import_id: string; stored: { index: number; watch_id: string }[]; rejected: unknown[] }> {
  const body = JSON.stringify({ watches, recipe: "import" });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  const key = [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
  const res = await io.fetch(new URL("/v1/import", api.url), {
    method: "POST",
    headers: { authorization: `Bearer ${api.key}`, "content-type": "application/json", "idempotency-key": `wiki-import-${key}`, "user-agent": USER_AGENT },
    body,
  });
  const text = await res.text();
  if (res.status !== 202) throw new Error(`POST /v1/import answered ${res.status}: ${text.slice(0, 1000)}`);
  return JSON.parse(text);
}

export interface ImportStatus {
  status: "replay_pending" | "replaying" | "done";
  progress: { done: number; total: number };
  watches: { watch_id: string; metric: string | null; tags: Record<string, string>; replay: null | { status: string; reason: string; replay_days: number; alerts_per_month: number; rules: { name: string; direction: string }[]; alerts: { at: string; rule: { name: string }; observed: number; usual: number; observed_times_usual: number | null }[] } }[];
}

/** Polls GET /v1/imports/{id} until done (or the time is up). */
export async function waitForImport(api: CountWatchApi, id: string, io: Io, timeoutMs = 30 * 60_000, everyMs = 5_000): Promise<ImportStatus> {
  let waited = 0;
  let said = "";
  for (;;) {
    const res = await io.fetch(new URL(`/v1/imports/${id}`, api.url), { headers: { authorization: `Bearer ${api.key}`, "user-agent": USER_AGENT } });
    const text = await res.text();
    if (res.status !== 200) throw new Error(`GET /v1/imports/${id} answered ${res.status}: ${text.slice(0, 500)}`);
    const s = JSON.parse(text) as ImportStatus;
    const line = `${s.status} ${s.progress.done}/${s.progress.total}`;
    if (line !== said) io.log(`import ${id}: ${line}`);
    said = line;
    if (s.status === "done") return s;
    if (waited >= timeoutMs) throw new Error(`import ${id} not done after ${timeoutMs / 60_000} min (last: ${line})`);
    await io.sleep(everyMs);
    waited += everyMs;
  }
}
