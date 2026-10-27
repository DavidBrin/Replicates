/**
 * Where the browser gets its ICE servers: the Worker's `/api/ice`.
 *
 * Every failure falls back to STUN-only, and so does slowness: the lobby waits
 * on this before it opens the room socket, and a TURN service having a bad
 * minute must cost a relay, not the match. Under `next dev` there is no Worker
 * at all, the request 404s, and the answer is the same STUN fallback.
 */

import { STUN_ONLY, hasTurn, parseIceResponse, withoutPort53, type IceResponse } from "./iceConfig";

export const ICE_ENDPOINT = "/api/ice";
export const ICE_TIMEOUT_MS = 4000;

export interface IceFetchInit {
  readonly signal: AbortSignal;
  readonly cache: "no-store";
}

export type IceFetch = (url: string, init: IceFetchInit) => Promise<{ readonly ok: boolean; json(): Promise<unknown> }>;

const browserFetch: IceFetch = (url, init) => fetch(url, init);

export async function fetchIceServers(
  fetchFn: IceFetch = browserFetch,
  timeoutMs: number = ICE_TIMEOUT_MS,
): Promise<IceResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(ICE_ENDPOINT, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) return STUN_ONLY;
    const parsed = parseIceResponse(await res.json());
    if (!parsed) return STUN_ONLY;
    const usable = withoutPort53(parsed.iceServers);
    // `turn` is recomputed, as the Worker does: dropping port 53 can remove the only relay url.
    return usable.length > 0 ? { iceServers: usable, turn: hasTurn(usable) } : STUN_ONLY;
  } catch {
    return STUN_ONLY;
  } finally {
    clearTimeout(timer);
  }
}

export function toRtcIceServers(response: IceResponse): RTCIceServer[] {
  return response.iceServers.map((server) => ({
    urls: typeof server.urls === "string" ? server.urls : [...server.urls],
    ...(server.username !== undefined ? { username: server.username } : {}),
    ...(server.credential !== undefined ? { credential: server.credential } : {}),
  }));
}
