// SR-1: one cycle of the Wikipedia edits reader, free of Cloudflare APIs so it is tested in Node. The Durable Object's
// alarm (wiki-reader.ts) runs it: read the EventStreams `recentchange` stream until just after the next 5-minute boundary,
// then send the closed windows to CountWatch. The stream resumes from the last event id, so a restart or a short outage
// loses nothing (ADR 0066 #2, #4).
import { BUCKET_MS, GRACE_MS, MAX_AGE_MS, RESUME_GAP_MS, STREAM_URL, USER_AGENT } from "./config.ts";
import { bucketOf, classify, countKey } from "./count.ts";
import { buildPoints, lastWindow, prune, type Span } from "./flush.ts";
import { SseParser } from "./sse.ts";

export interface ReaderState {
  lastEventId: string | null;
  /** Newest event time of a counted event: the stream's position. */
  lastEventAt: number | null;
  /** Since when the reader has seen the stream without a break (null: not yet). */
  coveredFrom: number | null;
  /** End of the last window CountWatch accepted. */
  sentUntil: number | null;
  counts: [string, number][];
  lastRead: { at: number; connects: number; events: number; counted: number; error: string | null } | null;
  lastFlush: { at: number; points: number; status: number | null; error: string | null } | null;
}

export const emptyState = (): ReaderState => ({ lastEventId: null, lastEventAt: null, coveredFrom: null, sentUntil: null, counts: [], lastRead: null, lastFlush: null });

export interface Deps {
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  apiUrl: string;
  apiKey: string | undefined;
}

/** When this cycle's read ends: GRACE_MS after the next 5-minute boundary (a cycle that starts inside the grace of a
 * boundary still ends at that boundary's grace). */
export const readDeadline = (now: number) => bucketOf(now - GRACE_MS) + BUCKET_MS + GRACE_MS;

/** One alarm: read, then flush. Returns the new state; never throws. */
export async function runCycle(prev: ReaderState, deps: Deps): Promise<ReaderState> {
  const s: ReaderState = { ...prev };
  const counts = new Map(prev.counts);
  const deadline = readDeadline(deps.now());
  const read = { at: deps.now(), connects: 0, events: 0, counted: 0, error: null as string | null };

  while (deps.now() < deadline - 1000 && read.connects < 30) {
    read.connects++;
    let firstOfConnection = true;
    try {
      const headers: Record<string, string> = { accept: "text/event-stream", "user-agent": USER_AGENT };
      if (s.lastEventId) headers["last-event-id"] = s.lastEventId;
      const res = await deps.fetch(STREAM_URL, { headers, signal: AbortSignal.timeout(Math.max(1000, deadline - deps.now())) });
      if (!res.ok || !res.body) throw new Error(`stream answered ${res.status}`);
      const parser = new SseParser();
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const ev of parser.push(value)) {
          read.events++;
          if (ev.id) s.lastEventId = ev.id;
          const c = classify(ev.data);
          // An event stamped in the future (a bad clock upstream) must not move the position past what has happened.
          if (!c || c.at > deps.now() + 60_000) continue;
          if (firstOfConnection) {
            firstOfConnection = false;
            // First start, or the stream did not resume where it stopped: the time between is unknown, not zero.
            if (s.lastEventAt === null || s.coveredFrom === null || c.at - s.lastEventAt > RESUME_GAP_MS) s.coveredFrom = c.at;
          }
          read.counted++;
          const key = countKey(c.bucket, c.wiki, c.editor);
          counts.set(key, (counts.get(key) ?? 0) + 1);
          if (s.lastEventAt === null || c.at > s.lastEventAt) s.lastEventAt = c.at;
        }
        if (deps.now() >= deadline) break;
      }
      reader.releaseLock();
    } catch (err) {
      const e = err as Error;
      if (e.name !== "TimeoutError" && e.name !== "AbortError") read.error = e.message.slice(0, 300);
    }
    if (deps.now() < deadline - 1000) await deps.sleep(1000);
  }
  s.lastRead = read;

  if (s.lastEventAt !== null && s.coveredFrom !== null) {
    const span: Span = { until: s.lastEventAt, coveredFrom: s.coveredFrom, sentUntil: s.sentUntil, now: deps.now() };
    s.lastFlush = await flush(counts, span, deps);
    if (s.lastFlush.status !== null && s.lastFlush.status >= 200 && s.lastFlush.status < 300) s.sentUntil = lastWindow(span) + BUCKET_MS;
  }
  prune(counts, bucketOf(deps.now() - MAX_AGE_MS));
  s.counts = [...counts];
  return s;
}

async function flush(counts: Map<string, number>, span: Span, deps: Deps): Promise<NonNullable<ReaderState["lastFlush"]>> {
  const at = deps.now();
  const points = buildPoints(counts, span);
  if (points.length === 0) return { at, points: 0, status: null, error: null };
  if (!deps.apiKey) return { at, points: points.length, status: null, error: "COUNTWATCH_API_KEY is not set" };
  try {
    const res = await deps.fetch(new URL("/v1/ingest", deps.apiUrl), {
      method: "POST",
      headers: { authorization: `Bearer ${deps.apiKey}`, "content-type": "application/json", "user-agent": USER_AGENT },
      body: JSON.stringify({ points, recipe: "scheduled-query" }),
    });
    const text = await res.text();
    return { at, points: points.length, status: res.status, error: res.ok ? null : text.slice(0, 500) };
  } catch (err) {
    return { at, points: points.length, status: null, error: (err as Error).message.slice(0, 300) };
  }
}

