import { normalizeRoomCode } from "../../src/net/roomCode";

export type Route =
  | { readonly kind: "ice" }
  | { readonly kind: "room"; readonly code: string }
  | { readonly kind: "not-found" }
  | { readonly kind: "assets" };

const ROOM_PATH = /^\/ws\/room\/([A-Za-z0-9-]{1,16})$/;

/**
 * Where a request goes. wrangler.jsonc runs the Worker first only for /api/*
 * and /ws/*; everything else is served from out/ before this runs, so
 * "assets" is only reached for paths the asset layer handed back.
 */
export function routeFor(method: string, pathname: string): Route {
  if (pathname === "/api/ice") return method === "GET" ? { kind: "ice" } : { kind: "not-found" };
  const room = ROOM_PATH.exec(pathname);
  if (room) {
    // Exact after normalising: the browser normalises before it connects, so
    // anything else did not come from our client.
    const code = normalizeRoomCode(room[1]);
    return code !== null && code === room[1] ? { kind: "room", code } : { kind: "not-found" };
  }
  if (pathname.startsWith("/api/") || pathname.startsWith("/ws/")) return { kind: "not-found" };
  return { kind: "assets" };
}
