/**
 * Loading the bake in the browser and installing it in the game's context
 * (Plan 4).
 *
 * `public/bake/roster.bin.gz` is fetched once, within a deadline
 * (`BAKE_TIMEOUT_MS`), gunzipped with the platform's `DecompressionStream`,
 * checked against the digest compiled into this build (`BAKE_DIGEST`) and
 * decoded into the tables the sim reads. A file that does not match is
 * refused: a stale cached bake would put hitboxes somewhere other than where
 * this build's renderer draws limbs, and online it would desync. There is no
 * fallback to the legacy bones: a bake that does not load, verify or install
 * is an error the caller shows, because the game it would play is not the one
 * its peer plays.
 */

import { decodeBake } from "@/engine/acmd/bakeCodec";
import { bakeTables, type BakeTables } from "@/engine/acmd/bakeTables";
import type { BoneTable } from "@/engine/acmd/bones";
import { prepareFighterScripts } from "@/engine/acmd/run";
import { registryContext, type SimContext } from "@/engine/simulate";
import type { FighterDef } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { ACTIVE_SCRIPT_SLOTS } from "@/fighters/acmd/active";
import { LIMB_SCRIPT_SLOTS, withLimbScripts } from "@/fighters/acmd/limb";
import { BAKE_BYTES, BAKE_DIGEST } from "@/fighters/bake/digest";
import { GAME_ENGINE_RULES, GAME_SIM_CONTEXT, mergeSlots } from "./simContext";

export const BAKE_URL = "/bake/roster.bin.gz";

/** `fetch`, as far as the bake uses it: the signal is what ends a download that ran out of time. */
export type FetchLike = (url: string, init: { readonly signal: AbortSignal }) => Promise<Pick<Response, "ok" | "status" | "body">>;

/**
 * The longest the bake's request and the read of its body may take, together.
 * The file is about 1.8 MB gzipped (1,845,102 bytes when this was written), so
 * thirty seconds lets it through a connection of half a megabit a second
 * (14.8 Mbit in 30 s). Without a deadline a request that never answers, or a
 * body that never closes, leaves the player on the lobby's "Connecting…" or
 * `/play`'s "Loading fighters…" for ever (codex P1-1).
 */
export const BAKE_TIMEOUT_MS = 30_000;

/** On the deadline. Trying again may well work, so it says so. */
const TOO_SLOW = "The fighters' animation data took too long to download. Check your connection and try again.";

