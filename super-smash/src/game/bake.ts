/**
 * Loading the bake in the browser and installing it in the game's context
 * (Plan 4).
 *
 * `public/bake/roster.bin.gz` is fetched once, gunzipped with the platform's
 * `DecompressionStream`, checked against the digest compiled into this build
 * (`BAKE_DIGEST`) and decoded into the tables the sim reads. A file that does
 * not match is refused: a stale cached bake would put hitboxes somewhere other
 * than where this build's renderer draws limbs, and online it would desync.
 * There is no fallback to the legacy bones: a bake that does not load, verify
 * or install is an error the caller shows, because the game it would play is
 * not the one its peer plays.
 */

import { decodeBake } from "@/engine/acmd/bakeCodec";
import { bakeTables, type BakeTables } from "@/engine/acmd/bakeTables";
import type { BoneTable } from "@/engine/acmd/bones";
import { prepareFighterScripts } from "@/engine/acmd/run";
import { registryContext, type SimContext } from "@/engine/simulate";
import type { FighterDef } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { BAKE_BYTES, BAKE_DIGEST } from "@/fighters/bake/digest";
import { GAME_SIM_CONTEXT } from "./simContext";

export const BAKE_URL = "/bake/roster.bin.gz";

export type FetchLike = (url: string) => Promise<Pick<Response, "ok" | "status" | "body">>;

async function gunzip(body: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const stream = body.pipeThrough(new DecompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const MISMATCH = "The fighters' animation data does not match this version of the game. Reload the page.";

/**
 * Fetch, verify and decode the bake. Rejects with a sentence a player can read:
 * the file missing, or anything that is not exactly this build's bake (another
 * build's, cut short, corrupt, or a page that is not gzip at all).
 */
export async function fetchBake(fetchFn: FetchLike = (u) => fetch(u, { cache: "no-cache" })): Promise<BakeTables> {
  const res = await fetchFn(BAKE_URL);
  if (!res.ok || res.body === null) throw new Error(`Could not load the fighters' animation data (HTTP ${res.status}).`);
  let bytes: Uint8Array;
  try {
    bytes = await gunzip(res.body);
  } catch (e) {
    // A cut-off or corrupt stream makes the decompressor throw, often with no message at all.
    throw new Error(MISMATCH, { cause: e });
  }
  if (bytes.length !== BAKE_BYTES || (await sha256Hex(bytes)) !== BAKE_DIGEST) throw new Error(MISMATCH);
  return bakeTables(decodeBake(bytes), BAKE_DIGEST);
}

/** Defs `prepareFighterScripts` has already accepted against a bone table. */
const prepared = new WeakMap<BoneTable, WeakSet<FighterDef>>();

/**
 * Get every script of the roster ready for the bake's bones, at install, as
 * `registerFighters` does for the root bone (`prepareFighterScripts`): a script
 * naming a bone the bake cannot place, or a box at an autolink angle the engine
 * does not model (363, 366, 368), throws here, naming the fighter and the move,
 * and not inside `step()` the first frame that hitbox goes live.
 *
 * `registerFighters` prepared the same defs against `registryContext.bones`, the
 * root bone, so that check says nothing about the bake's. The roster is read from
 * `FIGHTERS` and not the registry because an install can run before
 * `bootstrapEngine()` has filled it; `bootstrapEngine` registers these same
 * objects, so they are what the context hands out. (Task 13: the context will hand
 * out the limb-script defs, `withLimbScripts(def, tables.bones)`, and those are
 * what this prepares.)
 *
 * Each (def, bone table) is prepared once, however often a context is built over
 * it. `roster` is for tests: a def that is not in the game.
 */
export function prepareRoster(tables: BakeTables, roster: readonly FighterDef[] = FIGHTERS): void {
  let done = prepared.get(tables.bones);
  if (done === undefined) {
    done = new WeakSet();
    prepared.set(tables.bones, done);
  }
  for (const def of roster) {
    if (done.has(def)) continue;
    prepareFighterScripts(def, tables.bones);
    done.add(def);
  }
}

/**
 * The game's context over `base` with the bake in it: baked bones for hitboxes
 * and the online fingerprint, clocks and hurtboxes for the bone hurtboxes and
 * ECB. Throws, building nothing, if a roster script cannot run against the
 * bake's bones (`prepareRoster`). (Task 13 adds the fighters' limb-bone scripts here.)
 */
export function bakedContext(base: Pick<SimContext, "fighter" | "stage">, tables: BakeTables): SimContext {
  prepareRoster(tables);
  return {
    fighter: (id) => base.fighter(id),
    stage: (id) => base.stage(id),
    bones: tables.bones,
    bake: tables,
  };
}

/**
 * Put the bake into Plan 2's `GAME_SIM_CONTEXT`, which every match steps with.
 * All or nothing: a bake the roster cannot run on throws before the context is touched.
 */
export function installBake(tables: BakeTables): void {
  const ctx = bakedContext(registryContext, tables);
  GAME_SIM_CONTEXT.fighter = ctx.fighter;
  GAME_SIM_CONTEXT.bones = ctx.bones;
  GAME_SIM_CONTEXT.bake = ctx.bake;
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

/**
 * Load the bake (once) and install it in `GAME_SIM_CONTEXT`; what every page
 * awaits before a match. Rejects with a sentence a player can read (`fetchBake`)
 * or, for a bake the roster cannot run on, the fighter and move that cannot.
 *
 * Installing changes what `localBuild()` stamps mid-session: the stamp is read
 * from the context when asked (`onlineConfig.test.ts` pins that), so `bones` is
 * the bake's from here on (and `engineRules` too once Task 13 adds the limb-bone
 * slots to `GAME_ENGINE_RULES`). A `hello` sent before this resolves says the
 * legacy bones, and the peer refuses it for good (`engine-mismatch`).
 *
 * Task 20 attaches here (ruling R2): `OnlineLobby.tsx`'s `connect()` awaits
 * `ensureBakeInstalled()` before `openSession`, in its "connecting" status, and
 * shows a rejection's message as the lobby's error, so the first `hello` already
 * carries the bake. Nothing in the lobby or the online store awaits it yet.
 */
export async function ensureBakeInstalled(fetchFn?: FetchLike): Promise<BakeTables> {
  const tables = await loadBake(fetchFn);
  installBake(tables);
  return tables;
}
