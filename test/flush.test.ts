import { describe, expect, it } from "vitest";
import { WIKIS } from "../src/config.ts";
import { countKey } from "../src/count.ts";
import { buildPoints, prune, type Span } from "../src/flush.ts";

const T = (s: string) => Date.parse(`2026-11-01T${s}Z`);
const span = (o: Partial<Span>): Span => ({ until: T("10:05:20"), coveredFrom: T("09:00:00"), sentUntil: null, now: T("10:05:20"), ...o });
const windows = (points: { ts: string }[]) => [...new Set(points.map((p) => p.ts.slice(11, 16)))];

describe("buildPoints", () => {
  it("sends every watch for every closed window of the last 30 minutes, zeros included", () => {
    const counts = new Map([[countKey(T("10:00:00"), "enwiki", "human"), 42]]);
    const points = buildPoints(counts, span({}));
    expect(windows(points)).toEqual(["09:35", "09:40", "09:45", "09:50", "09:55", "10:00"]);
    expect(points).toHaveLength(6 * WIKIS.length * 2);
    expect(points.find((p) => p.ts === "2026-11-01T10:00:00.000Z" && p.tags.wiki === "enwiki" && p.tags.editor === "human")?.set).toBe(42);
    expect(points.find((p) => p.ts === "2026-11-01T10:00:00.000Z" && p.tags.wiki === "hewiki" && p.tags.editor === "bot")?.set).toBe(0);
    expect(points[0]).toMatchObject({ metric: "wiki_edits", ts: "2026-11-01T09:35:00.000Z" });
  });

  it("never sends a window the reader did not see from its start (missing, not zero)", () => {
    expect(windows(buildPoints(new Map(), span({ coveredFrom: T("09:52:10") })))).toEqual(["09:55", "10:00"]);
  });

  it("goes by the stream's position, not the clock: a stuck stream sends no new windows", () => {
    expect(windows(buildPoints(new Map(), span({ until: T("09:51:00"), now: T("10:05:20") })))).toEqual(["09:20", "09:25", "09:30", "09:35", "09:40", "09:45"]);
  });

  it("sends every window not yet accepted, after a CountWatch outage, but none older than CountWatch takes", () => {
    expect(windows(buildPoints(new Map(), span({ sentUntil: T("09:20:00") })))[0]).toBe("09:20");
    const old = buildPoints(new Map(), span({ until: T("16:05:20"), now: T("16:05:20"), sentUntil: T("09:00:00") }));
    expect(windows(old)[0]).toBe("10:20"); // 16:05:20 − 5 h 50 min = 10:15:20, next whole window
  });

  it("sends nothing before the first window has closed", () => {
    expect(buildPoints(new Map(), span({ until: T("10:04:00"), coveredFrom: T("10:01:00") }))).toEqual([]);
  });
});

describe("prune", () => {
  it("drops windows older than the cut", () => {
    const counts = new Map([[countKey(T("08:00:00"), "enwiki", "human"), 1], [countKey(T("10:00:00"), "enwiki", "human"), 2]]);
    prune(counts, T("09:00:00"));
    expect([...counts.values()]).toEqual([2]);
  });
});