/** gzip's magic number, the first two bytes of every gzip file (RFC 1952 §2.3.1). */
const isGzip = (bytes: Uint8Array): boolean => bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(bytes as BodyInit).body!.pipeThrough(
    new DecompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>,
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * `BAKE_URL`'s body, every byte of it, or a rejection: the request's own, or
 * `TOO_SLOW` once `BAKE_TIMEOUT_MS` has passed since asking, whether the
 * request never answered or its body never closed. On the deadline the fetch
 * is aborted, which ends its body's stream too.
 */
async function download(fetchFn: FetchLike): Promise<Uint8Array> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(TOO_SLOW));
      controller.abort();
    }, BAKE_TIMEOUT_MS);
  });
  const read = (async () => {
    const res = await fetchFn(BAKE_URL, { signal: controller.signal });
    if (!res.ok || res.body === null) throw new Error(`Could not load the fighters' animation data (HTTP ${res.status}).`);
    return new Uint8Array(await new Response(res.body).arrayBuffer());
  })();
  // What the abort makes of a download the deadline already ended is nobody's to hear.
  read.catch(() => {});
  try {
    return await Promise.race([read, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

const MISMATCH = "The fighters' animation data does not match this version of the game. Reload the page.";

/**
 * `crypto.subtle` exists only on a secure page: https, or localhost. Over plain
 * http on another address (two devices on a LAN against `next dev`) the file
 * cannot be checked at all, and reloading would not help, so it says that.
 */
const INSECURE = "The fighters' animation data can only be checked on a secure (https) page. Open the game over https, or on localhost.";

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = (globalThis.crypto as Crypto | undefined)?.subtle as SubtleCrypto | undefined;
  if (subtle === undefined) throw new Error(INSECURE);
  const digest = await subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Fetch, verify and decode the bake. Rejects with a sentence a player can read:
 * the file missing, too slow to arrive (`BAKE_TIMEOUT_MS`), anything that is
 * not exactly this build's bake (another build's, cut short, corrupt, or a page
 * that is not a bake at all), or a page that cannot check it. The length and
 * digest are checked before the decoder reads a byte.
 *
 * Bytes that do not start with gzip's magic number are checked as they are
 * (final review M3): an edge that answered with `Content-Encoding: gzip` has
 * the browser hand over the bake already decoded. The same length and digest
 * decide, so nothing but this build's bake passes either way.
 */
export async function fetchBake(fetchFn: FetchLike = (u, init) => fetch(u, { cache: "no-cache", signal: init.signal })): Promise<BakeTables> {
  const body = await download(fetchFn);
  let bytes = body;
  if (isGzip(body)) {
    try {
      bytes = await gunzip(body);
    } catch (e) {
      // A cut-off or corrupt stream makes the decompressor throw, often with no message at all.
      throw new Error(MISMATCH, { cause: e });
    }
  }
  if (bytes.length !== BAKE_BYTES || (await sha256Hex(bytes)) !== BAKE_DIGEST) throw new Error(MISMATCH);
  return bakeTables(decodeBake(bytes), BAKE_DIGEST);
}

/** Defs `prepareFighterScripts` has already accepted against a bone table. */
const prepared = new WeakMap<BoneTable, WeakSet<FighterDef>>();

/**
 * `def` as the game plays it against this bake: its limb-bone scripts on, their
 * `MoveDef` tables placed through the bake's bones (`withLimbScripts`, ruling
 * R1(a)), and every script it can run checked against those bones
 * (`prepareFighterScripts`) the first time it is asked for. The same object
 * every time for the same def and bones, so what a context hands out is what
 * was checked.
 */
function gameFighter(def: FighterDef, tables: BakeTables): FighterDef {
  let done = prepared.get(tables.bones);
  if (done === undefined) {
    done = new WeakSet();
    prepared.set(tables.bones, done);
  }
  const game = withLimbScripts(def, tables.bones);
  if (!done.has(game)) {
    prepareFighterScripts(game, tables.bones);
    done.add(game);
  }
  return game;
}

/**
 * Get every script of the roster ready for the bake's bones, at install, as
 * `registerFighters` does for the root bone (`prepareFighterScripts`): a script
 * naming a bone the bake cannot place, or a box at an autolink angle the engine
 * does not model (363, 366, 368), throws here, naming the fighter and the move,
 * and not inside `step()` the first frame that hitbox goes live.
 *
 * What is prepared is each def as the game plays it (`gameFighter`): with its
 * limb-bone scripts on (Task 13), the very objects the baked context hands out.
 * `registerFighters` prepared the plain defs against `registryContext.bones`,
 * the root bone, so that check says nothing about the bake's. The roster is read
 * from `FIGHTERS` and not the registry because an install can run before
 * `bootstrapEngine()` has filled it; `bootstrapEngine` registers these same
 * objects, so their game forms are what the context hands out.
 *
 * Each (def, bone table) is built and prepared once, however often a context is
 * built over it. `roster` is for tests: a def that is not in the game.
 */
export function prepareRoster(tables: BakeTables, roster: readonly FighterDef[] = FIGHTERS): void {
  for (const def of roster) gameFighter(def, tables);
}

/**
 * The game's context over `base` with the bake in it: baked bones for hitboxes
 * and the online fingerprint, clocks and hurtboxes for the bone hurtboxes and
 * ECB, and `base`'s fighters with their limb-bone scripts on, which only the bake
 * can place (Task 13). Throws, building nothing, if a roster script cannot run
 * against the bake's bones (`prepareRoster`). A def `base` hands out that is not
 * the roster's (a test's) is built and checked the first time it is asked for.
 */
export function bakedContext(base: Pick<SimContext, "fighter" | "stage">, tables: BakeTables): SimContext {
  prepareRoster(tables);
  return {
    fighter: (id) => gameFighter(base.fighter(id), tables),
    stage: (id) => base.stage(id),
    bones: tables.bones,
    bake: tables,
  };
}

/**
 * Put the bake into Plan 2's `GAME_SIM_CONTEXT`, which every match steps with,
 * and the limb-bone slots it switches on into `GAME_ENGINE_RULES`, so the
 * online fingerprint covers `limb.json` as well as the bones. All or nothing: a
 * bake the roster cannot run on throws before either is touched.
 */
export function installBake(tables: BakeTables): void {
  const ctx = bakedContext(registryContext, tables);
  const activeSlots = mergeSlots(ACTIVE_SCRIPT_SLOTS, LIMB_SCRIPT_SLOTS);
  GAME_SIM_CONTEXT.fighter = ctx.fighter;
  GAME_SIM_CONTEXT.bones = ctx.bones;
  GAME_SIM_CONTEXT.bake = ctx.bake;
  GAME_ENGINE_RULES.activeSlots = activeSlots;
}

let loading: Promise<BakeTables> | null = null;

/** The bake, fetched at most once per page; a failed fetch may be retried. */
export function loadBake(fetchFn?: FetchLike): Promise<BakeTables> {
  if (loading === null) {
    loading = fetchBake(fetchFn).catch((e: unknown) => {
      loading = null;
      throw e;
    });
  }
  return loading;
}

let installing: Promise<BakeTables> | null = null;

/**
 * Load the bake (once) and install it in `GAME_SIM_CONTEXT` and
 * `GAME_ENGINE_RULES`, once per page: callers awaiting it at the same time, or
 * later, share the one install. A caller that arrives while an install is
 * failing shares that failure, as `loadBake`'s callers share a failed fetch;
 * the next call after it starts again, so a retry works. What every page
 * awaits before a match. Rejects with a sentence a player can read (`fetchBake`)
 * or, for a bake the roster cannot run on, the fighter and move that cannot.
 *
 * Installing changes what `localBuild()` stamps mid-session: the stamp is read
 * from the context when asked (`onlineConfig.test.ts` pins that), so `bones` is
 * the bake's from here on, and `engineRules` names the limb-bone slots too. A
 * `hello` sent before this resolves says the legacy bones and Plan 3's slots,
 * and the peer refuses it for good (`engine-mismatch`).
 *
 * Task 20 attaches here (ruling R2): `OnlineLobby.tsx`'s `connect()` awaits
 * `ensureBakeInstalled()` before `openSession`, in its "connecting" status, and
 * shows a rejection's message as the lobby's error, so the first `hello` already
 * carries the bake. Nothing in the lobby or the online store awaits it yet.
 */
export function ensureBakeInstalled(fetchFn?: FetchLike): Promise<BakeTables> {
  if (installing === null) {
    installing = loadBake(fetchFn)
      .then((tables) => {
        installBake(tables);
        return tables;
      })
      .catch((e: unknown) => {
        installing = null;
        throw e;
      });
  }
  return installing;
}
