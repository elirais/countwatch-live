// CountWatch Live Worker (ADR 0066 in elirais/Magnum): the cron keeps the Wikipedia reader running; GET /status shows it.
import { WikiReader } from "./wiki-reader.ts";

export { WikiReader };

interface Env {
  WIKI: DurableObjectNamespace<WikiReader>;
}

const reader = (env: Env) => env.WIKI.get(env.WIKI.idFromName("wiki"));

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/status") {
      return Response.json(await reader(env).status(), { headers: { "cache-control": "no-store" } });
    }
    return new Response("Not found", { status: 404 });
  },
  async scheduled(_c: ScheduledController, env: Env): Promise<void> {
    await reader(env).ensure();
  },
} satisfies ExportedHandler<Env>;
