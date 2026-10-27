/**
 * ICE servers, in the shape the Worker returns and RTCPeerConnection wants.
 *
 * Shared by the Worker (which asks Cloudflare's TURN service) and the browser
 * (which asks the Worker), so both filter the same way and fall back to the
 * same thing. No DOM types: the Worker compiles this too.
 */

export interface IceServerWire {
  readonly urls: string | readonly string[];
  readonly username?: string;
  readonly credential?: string;
}

export interface IceResponse {
  readonly iceServers: readonly IceServerWire[];
  /** True when a TURN relay is among the servers. */
  readonly turn: boolean;
}

/** Cloudflare's STUN server: free, unlimited, no key (R§5). */
export const STUN_URL = "stun:stun.cloudflare.com:3478";

/** What a match gets with no TURN key configured: direct and LAN paths only. */
export const STUN_ONLY: IceResponse = { iceServers: [{ urls: [STUN_URL] }], turn: false };

/** Browsers block port 53, and a TURN url on it times out (Cloudflare's TURN docs). */
const PORT_53 = /:53(\?|$)/;

export function urlsOf(server: IceServerWire): readonly string[] {
  return typeof server.urls === "string" ? [server.urls] : server.urls;
}

export function withoutPort53(servers: readonly IceServerWire[]): IceServerWire[] {
  const out: IceServerWire[] = [];
  for (const server of servers) {
    const kept = urlsOf(server).filter((url) => !PORT_53.test(url));
    if (kept.length > 0) out.push({ ...server, urls: kept });
  }
  return out;
}

export function hasTurn(servers: readonly IceServerWire[]): boolean {
  return servers.some((s) => urlsOf(s).some((url) => url.startsWith("turn:") || url.startsWith("turns:")));
}

export function parseIceServers(value: unknown): IceServerWire[] | null {
  if (!Array.isArray(value)) return null;
  const out: IceServerWire[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const record = item as Record<string, unknown>;
    const urls = record.urls;
    const list =
      typeof urls === "string"
        ? [urls]
        : Array.isArray(urls) && urls.every((u) => typeof u === "string")
          ? (urls as string[])
          : null;
    if (!list) return null;
    out.push({
      urls: list,
      ...(typeof record.username === "string" ? { username: record.username } : {}),
      ...(typeof record.credential === "string" ? { credential: record.credential } : {}),
    });
  }
  return out;
}

export function parseIceResponse(value: unknown): IceResponse | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const iceServers = parseIceServers(record.iceServers);
  if (!iceServers) return null;
  return { iceServers, turn: record.turn === true };
}
