// The ingest body for one flush: every watched (wiki, editor) for every closed 5-minute window not yet accepted, plus
// the last 30 minutes again, as the window's total (`set`), zeros included. Resending a window is safe: `set` replaces it.
import { BUCKET_MS, EDITORS, MAX_AGE_MS, METRIC, RESEND_MS, WIKIS } from "./config.ts";
import { bucketOf, countKey } from "./count.ts";

export interface Point {
  metric: string;
  tags: { wiki: string; editor: string };
  ts: string;
  set: number;
}

export interface Span {
  /** The newest event time read from the stream (not the clock): only windows that ended by it are sent, so a stuck
   * stream sends nothing and CountWatch sees missing data (Silence), never made-up zeros. */
  until: number;
  /** Since when the reader has seen the stream without a break: windows that start before it are unknown, not sent. */
  coveredFrom: number;
  /** End of the last window CountWatch accepted (null: none yet). Windows from it on are sent even when older than 30
   * minutes, so a CountWatch outage or a long stream backlog loses nothing. */
  sentUntil: number | null;
  now: number;
}

/** First window sent: the last 30 minutes (late events), back to what was not yet accepted, never before the covered
 * time or older than CountWatch takes. */
export function firstWindow(s: Span): number {
  const resend = Math.min(bucketOf(s.until - RESEND_MS), s.sentUntil ?? Number.POSITIVE_INFINITY);
  return Math.max(resend, Math.ceil(s.coveredFrom / BUCKET_MS) * BUCKET_MS, Math.ceil((s.now - MAX_AGE_MS) / BUCKET_MS) * BUCKET_MS);
}

/** The last window sent: the newest one that ended by `until`. */
export const lastWindow = (s: Span) => bucketOf(s.until) - BUCKET_MS;

export function buildPoints(counts: ReadonlyMap<string, number>, span: Span): Point[] {
  const points: Point[] = [];
  for (let b = firstWindow(span); b <= lastWindow(span); b += BUCKET_MS) {
    const ts = new Date(b).toISOString();
    for (const wiki of WIKIS) for (const editor of EDITORS) points.push({ metric: METRIC, tags: { wiki, editor }, ts, set: counts.get(countKey(b, wiki, editor)) ?? 0 });
  }
  return points;
}

/** Drop counts of windows older than `keepFrom`. */
export function prune(counts: Map<string, number>, keepFrom: number): void {
  for (const key of counts.keys()) if (Number(key.slice(0, key.indexOf("|"))) < keepFrom) counts.delete(key);
}
