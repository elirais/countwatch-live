import { describe, expect, it } from "vitest";
import { bucketOf, classify } from "../src/count.ts";

const ev = (o: Record<string, unknown>) => JSON.stringify({ type: "edit", bot: false, wiki: "enwiki", meta: { dt: "2026-11-01T10:04:59Z", domain: "en.wikipedia.org" }, ...o });

describe("classify", () => {
  it("counts a human edit in the window of its own time", () => {
    expect(classify(ev({}))).toEqual({ bucket: Date.parse("2026-11-01T10:00:00Z"), wiki: "enwiki", editor: "human", at: Date.parse("2026-11-01T10:04:59Z") });
  });

  it("counts new pages, and bot edits as bot", () => {
    expect(classify(ev({ type: "new", bot: true }))?.editor).toBe("bot");
  });

  it("ignores other wikis, log and category changes, canaries and broken records", () => {
    expect(classify(ev({ wiki: "wikidatawiki" }))).toBeNull();
    expect(classify(ev({ type: "log" }))).toBeNull();
    expect(classify(ev({ type: "categorize" }))).toBeNull();
    expect(classify(ev({ meta: { dt: "2026-11-01T10:00:00Z", domain: "canary" } }))).toBeNull();
    expect(classify('{"wiki":"enwiki", broken')).toBeNull();
    expect(classify(ev({ meta: { domain: "en.wikipedia.org" } }))).toBeNull();
  });

  it("puts 10:05:00 in the next window", () => {
    expect(bucketOf(Date.parse("2026-11-01T10:05:00Z"))).toBe(Date.parse("2026-11-01T10:05:00Z"));
  });
});
