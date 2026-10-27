import type { Env } from "./env";
import { iceServersFor } from "./ice";
import { routeFor } from "./routes";

export { RoomDO } from "./roomDO";

/** The client gives up on /api/ice after 4 s (src/net/iceServers.ts); answer sooner. */
const TURN_API_TIMEOUT_MS = 3000;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const route = routeFor(request.method, new URL(request.url).pathname);
    switch (route.kind) {
      case "ice": {
        // The deadline lives in this adapter (FetchInit has no signal) and is
        // never cleared, so it also bounds iceServersFor's res.json() read; an
        // abort there lands in its catch and the answer is STUN-only.
        const body = await iceServersFor(env, (url, init) =>
          fetch(url, { ...init, signal: AbortSignal.timeout(TURN_API_TIMEOUT_MS) }),
        );
        // Minted credentials are good for 4 hours; no cache may hand them to someone else.
        return Response.json(body, { headers: { "Cache-Control": "no-store" } });
      }
      case "room": {
        if (request.headers.get("Upgrade") !== "websocket") {
          return new Response("Expected a WebSocket upgrade", { status: 426 });
        }
        return env.ROOMS.get(env.ROOMS.idFromName(route.code)).fetch(request);
      }
      case "not-found":
        return Response.json({ error: "not found" }, { status: 404 });
      case "assets":
        return env.ASSETS.fetch(request);
    }
  },
} satisfies ExportedHandler<Env>;
