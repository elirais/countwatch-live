# countwatch-live

CountWatch Live: public data watched by [CountWatch](https://countwatch.com) as an ordinary customer. It is a test of the
product end to end and the source of the charts we post. Decisions: ADR 0066 in `elirais/Magnum`.

## What runs

- **Wikipedia edits (SR-1).** One Durable Object reads the Wikimedia
  [EventStreams](https://stream.wikimedia.org/v2/stream/recentchange) `recentchange` stream. It counts edits and new
  pages per 5-minute window, **by each edit's own time**, for ten Wikipedias (en, de, fr, es, ja, ru, it, zh, pt, he),
  split into human and bot edits: 20 watches, metric `wiki_edits`, tags `wiki` and `editor`.
- Every cycle reads until 20 s after the next 5-minute boundary, then sends the closed windows to
  `POST /v1/ingest` as totals (`set`), zeros included. It resends the last 30 minutes, so late events land in their
  own window, and every window CountWatch has not accepted yet, back to 5 h 50 min.
- It resumes the stream from the last event id. If the stream could not resume, the windows in between stay
  **missing**; they are never sent as zeros. A stuck stream sends nothing, so CountWatch raises Silence.
- A cron every 5 minutes re-arms the reader's alarm if it is missing.
- `GET /status` shows the stream position, the last read and the last flush. It shows no counts and no secrets.

- **Wikipedia history (SR-2).** `npm run import:wiki` fetches the last 30 days of the same 20 watches from each
  wiki's recent-changes API (one request at a time, as Wikimedia asks; about an hour) and imports them with
  `POST /v1/import` (5-minute counts, zeros included). It waits for CountWatch's replay and prints the rules chosen and
  the past alerts per watch (full answer in `import-result.json`). Start with `npm run import:wiki -- --dry-run`.
  It runs on your own computer and needs a write key of the showcase account in `COUNTWATCH_API_KEY` or
  `.countwatch.env`.

## Set up (once)

1. Showcase account on countwatch.com (Pro). Its sign-in address goes in CountWatch's `INTERNAL_EMAILS` secret, not in
   this repository.
2. Write key, from this folder, signed in as the showcase account:
   `npx countwatch init --print | npx wrangler secret put COUNTWATCH_API_KEY`
3. Deploy: either `npx wrangler deploy` (after `npx wrangler login`), or set the repository secret
   `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit) and run **Actions → deploy** on `main`.

## Develop

- `npm run check`: typecheck and tests. The cycle (`src/cycle.ts`) has no Cloudflare imports, so it is tested in Node
  with a fake stream, a fake clock and a fake CountWatch.
- Every step's PR ends with its **product notes** (`PRODUCT-NOTES.md`): what in CountWatch got in the way, with
  evidence. Each real note becomes a task in `elirais/Magnum`. Nothing is worked around here.
