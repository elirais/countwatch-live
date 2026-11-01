// SR-2: the past 30 days of the same 20 watches, from each wiki's recent-changes API, as CountWatch import entries.
// Pure parts here (tested in Node); scripts/import-wiki.ts does the I/O. The counts match the live reader's: edits and
// new pages, by the edit's own time, human or bot (ADR 0066 #4 in elirais/Magnum).
import { BUCKET_MS, EDITORS, type Editor, METRIC, WIKIS } from "./config.ts";
import { bucketOf } from "./count.ts";

/** enwiki → en.wikipedia.org (the ten watched wikis are all language Wikipedias). */
export const hostOf = (wiki: string) => `${wiki.replace(/wiki$/, "")}.wikipedia.org`;

/** One page of `list=recentchanges` (formatversion 2): each change's time and whether a bot made it. */
export interface RcChange {
  type?: string;
  timestamp: string;
  bot?: boolean;
}

/** The API URL for one page, from `from` to `to` (oldest first), continuing from `cont` when given. */
export function rcUrl(wiki: string, from: number, to: number, cont: Record<string, string> | null): string {
  const p = new URLSearchParams({
    action: "query",
    list: "recentchanges",
    rctype: "edit|new",
    rcprop: "timestamp|flags",
    rclimit: "500",
    rcdir: "newer",
    rcstart: new Date(from).toISOString(),
    rcend: new Date(to - 1000).toISOString(),
    format: "json",
    formatversion: "2",
    maxlag: "5",
    ...(cont ?? {}),
  });
  return `https://${hostOf(wiki)}/w/api.php?${p}`;
}

/** Per-wiki 5-minute counts: `${bucket}|${editor}` → n. */
export type WikiCounts = Map<string, number>;

/** Adds one page of changes; returns the oldest change time seen on it (null for an empty page). */
export function addChanges(counts: WikiCounts, changes: readonly RcChange[]): number | null {
  let oldest: number | null = null;
  for (const c of changes) {
    if (c.type !== undefined && c.type !== "edit" && c.type !== "new") continue;
    const at = Date.parse(c.timestamp);
    if (!Number.isFinite(at)) continue;
    const editor: Editor = c.bot === true ? "bot" : "human";
    const key = `${bucketOf(at)}|${editor}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (oldest === null || at < oldest) oldest = at;
  }
  return oldest;
}

/** Where history is complete. The API keeps only so many days: if the first change returned is much later than asked
 * for, the wiki's history starts there, and the first window kept is the first whole one after it (missing before it,
 * never zeros). */
export function coveredStart(askedFrom: number, firstChange: number | null): number {
  const from = bucketOf(askedFrom) === askedFrom ? askedFrom : bucketOf(askedFrom) + BUCKET_MS;
  if (firstChange === null || firstChange - askedFrom < 60 * 60_000) return from;
  return bucketOf(firstChange) + BUCKET_MS;
}

export interface ImportWatch {
  metric: string;
  tags: { wiki: string; editor: string };
  start: string;
  resolution: "5m";
  counts: number[];
}

/** The two import entries (human, bot) of one wiki: every 5-minute window from `start` to `end`, zeros included. */
export function watchesOf(wiki: string, counts: WikiCounts, start: number, end: number): ImportWatch[] {
  const n = Math.max(0, (end - start) / BUCKET_MS);
  return EDITORS.map((editor) => ({
    metric: METRIC,
    tags: { wiki, editor },
    start: new Date(start).toISOString(),
    resolution: "5m" as const,
    counts: Array.from({ length: n }, (_, i) => counts.get(`${start + i * BUCKET_MS}|${editor}`) ?? 0),
  }));
}

export { WIKIS };
