# SR-2: what a customer expects from "import my history" (written before reading the docs)

Written on 1 Nov 2026 before opening CountWatch's import docs, as a developer who already sends live counts and now
wants the past in. Each line is checked afterwards in "What happened" at the end.

## Before I start
1. **One obvious place in the docs** called something like "Import history" or "Backfill", linked from the page I
   used for live counts.
2. **It says how far back I may go** (days), at what resolution (I have 5-minute counts), and the size limits per call.
3. **The same API key I send live counts with works** for the import. I should not need an admin key or a second
   sign-in.
4. **A copy-paste example** with my metric and tags, not someone else's "orders per shop".

## While importing
5. **One request for my 20 series × 30 days**, or the docs tell me exactly how to split it.
6. **History and live data do not fight.** My live reader started an hour ago; the import must not overwrite or double
   the windows it already sent, and I should not have to compute the cut-off myself.
7. **I learn right away if something is wrong**: a clear error naming the field (bad timestamp, wrong length,
   too old), not a generic 400.
8. **A job id and a progress URL**, because 600 watch-days will not be instant.

## After importing
9. **The charts on the website show the 30 days** at once, joined to the live part with no gap or step.
10. **CountWatch says what it learned**: the rules it picked per series and the alerts it would have sent in those
    30 days. I want to recognise at least one ("yes, that was the day X happened").
11. **"Learning" ends** for these series, so real alerts start now, not in three weeks.
12. **Running the same import twice is safe** (no doubled counts).
13. **It costs me a few requests, not thousands**, and does not eat my monthly quota.

## What happened

### Reading the docs (before the run)
The docs a customer reads: `llms.txt` → Guides → "Importing history", plus the API reference for `POST /v1/import`
and `GET /v1/imports/{import_id}`.

| # | Expectation | Docs say |
|---|---|---|
| 1 | One obvious place | Yes: Guides → "Importing history"; `llms.txt` lists "import" under Guides. |
| 2 | How far back, resolution, size | Yes for 90 days, `5m/1h/1d`, 1,000 watch-days per request. The 2 MB body and 256 day-row parts limits are only in the API reference / SPEC, not in the guide. |
| 3 | Same key as live | Yes: the setup step says a write key may send `POST /v1/import`. |
| 4 | Copy-paste example | No code example in the guide section; the API reference shows shapes only. |
| 5 | One request for 20 × 30 days | Yes: 600 watch-days is under 1,000. |
| 6 | History and live do not fight | **Not in the guide.** SPEC says an import stops at a watch's first live bucket, but a customer cannot read the SPEC. |
| 7 | Clear errors | To be seen in the run. |
| 8 | Job id + progress | Yes: `202 {import_id}`, poll `GET /v1/imports/{id}` (with `progress`). |
| 9 | Charts show the 30 days | To be seen on countwatch.com. |
| 10 | Rules and past alerts | Yes: the replay lists rules and "the alerts they would have raised". |
| 11 | Learning ends | **Not said in the guide** (the glossary says importing enough history ends learning). |
| 12 | Safe to run twice | **Not in the guide.** The API takes an `Idempotency-Key`, and SPEC says a watch only an import wrote is replaced in full; neither is in the guide. |
| 13 | Costs few requests | Implied (one request), not said. |

### The run
(filled in after the founder runs `npm run import:wiki`)
