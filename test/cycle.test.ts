import { describe, expect, it } from "vitest";
import { STREAM_URL } from "../src/config.ts";
import { type Deps, emptyState, readDeadline, type ReaderState, runCycle } from "../src/cycle.ts";
import type { Point } from "../src/flush.ts";

const T = (s: string) => Date.parse(`2026-11-01T${s}Z`);
const edit = (id: string, dt: string, o: Record<string, unknown> = {}) =>
  `id: ${id}\ndata: ${JSON.stringify({ type: "edit", bot: false, wiki: "enwiki", meta: { dt: `2026-11-01T${dt}Z`, domain: "en.wikipedia.org" }, ...o })}\n\n`;

/** A fake world: the clock, one stream answer per connect (later connects jump to the deadline), and CountWatch. */
function world(start: number, streams: (string | number)[], apiKey: string | null = "cw_test") {
  let clock = start;
  const seen: { lastEventId: string | null | undefined; posts: { points: Point[]; recipe: string }[] } = { lastEventId: undefined, posts: [] };
  const deps: Deps = {
    now: () => clock,
    sleep: async (ms) => void (clock += ms),
    apiUrl: "https://api.countwatch.test",
    apiKey: apiKey ?? undefined,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === STREAM_URL) {
        // The first connect's resume position (later connects in the cycle carry newer ids).
        if (seen.lastEventId === undefined) seen.lastEventId = (init?.headers as Record<string, string>)["last-event-id"] ?? null;
        const next = streams.shift();
        if (next === undefined) {
          clock = readDeadline(start);
          return new Response("");
        }
        if (typeof next === "number") return new Response("down", { status: next });
        return new Response(next, { headers: { "content-type": "text/event-stream" } });
      }
      expect(url).toBe("https://api.countwatch.test/v1/ingest");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer cw_test");
      seen.posts.push(JSON.parse(String(init?.body)));
      return new Response('{"accepted":1}', { status: 200 });
    }) as typeof fetch,
  };
  return { deps, seen };
}

const point = (points: Point[], ts: string, wiki: string, editor: string) => points.find((p) => p.ts === `2026-11-01T${ts}.000Z` && p.tags.wiki === wiki && p.tags.editor === editor);

describe("readDeadline", () => {
  it("ends 20 s after the next boundary, also when it starts inside a boundary's grace", () => {
    expect(readDeadline(T("10:01:00"))).toBe(T("10:05:20"));
    expect(readDeadline(T("10:05:10"))).toBe(T("10:05:20"));
    expect(readDeadline(T("10:05:30"))).toBe(T("10:10:20"));
  });
});

