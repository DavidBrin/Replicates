/**
 * Id generation.
 *
 * Ids are only ever minted inside event handlers and effects, never during
 * render — a fresh id in a render body would differ between the server pass
 * and the client pass and produce a hydration mismatch.
 */

/** Prefixed UUID, e.g. `block-9f2c…`. The prefix makes debugging readable. */
export function newId(prefix: string): string {
  return `${prefix}-${uuid()}`;
}

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for older runtimes and some test environments.
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
