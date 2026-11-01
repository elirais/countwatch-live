// What the Wikipedia reader watches and how it sends (SR-1, ADR 0066 #4 in elirais/Magnum).

/** The ten language Wikipedias watched (founder, 1 Nov 2026). Each gives two watches: human and bot edits. */
export const WIKIS = ["enwiki", "dewiki", "frwiki", "eswiki", "jawiki", "ruwiki", "itwiki", "zhwiki", "ptwiki", "hewiki"] as const;
export const EDITORS = ["human", "bot"] as const;
export type Editor = (typeof EDITORS)[number];

export const METRIC = "wiki_edits";
export const STREAM_URL = "https://stream.wikimedia.org/v2/stream/recentchange";
/** Wikimedia asks for a User-Agent that names the client and a contact (Wikimedia API access policy). */
export const USER_AGENT = "countwatch-live/0.1 (https://github.com/elirais/countwatch-live)";

/** CountWatch keeps counts in 5-minute windows (UTC). */
export const BUCKET_MS = 5 * 60_000;
/** Each flush resends the last 30 minutes as window totals (`set`), so late events still land in their own window. */
export const RESEND_MS = 30 * 60_000;
/** CountWatch takes ingest points up to 6 hours old; the reader sends nothing older than this (a 10-minute margin). */
export const MAX_AGE_MS = 6 * 60 * 60_000 - 10 * 60_000;
/** A read ends this long after the 5-minute boundary, so events stamped just before it have arrived. */
export const GRACE_MS = 20_000;
/** A jump in event time this large after a reconnect means the stream did not resume where it stopped. */
export const RESUME_GAP_MS = 2 * 60_000;