describe("runCycle", () => {
  it("counts by event time, sends closed windows as totals with zeros, and remembers the stream position", async () => {
    const stream = edit("a1", "09:54:00") + edit("a2", "10:01:00") + edit("a3", "10:02:00", { bot: true }) + edit("a4", "10:05:02") + edit("x", "10:05:03", { wiki: "wikidatawiki" });
    const { deps, seen } = world(T("10:00:40"), [stream]);
    const s = await runCycle(emptyState(), deps);
    expect(seen.lastEventId).toBeNull();
    expect(s.lastEventId).toBe("x");
    expect(s.coveredFrom).toBe(T("09:54:00"));
    expect(s.lastEventAt).toBe(T("10:05:02"));
    expect(seen.posts).toHaveLength(1);
    const { points, recipe } = seen.posts[0]!;
    expect(recipe).toBe("scheduled-query");
    // Coverage starts at 09:54, mid-window: 09:50 is unknown and not sent; 09:55 and 10:00 were fully seen.
    expect([...new Set(points.map((p) => p.ts))]).toEqual(["2026-11-01T09:55:00.000Z", "2026-11-01T10:00:00.000Z"]);
    expect(point(points, "09:55:00", "enwiki", "human")?.set).toBe(0);
    expect(point(points, "10:00:00", "enwiki", "human")?.set).toBe(1);
    expect(point(points, "10:00:00", "enwiki", "bot")?.set).toBe(1);
    expect(point(points, "10:00:00", "hewiki", "human")?.set).toBe(0);
    expect(s.lastFlush).toMatchObject({ points: 40, status: 200, error: null });
  });

  it("resumes from the last event id and keeps late events in their own window", async () => {
    const first = world(T("10:00:40"), [edit("a1", "09:54:00") + edit("a2", "10:01:00") + edit("a3", "10:05:02")]);
    const s1 = await runCycle(emptyState(), first.deps);
    // Next cycle: a late 10:04 event arrives after the 10:05 flush; 10:00 is sent again with the new total.
    const second = world(T("10:05:21"), [edit("b1", "10:04:30") + edit("b2", "10:10:05")]);
    const s2 = await runCycle(s1, second.deps);
    expect(second.seen.lastEventId).toBe("a3");
    expect(s2.coveredFrom).toBe(T("09:54:00"));
    const points = second.seen.posts[0]!.points;
    expect(point(points, "10:00:00", "enwiki", "human")?.set).toBe(2);
    expect(point(points, "10:05:00", "enwiki", "human")?.set).toBe(1);
    expect(s2.sentUntil).toBe(T("10:10:00"));
  });

  it("keeps the unsent windows when CountWatch refuses, and sends them next time", async () => {
    const w = world(T("10:00:40"), [edit("a1", "09:54:00") + edit("a2", "10:05:02")]);
    const failing = { ...w.deps, fetch: (async (i: RequestInfo | URL, init?: RequestInit) => (String(i).endsWith("/v1/ingest") ? new Response('{"code":"overloaded"}', { status: 503 }) : w.deps.fetch(i, init))) as typeof fetch };
    const s = await runCycle(emptyState(), failing);
    expect(s.lastFlush).toMatchObject({ status: 503, error: '{"code":"overloaded"}' });
    expect(s.sentUntil).toBeNull();
  });

  it("after a break the stream could not resume, the missed windows stay missing (no made-up zeros)", async () => {
    const prev: ReaderState = { ...emptyState(), lastEventId: "old", lastEventAt: T("09:30:00"), coveredFrom: T("09:00:00") };
    const { deps, seen } = world(T("10:00:40"), [edit("c1", "10:00:10") + edit("c2", "10:05:01")]);
    const s = await runCycle(prev, deps);
    expect(s.coveredFrom).toBe(T("10:00:10"));
    // 10:00 started before the new coverage: nothing is sent yet.
    expect(seen.posts).toHaveLength(0);
    expect(s.lastFlush).toMatchObject({ points: 0 });
  });

  it("a stream that is down sends nothing, so CountWatch sees missing data (Silence), and the error is kept", async () => {
    const prev: ReaderState = { ...emptyState(), lastEventId: "a9", lastEventAt: T("09:59:00"), coveredFrom: T("09:00:00") };
    const { deps, seen } = world(T("10:00:40"), [503]);
    const s = await runCycle(prev, deps);
    expect(s.lastRead?.error).toBe("stream answered 503");
    // Only windows that ended by the last event read (09:59) are sent; 09:55 and later stay missing.
    const ts = new Set(seen.posts.flatMap((p) => p.points.map((x) => x.ts)));
    expect([...ts].every((t) => Date.parse(t) + 300_000 <= T("09:59:00"))).toBe(true);
  });

  it("ignores an event stamped in the future, so no unfinished window is sent", async () => {
    const { deps, seen } = world(T("10:00:40"), [edit("a1", "09:54:00") + edit("a2", "10:05:02") + edit("bad", "11:30:00")]);
    const s = await runCycle(emptyState(), deps);
    expect(s.lastEventAt).toBe(T("10:05:02"));
    expect(seen.posts[0]!.points.every((p) => Date.parse(p.ts) <= T("10:00:00"))).toBe(true);
  });

  it("without an API key it sends nothing and says why", async () => {
    const { deps, seen } = world(T("10:00:40"), [edit("a1", "09:54:00") + edit("a2", "10:05:02")], null);
    const s = await runCycle(emptyState(), deps);
    expect(seen.posts).toHaveLength(0);
    expect(s.lastFlush?.error).toBe("COUNTWATCH_API_KEY is not set");
  });
});
