/// <reference types="node" />
// SR-2: import the last 30 days of the 20 Wikipedia watches into CountWatch, as a customer would (the "Import once"
// method). Run on your own computer: it needs Wikipedia and api.countwatch.com.
//
//   npm run import:wiki -- --dry-run      fetch and count only, send nothing
//   npm run import:wiki                   fetch, send, wait for the replay, print what CountWatch learned
//   options: --days 30, --wikis enwiki,hewiki, --refetch (ignore the counts saved in .history/)
//
// The key: COUNTWATCH_API_KEY in the environment, else in .countwatch.env (what `npx countwatch init` writes). A write
// key of the showcase account. Never printed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { BUCKET_MS } from "../src/config.ts";
import { bucketOf } from "../src/count.ts";
import { coveredStart, type ImportWatch, watchesOf, WIKIS } from "../src/history.ts";
import { fetchWikiHistory, type Io, sendImport, waitForImport } from "../src/history-run.ts";

const { values } = parseArgs({ options: { days: { type: "string", default: "30" }, wikis: { type: "string" }, "dry-run": { type: "boolean", default: false }, refetch: { type: "boolean", default: false } } });
const days = Number(values.days);
if (!(days > 0 && days <= 90)) throw new Error("--days: 1 to 90 (CountWatch imports up to 90 days)");
const wikis = values.wikis ? values.wikis.split(",") : [...WIKIS];
for (const w of wikis) if (!(WIKIS as readonly string[]).includes(w)) throw new Error(`--wikis: ${w} is not one of ${WIKIS.join(", ")}`);

function apiKey(): string | null {
  if (process.env.COUNTWATCH_API_KEY) return process.env.COUNTWATCH_API_KEY;
  if (!existsSync(".countwatch.env")) return null;
  const line = readFileSync(".countwatch.env", "utf8").split("\n").find((l) => l.startsWith("COUNTWATCH_API_KEY="));
  return line ? line.slice("COUNTWATCH_API_KEY=".length).trim().replace(/^"|"$/g, "") : null;
}

const io: Io = { fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), log: (l) => console.log(l) };
const end = bucketOf(Date.now()); // the open window is left to the live reader
const from = end - days * 86_400_000;
console.log(`Fetching ${days} days (${new Date(from).toISOString()} → ${new Date(end).toISOString()}) for ${wikis.join(", ")}`);

// Each wiki's counts are saved in .history/ as soon as they are fetched: a later run (the real one after a dry run, or
// a run after Ctrl+C) reuses them instead of fetching for an hour again. --refetch ignores the saved ones.
type Saved = { from: number; end: number; first: number | null; pages: number; changes: number; counts: [string, number][] };
mkdirSync(".history", { recursive: true });
const savedPath = (wiki: string) => `.history/${wiki}-${days}d.json`;
const watches: ImportWatch[] = [];
for (const wiki of wikis) {
  const t0 = Date.now();
  // Saved counts still join the live data: the live reader has sent every window since it started, and CountWatch stops
  // an import at a watch's first live window.
  const saved: Saved | null = !values.refetch && existsSync(savedPath(wiki)) ? (JSON.parse(readFileSync(savedPath(wiki), "utf8")) as Saved) : null;
  const h = saved ? { ...saved, counts: new Map(saved.counts) } : { from, end, ...(await fetchWikiHistory(wiki, from, end, io)) };
  if (!saved) writeFileSync(savedPath(wiki), JSON.stringify({ from: h.from, end: h.end, first: h.first, pages: h.pages, changes: h.changes, counts: [...h.counts] } satisfies Saved));
  else console.log(`${wiki}: using the counts saved at ${new Date(saved.end).toISOString()} (--refetch to fetch again)`);
  const start = coveredStart(h.from, h.first);
  const ws = watchesOf(wiki, h.counts, start, h.end);
  watches.push(...ws);
  const sum = (w: ImportWatch) => w.counts.reduce((a, b) => a + b, 0);
  console.log(`${wiki}: ${h.changes.toLocaleString("en-US")} changes in ${h.pages} pages (${Math.round((Date.now() - t0) / 1000)} s); from ${new Date(start).toISOString()}; human ${sum(ws[0]!).toLocaleString("en-US")}, bot ${sum(ws[1]!).toLocaleString("en-US")}`);
  if (start > h.from + BUCKET_MS) console.log(`  note: ${wiki} keeps history only from ${new Date(start).toISOString()}`);
}

if (values["dry-run"]) {
  console.log(`Dry run: ${watches.length} watches, ${watches.reduce((a, w) => a + w.counts.length, 0).toLocaleString("en-US")} windows. Nothing sent.`);
  process.exit(0);
}
const key = apiKey();
if (!key) throw new Error("No COUNTWATCH_API_KEY (environment or .countwatch.env). Run `npx countwatch init` signed in as the showcase account.");
const api = { url: process.env.COUNTWATCH_API_URL ?? "https://api.countwatch.com", key };

const sent = await sendImport(api, watches, io);
console.log(`Import ${sent.import_id}: ${sent.stored.length} watches stored, ${sent.rejected.length} refused`);
if (sent.rejected.length) console.log(JSON.stringify(sent.rejected, null, 2));
const done = await waitForImport(api, sent.import_id, io);
writeFileSync("import-result.json", JSON.stringify(done, null, 2));
console.log("\nWhat CountWatch learned (full answer in import-result.json):");
for (const w of done.watches) {
  const r = w.replay;
  const name = `${w.tags.wiki}/${w.tags.editor}`.padEnd(14);
  if (!r) { console.log(`${name} no replay yet`); continue; }
  console.log(`${name} ${r.status.padEnd(8)} ${String(r.replay_days).padStart(3)} days  rules: ${r.rules.map((x) => x.name).join(", ") || "none"}  past alerts: ${r.alerts.length}${r.status === "ok" ? "" : `  (${r.reason})`}`);
  for (const a of r.alerts.slice(0, 3)) console.log(`${"".padEnd(14)}   ${a.at}  ${a.rule.name}  ${a.observed} vs usual ${a.usual}`);
}
