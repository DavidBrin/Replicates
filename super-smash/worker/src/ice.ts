/**
 * `GET /api/ice`: short-lived Cloudflare TURN credentials, or STUN alone.
 *
 * TURN is what makes the game work across the NATs a direct connection cannot
 * cross — the replica's documented "no TURN" gap (R§5). It is optional on
 * purpose: with no key configured, or with the TURN API down, the answer is
 * STUN-only and every LAN and most home connections still work. A failure
 * here must never be the reason a lobby cannot start.
 *
 * The API (developers.cloudflare.com/realtime/turn/generate-credentials):
 * POST …/turn/keys/<TURN_KEY_ID>/credentials/generate-ice-servers with a
 * bearer token and {"ttl": seconds}; 201 with { iceServers: [...] }.
 */

import { STUN_ONLY, hasTurn, parseIceServers, withoutPort53, type IceResponse } from "../../src/net/iceConfig";

/**
 * One hour: a session is one lobby and one match, and a minted credential
 * relays for as long as it lives, so it lives no longer than one needs. Far
 * under the spec's 48 h ceiling.
 */
export const TURN_TTL_SECONDS = 60 * 60;

export interface TurnEnv {
  readonly TURN_KEY_ID?: string;
  readonly TURN_KEY_API_TOKEN?: string;
}

export interface FetchInit {
  readonly method: "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface FetchResult {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResult>;

export function turnCredentialsUrl(keyId: string): string {
  return `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`;
}

export async function iceServersFor(env: TurnEnv, fetchFn: FetchLike): Promise<IceResponse> {
  const keyId = env.TURN_KEY_ID?.trim();
  const token = env.TURN_KEY_API_TOKEN?.trim();
  if (!keyId || !token) return STUN_ONLY;
  try {
    const res = await fetchFn(turnCredentialsUrl(keyId), {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
    });
    if (!res.ok) {
      // The one clue `wrangler tail` gives when TURN goes dark. The status
      // alone: never the body, never the key or the token.
      console.warn(`/api/ice: the TURN API answered ${res.status}; serving STUN only`);
      return STUN_ONLY;
    }
    const body = await res.json();
    const raw = typeof body === "object" && body !== null ? (body as Record<string, unknown>).iceServers : undefined;
    // The docs show an array; a single server object is accepted too, rather
    // than silently degrading to STUN over a shape difference.
    const list = Array.isArray(raw) ? raw : typeof raw === "object" && raw !== null ? [raw] : null;
    const servers = list ? parseIceServers(list) : null;
    if (!servers) return STUN_ONLY;
    const usable = withoutPort53(servers);
    return usable.length > 0 ? { iceServers: usable, turn: hasTurn(usable) } : STUN_ONLY;
  } catch {
    return STUN_ONLY;
  }
}
