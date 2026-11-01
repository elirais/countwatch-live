import { describe, expect, it } from "vitest";
import { fetchWikiHistory, type Io, sendImport, waitForImport } from "../src/history-run.ts";

const T = (s: string) => Date.parse(`2026-10-02T${s}Z`);
const json = (o: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...headers } });

function io(answers: Response[]): Io & { urls: string[]; inits: RequestInit[]; slept: number[]; lines: string[] } {
  const urls: string[] = [];
  const inits: RequestInit[] = [];
  const slept: number[] = [];
  const lines: string[] = [];
  return {
    urls, inits, slept, lines,
    fetch: (async (u: RequestInfo | URL, init?: RequestInit) => { urls.push(String(u)); inits.push(init ?? {}); const a = answers.shift(); if (!a) throw new Error("no more answers"); return a; }) as typeof fetch,
    sleep: async (ms) => void slept.push(ms),
    log: (l) => void lines.push(l),
  };
}

describe("fetchWikiHistory", () => {
  it("follows continuation, waits out a lagged API, and counts every page", async () => {
    const x = io([
      json({ query: { recentchanges: [{ type: "edit", timestamp: "2026-10-02T10:01:00Z" }] }, continue: { rccontinue: "c1", continue: "-||" } }),
      json({ error: { code: "maxlag" } }, 200, { "retry-after": "2" }),
      json({ query: { recentchanges: [{ type: "new", timestamp: "2026-10-02T10:06:00Z", bot: true }] } }),
    ]);
    const h = await fetchWikiHistory("enwiki", T("10:00:00"), T("10:10:00"), x);
    expect(h).toMatchObject({ first: T("10:01:00"), pages: 2, changes: 2 });
    expect(h.counts.get(`${T("10:00:00")}|human`)).toBe(1);
    expect(h.counts.get(`${T("10:05:00")}|bot`)).toBe(1);
    expect(new URL(x.urls[1]!).searchParams.get("rccontinue")).toBe("c1");
    expect(new URL(x.urls[2]!).searchParams.get("rccontinue")).toBe("c1");
    expect(x.slept).toEqual([2000]);
    expect((x.inits[0]!.headers as Record<string, string>)["user-agent"]).toMatch(/^countwatch-live\//);
  });

  it("retries a dropped connection", async () => {
    const x = io([json({ query: { recentchanges: [] } })]);
    let first = true;
    const flaky = { ...x, fetch: (async (u: RequestInfo | URL, i?: RequestInit) => { if (first) { first = false; throw new Error("ECONNRESET"); } return x.fetch(u, i); }) as typeof fetch };
    expect((await fetchWikiHistory("enwiki", T("10:00:00"), T("10:10:00"), flaky)).pages).toBe(1);
    expect(x.lines[0]).toMatch(/network: ECONNRESET/);
  });

  it("gives up after repeated failures with the API's code", async () => {
    const x = io(Array.from({ length: 9 }, () => json({}, 503)));
    await expect(fetchWikiHistory("hewiki", T("10:00:00"), T("10:10:00"), x)).rejects.toThrow(/hewiki: .*HTTP 503/);
  });
});

describe("sendImport and waitForImport", () => {
  const api = { url: "https://api.countwatch.test", key: "cw_test" };
  const watches = [{ metric: "wiki_edits", tags: { wiki: "enwiki", editor: "human" }, start: "2026-10-02T10:00:00.000Z", resolution: "5m" as const, counts: [1, 2] }];

  it("sends one import with the key, a stable Idempotency-Key and recipe import", async () => {
    const x = io([json({ import_id: "imp_1", stored: [{ index: 0, watch_id: "wat_1" }], rejected: [] }, 202), json({ import_id: "imp_1", stored: [], rejected: [] }, 202)]);
    expect((await sendImport(api, watches, x)).import_id).toBe("imp_1");
    await sendImport(api, watches, x);
    const h0 = x.inits[0]!.headers as Record<string, string>;
    const h1 = x.inits[1]!.headers as Record<string, string>;
    expect(x.urls[0]).toBe("https://api.countwatch.test/v1/import");
    expect(h0.authorization).toBe("Bearer cw_test");
    expect(h0["idempotency-key"]).toBe(h1["idempotency-key"]);
    expect(JSON.parse(String(x.inits[0]!.body))).toEqual({ watches, recipe: "import" });
  });

  it("shows CountWatch's problem text when it refuses", async () => {
    const x = io([json({ code: "import_too_large", detail: "too many watch-days" }, 400)]);
    await expect(sendImport(api, watches, x)).rejects.toThrow(/400: .*import_too_large/);
  });

  it("polls until the replay is done", async () => {
    const st = (status: string, done: number) => json({ import_id: "imp_1", status, created_at: "x", progress: { done, total: 20 }, watches: [] });
    const x = io([st("replay_pending", 0), st("replaying", 7), st("done", 20)]);
    expect((await waitForImport(api, "imp_1", x)).status).toBe("done");
    expect(x.lines).toEqual(["import imp_1: replay_pending 0/20", "import imp_1: replaying 7/20", "import imp_1: done 20/20"]);
  });
});
