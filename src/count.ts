// Which stream events count, and in which watch and 5-minute window (by the event's own time, never arrival time).
import { BUCKET_MS, type Editor, WIKIS } from "./config.ts";

const WATCHED = new Set<string>(WIKIS);
const WIKI_FIELD = /"wiki":"([a-z_]+)"/;

export interface Counted {
  bucket: number;
  wiki: string;
  editor: Editor;
  /** The event's time (ms), for resume checks. */
  at: number;
}

export const bucketOf = (ms: number) => Math.floor(ms / BUCKET_MS) * BUCKET_MS;

/** One `recentchange` event's data → what it adds to, or null when it does not count: another wiki, a log or category
 * change, a canary event, or a broken record. A cheap text check skips JSON parsing for the other wikis. */
export function classify(data: string): Counted | null {
  const wiki = WIKI_FIELD.exec(data)?.[1];
  if (!wiki || !WATCHED.has(wiki)) return null;
  let e: { type?: unknown; wiki?: unknown; bot?: unknown; meta?: { dt?: unknown; domain?: unknown } };
  try {
    e = JSON.parse(data) as typeof e;
  } catch {
    return null;
  }
  if (e.wiki !== wiki || e.meta?.domain === "canary") return null;
  if (e.type !== "edit" && e.type !== "new") return null;
  const at = typeof e.meta?.dt === "string" ? Date.parse(e.meta.dt) : NaN;
  if (!Number.isFinite(at)) return null;
  return { bucket: bucketOf(at), wiki, editor: e.bot === true ? "bot" : "human", at };
}

export const countKey = (bucket: number, wiki: string, editor: Editor) => `${bucket}|${wiki}|${editor}`;
