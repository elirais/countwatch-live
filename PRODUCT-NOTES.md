# Product notes

Status (2 Nov): notes 2 (wording only), 4, 5, 6, 7, 8 and the SR-2 guide gaps are fixed in elirais/Magnum #87
(ADR 0067: ONB-1, ONB-2, ONB-4, ONB-6); note 1 in #88 (ONB-5, waits for the client release); note 3 stays open.

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

4. **`countwatch init` approves the key for whichever account the browser is signed in to, without asking.** The
   founder ran `npx countwatch init --print | npx wrangler secret put COUNTWATCH_API_KEY` for the showcase account; the
   approval page opened in the default browser (signed in as the founder) and the key went to the founder's account
   (`acc_e86c…`, not the showcase `acc_4155…`). Nothing on the approval page or in the terminal asked which account.
   Proposed: the approval page names the account in large type and offers "Use another account"; `init` prints the
   account name before it finishes, and with `--print` refuses to go on if the answer's account differs from an
   `--account` the person passed.
5. **`init --print` wrote `.mcp.json` into the showcase folder** (`"mcp_config": {"changed": true}`), although
   `--print` is meant only for a host's secrets. A file the person did not ask for, easy to commit by mistake. Proposed:
   `--print` changes no files.
6. **The `next` list mixes the account's old setup notices into a key request.** For a new key it listed 10 lines about
   other senders, Webhook URLs and groups. One line reads "The API key an API key has been silent 6 days" (a doubled
   name: a text bug).
7. **The docs' `--print | wrangler secret put` line fails quietly for a Worker that does not exist yet.** Wrangler asked
   "create a new Worker?" and, with the key on stdin, took its fallback "yes" and made an empty Worker. It worked here by
   luck. Proposed: the recipe says "deploy first" (or `wrangler secret put` after the first `wrangler deploy`).

8. **`countwatch init` creates `.gitignore` and `.mcp.json` in whatever branch is checked out.** Run on `main` (which
   had no `.gitignore`), it created one; switching to the work branch then failed ("untracked working tree files would
   be overwritten: .gitignore") until the founder deleted it. Proposed: `init` asks before creating files, and prints
   which files it created or changed.

## SR-2 (Wikipedia history)

Expectations written before reading the docs, and the docs' gaps, are in `docs/sr2-client-expectations.md`. The gaps a
customer meets in the guide's "Importing history": nothing on what happens to windows the live sender already sent
(the import stops at the first live window: only SPEC says so); nothing on running an import twice or on
`Idempotency-Key`; nothing on learning ending after an import; no copy-paste example.

- **Recent changes keep exactly 30 days.** Fetching `enwiki` took 84 minutes (5.05 million changes), so later wikis'
  30-day windows had moved: `dewiki` and `frwiki` history starts about 1.5 hours later than `enwiki`'s. Not a
  CountWatch issue; the script keeps those windows missing, not zero.

(To be completed after the import run: anything seen on countwatch.com, in alerts or in the API answers.)
