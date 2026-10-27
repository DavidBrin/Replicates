/**
 * Four uppercase letters, minus `I` and `O`.
 *
 * One player reads this aloud to the other, which is the whole design brief:
 * short enough to say in one breath, and free of the pairs that get misheard.
 * `I`/`1` and `O`/`0` are the classic offenders, and dropping them costs
 * nothing — 24^4 is 331,776 rooms.
 *
 * Lives on its own (it used to sit in the Trystero adapter) because the
 * Cloudflare Worker validates codes too, and the Worker must not import
 * Trystero.
 */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const ROOM_CODE_LENGTH = 4;

export function makeRoomCode(random: () => number = defaultRandom): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Accept what a human typed, or reject it.
 *
 * Lowercase, stray spaces and a dash are typos, not different rooms, so they
 * are repaired. `I`, `O`, `1` and `0` are not in the alphabet, so a code
 * containing one was misheard — and silently joining a *different* valid room
 * would be worse than telling them to look again.
 */
export function normalizeRoomCode(input: string): string | null {
  const cleaned = clean(input);
  if (cleaned.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of cleaned) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  return cleaned;
}

/** Why a typed code is not a code, in words for the lobby — or null if it is one. */
export function roomCodeProblem(input: string): string | null {
  const cleaned = clean(input);
  if (cleaned.length !== ROOM_CODE_LENGTH) return `A room code is ${ROOM_CODE_LENGTH} letters.`;
  if (/[IO10]/.test(cleaned)) return "Room codes never use I, O, 1 or 0. Check that letter with the host.";
  if (normalizeRoomCode(cleaned) === null) return "A room code is letters only.";
  return null;
}

function clean(input: string): string {
  return input.trim().toUpperCase().replace(/[\s-]/g, "");
}

function defaultRandom(): number {
  // Not `globalThis.crypto`: the Worker compiles this file under workers-types,
  // where that property does not exist; the bare global does in both programs.
  const cryptoObj: Crypto | undefined = typeof crypto === "undefined" ? undefined : crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    const buffer = new Uint32Array(1);
    cryptoObj.getRandomValues(buffer);
    return buffer[0] / 0x1_0000_0000;
  }
  return Math.random();
}
