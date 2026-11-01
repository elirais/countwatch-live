// SR-1: the Wikipedia reader Durable Object. Its alarm runs one cycle (cycle.ts), stores the state and sets the next
// alarm at once; the cron re-arms a lost alarm.
import { DurableObject } from "cloudflare:workers";
import { emptyState, type ReaderState, runCycle } from "./cycle.ts";

interface ReaderEnv {
  COUNTWATCH_API_URL: string;
  COUNTWATCH_API_KEY?: string;
}

export class WikiReader extends DurableObject<ReaderEnv> {
  async alarm(): Promise<void> {
    try {
      const prev = (await this.ctx.storage.get<ReaderState>("state")) ?? emptyState();
      const next = await runCycle(prev, { fetch: (i, init) => fetch(i, init), now: Date.now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), apiUrl: this.env.COUNTWATCH_API_URL, apiKey: this.env.COUNTWATCH_API_KEY });
      await this.ctx.storage.put("state", next);
    } finally {
      await this.ctx.storage.setAlarm(Date.now() + 1000);
    }
  }

  /** Called by the cron every 5 minutes: start the loop if no alarm is set (first deploy, or a lost alarm). */
  async ensure(): Promise<boolean> {
    if ((await this.ctx.storage.getAlarm()) !== null) return false;
    await this.ctx.storage.setAlarm(Date.now() + 1000);
    return true;
  }

  /** What `/status` shows: positions and the last read and flush. No counts per watch, no secrets. */
  async status(): Promise<Record<string, unknown>> {
    const s = (await this.ctx.storage.get<ReaderState>("state")) ?? emptyState();
    const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
    return { last_event_at: iso(s.lastEventAt), covered_from: iso(s.coveredFrom), last_read: s.lastRead && { ...s.lastRead, at: iso(s.lastRead.at) }, last_flush: s.lastFlush && { ...s.lastFlush, at: iso(s.lastFlush.at) }, alarm: iso(await this.ctx.storage.getAlarm()) };
  }
}
