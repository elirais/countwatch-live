import { describe, expect, it } from "vitest";
import { addChanges, coveredStart, hostOf, rcUrl, watchesOf, type WikiCounts } from "../src/history.ts";

const T = (s: string) => Date.parse(`2026-10-02T${s}Z`);

describe("history", () => {
  it("maps a wiki to its host and builds the recent-changes URL, oldest first, with continuation", () => {
    expect(hostOf("hewiki")).toBe("he.wikipedia.org");
    const u = new URL(rcUrl("enwiki", T("10:00:00"), T("11:00:00"), { rccontinue: "2026|123", continue: "-||" }));
    expect(u.host).toBe("en.wikipedia.org");
    expect(u.searchParams.get("rcdir")).toBe("newer");
    expect(u.searchParams.get("rctype")).toBe("edit|new");
    expect(u.searchParams.get("rcstart")).toBe("2026-10-02T10:00:00.000Z");
    expect(u.searchParams.get("rcend")).toBe("2026-10-02T10:59:59.000Z");
    expect(u.searchParams.get("rccontinue")).toBe("2026|123");
  });

  it("counts edits and new pages per 5-minute window, human or bot, by the edit's own time", () => {
    const c: WikiCounts = new Map();
    const oldest = addChanges(c, [
      { type: "edit", timestamp: "2026-10-02T10:04:59Z" },
      { type: "new", timestamp: "2026-10-02T10:05:00Z", bot: true },
      { type: "log", timestamp: "2026-10-02T10:01:00Z" },
      { type: "edit", timestamp: "2026-10-02T10:01:00Z", bot: false },
    ]);
    expect(oldest).toBe(T("10:01:00"));
    expect(c.get(`${T("10:00:00")}|human`)).toBe(2);
    expect(c.get(`${T("10:05:00")}|bot`)).toBe(1);
  });

  it("starts where the wiki's history is complete", () => {
    expect(coveredStart(T("10:02:00"), T("10:02:30"))).toBe(T("10:05:00"));
    expect(coveredStart(T("10:00:00"), T("10:00:40"))).toBe(T("10:00:00"));
    // Asked for 10:00, history starts at 14:03: kept from 14:05.
    expect(coveredStart(T("10:00:00"), T("14:03:00"))).toBe(T("14:05:00"));
  });

  it("builds one human and one bot entry with every window, zeros included", () => {
    const c: WikiCounts = new Map([[`${T("10:05:00")}|human`, 7]]);
    const [human, bot] = watchesOf("dewiki", c, T("10:00:00"), T("10:15:00"));
    expect(human).toEqual({ metric: "wiki_edits", tags: { wiki: "dewiki", editor: "human" }, start: "2026-10-02T10:00:00.000Z", resolution: "5m", counts: [0, 7, 0] });
    expect(bot?.counts).toEqual([0, 0, 0]);
  });
});
