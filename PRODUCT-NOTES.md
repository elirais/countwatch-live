# Product notes

What in CountWatch got in the way while building the showcase (ADR 0066 #1 in `elirais/Magnum`). Each real note
becomes a Magnum task; the showcase does not work around the product.

## SR-1 (Wikipedia edits)

1. **The npm client has no event-time option.** `CountWatch.count(metric, n, tags)` stamps the arrival time
   (`packages/cli/src/client.ts:219`, no `ts`). A stream reader that resumes after a break gets a backlog all at once,
   so the client would put it in the wrong window: a dip, then a jump, which can raise a false Drop and then a false
   Spike. The showcase therefore sends `POST /v1/ingest` with `ts` and `set` directly. Proposed task: `count(…, { at })`
   or `set(metric, total, { ts, tags })` in the client.
2. **No recipe name fits a stream reader that sends window totals.** The fixed list (`src/http/recipe-names.ts`) has
   `client-library` and `scheduled-query`; this is closer to `scheduled-query`, which is what it sends. Minor.
3. **Open question: is it safe to send the window that is still open?** The docs say explicit sources send their own
   zeros, but not whether a `set` on the current, partial window can be judged as a low window before it is replaced.
   The showcase sends only closed windows. If partial windows are safe, the guide should say so; if not, it should
   warn.

(To be completed after the first live day: anything seen on countwatch.com, in alerts or in the API answers.)
