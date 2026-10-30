import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ATTACK, clearAll, frame } from "@/engine/acmd/dsl";
import type { BakeTables } from "@/engine/acmd/bakeTables";
import type { AcmdScript } from "@/engine/acmd/types";
import { registryContext, type SimContext } from "@/engine/simulate";
import type { FighterDef, MoveSlot } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { ACTIVE_SCRIPT_SLOTS } from "@/fighters/acmd/active";
import { LIMB_SCRIPT_SLOTS, withLimbScripts } from "@/fighters/acmd/limb";
import { BAKE_DIGEST } from "@/fighters/bake/digest";
import { STAGES } from "@/stages";
import { BAKE_IDLE_TIMEOUT_MS, BAKE_TOTAL_TIMEOUT_MS, bakedContext, fetchBake, installBake, prepareRoster, type FetchLike } from "./bake";
import { readBakeFromDisk } from "./bakeNode";
import { bootstrapEngine } from "./bootstrap";
import { localBuild } from "./onlineConfig";
import { GAME_ENGINE_RULES, GAME_SIM_CONTEXT, engineFingerprint, mergeSlots } from "./simContext";

const GZ = readFileSync(join(process.cwd(), "public", "bake", "roster.bin.gz"));

const serve = (bytes: Uint8Array, status = 200) => async () => ({
  ok: status === 200,
  status,
  body: new Response(bytes as BodyInit).body,
});

describe("loading the bake in the browser", () => {
  it("verifies the committed file and decodes it into tables with its fingerprint", async () => {
    const tables = await fetchBake(serve(new Uint8Array(GZ)));
    expect(tables.fingerprint).toBe(BAKE_DIGEST);
    expect(tables.hurtboxes("mario")?.length).toBeGreaterThan(0);
  });

  it("refuses a bake from another build rather than playing with the wrong bones", async () => {
    const raw = gunzipSync(GZ);
    raw[raw.length - 1] ^= 1;
    await expect(fetchBake(serve(new Uint8Array(gzipSync(raw))))).rejects.toThrow(/does not match this version/);
  });

  it("says what failed when the file is missing", async () => {
    await expect(fetchBake(serve(new Uint8Array(0), 404))).rejects.toThrow(/HTTP 404/);
  });

  // The digest is the only thing between a damaged file and the sim: a cut-off
  // download and a page that is not a bake (an error page served with a 200)
  // must fail in the bake's own sentence, with no tables and no legacy fallback.
  it("refuses a file that was cut short, in the bake's own sentence", async () => {
    const half = new Uint8Array(GZ.subarray(0, GZ.length >> 1));
    await expect(fetchBake(serve(half))).rejects.toThrow(/does not match this version of the game\. Reload the page\./);
  });

  it("refuses a body that is not gzip at all", async () => {
    const page = new TextEncoder().encode("<!doctype html><title>Not found</title>");
    await expect(fetchBake(serve(page))).rejects.toThrow(/does not match this version of the game\. Reload the page\./);
  });

  it("keeps what went wrong with the stream as the error's cause", async () => {
    const half = new Uint8Array(GZ.subarray(0, GZ.length >> 1));
    const err = await fetchBake(serve(half)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).cause).toBeDefined();
  });

  // The browser's own words for a network failure ("Failed to fetch", "network error") name nothing a player can
  // do. Both ways it fails are said in the deadline's style, and the browser's error stays attached for the logs
  // (part 1 re-review).
  it("says the data could not be reached when the request fails at once, keeping the browser's error as the cause", async () => {
    const offline = new TypeError("Failed to fetch");
    const err = await fetchBake(async () => {
      throw offline;
    }).catch((e: unknown) => e);
    expect((err as Error).message).toBe("Couldn't reach the fighters' animation data. Check your connection and try again.");
    expect((err as Error).cause).toBe(offline);
  });

  it("says the download broke off when the body fails partway, keeping the stream's error as the cause", async () => {
    const reset = new TypeError("network error");
    const body = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(c) {
        c.enqueue(new Uint8Array(GZ.subarray(0, 1024)));
        c.error(reset);
      },
    });
    const err = await fetchBake(async () => ({ ok: true, status: 200, body })).catch((e: unknown) => e);
    expect((err as Error).message).toBe("The fighters' animation data stopped downloading partway. Check your connection and try again.");
    expect((err as Error).cause).toBe(reset);
  });

  // The digest keeps unverified bytes away from the decoder: a file of the right
  // length whose header is wrong is refused as not this build's, before the decoder
  // ever reads it (and says "not a David-Smash bake").
  it("checks the digest before it decodes anything", async () => {
    const raw = gunzipSync(GZ);
    raw[0] ^= 1;
    const err = await fetchBake(serve(new Uint8Array(gzipSync(raw)))).catch((e: unknown) => e);
    expect((err as Error).message).toBe("The fighters' animation data does not match this version of the game. Reload the page.");
  });

  // Final review M3: an edge that answered with `Content-Encoding: gzip` has the
  // browser hand over the bake already decoded. Bytes that do not start with
  // gzip's `1f 8b` are checked as they are: only this build's bake passes.
  it("accepts the bake already decoded by the way, by the same length and digest", async () => {
    const tables = await fetchBake(serve(new Uint8Array(gunzipSync(GZ))));
    expect(tables.fingerprint).toBe(BAKE_DIGEST);
    expect(tables.hurtboxes("mario")?.length).toBeGreaterThan(0);
  });

  it("refuses decoded bytes that are not exactly this build's bake", async () => {
    const raw = gunzipSync(GZ);
    raw[raw.length - 1] ^= 1;
    await expect(fetchBake(serve(new Uint8Array(raw)))).rejects.toThrow(/^The fighters' animation data does not match this version of the game\. Reload the page\.$/);
    await expect(fetchBake(serve(new Uint8Array(gunzipSync(GZ).subarray(1))))).rejects.toThrow(/does not match this version of the game/);
  });

  // `crypto.subtle` exists only on a secure page (https, or localhost). Over plain
  // http on a LAN address the file cannot be checked at all, and "reload" would not
  // help, so it says so in a sentence of its own.
  describe("on a page that is not secure", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("says the file cannot be checked there, not that it does not match", async () => {
      vi.stubGlobal("crypto", {});
      const err = await fetchBake(serve(new Uint8Array(GZ))).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe(
        "The fighters' animation data can only be checked on a secure (https) page. Open the game over https, or on localhost.",
      );
    });
  });
});

/**
 * codex P1-1: the lobby waits for the bake before it opens a room, and `/play`
 * before it mounts a match, so a request that never answers, or a body that
 * stops, must not leave a player waiting for ever. But a slow link that keeps
 * delivering must get the file (codex confirm pass, P2: a total deadline of
 * 30 s failed a steady 0.5 Mbit/s link every time, and so every retry). So the
 * download gives up after `BAKE_IDLE_TIMEOUT_MS` with no bytes, and after
 * `BAKE_TOTAL_TIMEOUT_MS` however it is going; either way the fetch is aborted
 * and the player is told, in a sentence that says trying again may help.
 */
describe("a bake that does not arrive in time", () => {
  const TOO_SLOW = "The fighters' animation data stalled, or was too slow to finish downloading. Check your connection and try again.";

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** `p`, watched: whether it has settled yet, and what it settled with. */
  function watch<T>(p: Promise<T>) {
    const seen = { settled: false, value: undefined as T | undefined, error: undefined as unknown };
    p.then(
      (v) => {
        seen.settled = true;
        seen.value = v;
      },
      (e: unknown) => {
        seen.settled = true;
        seen.error = e;
      },
    );
    return seen;
  }

  /**
   * The bake as a link delivers it: the headers after `latencyMs`, then `bytes`
   * of the file every `everyMs` (fake time), for `chunks` chunks (all of it by
   * default) and then nothing more, ever. Each fetch's signal goes to `signals`.
   */
  function link(opts: { bytes: number; everyMs: number; latencyMs?: number; chunks?: number }, signals: AbortSignal[] = []): FetchLike {
    return (_url, init) => {
      signals.push(init.signal);
      return new Promise((resolve) =>
        setTimeout(() => {
          let at = 0;
          let sent = 0;
          const body = new ReadableStream<Uint8Array<ArrayBuffer>>({
            pull: (c) =>
              sent === opts.chunks
                ? new Promise<void>(() => {})
                : new Promise<void>((done) =>
                    setTimeout(() => {
                      const end = Math.min(GZ.length, at + opts.bytes);
                      c.enqueue(new Uint8Array(GZ.subarray(at, end)));
                      at = end;
                      sent += 1;
                      if (at >= GZ.length) c.close();
                      done();
                    }, opts.everyMs),
                  ),
          });
          resolve({ ok: true, status: 200, body });
        }, opts.latencyMs ?? 0),
      );
    };
  }

  it("gives up on a request that never answers once BAKE_IDLE_TIMEOUT_MS passes with nothing, aborts it, and says to try again", async () => {
    let signal: AbortSignal | undefined;
    const seen = watch(
      fetchBake((_url, init) => {
        signal = init.signal;
        return new Promise(() => {});
      }),
    );
    await vi.advanceTimersByTimeAsync(BAKE_IDLE_TIMEOUT_MS - 1);
    expect(seen.settled).toBe(false);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen.settled).toBe(true);
    expect((seen.error as Error).message).toBe(TOO_SLOW);
    expect(signal?.aborted).toBe(true);
  });

  it("gives up on a body that stops partway, BAKE_IDLE_TIMEOUT_MS after the last bytes it sent", async () => {
    // The headers after a second, five chunks a second apart (the last at 6 s), then nothing more, ever.
    const signals: AbortSignal[] = [];
    const seen = watch(fetchBake(link({ bytes: 62_500, everyMs: 1000, latencyMs: 1000, chunks: 5 }, signals)));
    await vi.advanceTimersByTimeAsync(6000 + BAKE_IDLE_TIMEOUT_MS - 1);
    expect(seen.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((seen.error as Error).message).toBe(TOO_SLOW);
    expect(signals[0].aborted).toBe(true);
  });

  it("lets a slow, steady link finish: the whole file at 0.5 Mbit/s, past the 30 s the old deadline allowed (codex P2)", async () => {
    // 62,500 bytes a second is 0.5 Mbit/s: 30 chunks after a second's latency, the last at 31 s.
    expect(GZ.length / 62_500).toBeGreaterThan(29);
    const seen = watch(fetchBake(link({ bytes: 62_500, everyMs: 1000, latencyMs: 1000 })));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(seen.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(seen.settled).toBe(true));
    expect(seen.error).toBeUndefined();
    expect(seen.value?.fingerprint).toBe(BAKE_DIGEST);
  });

  it("counts the answer as progress: a server that answers at 14 s and then sends a chunk every 14 s is never idle long enough", async () => {
    const seen = watch(fetchBake(link({ bytes: 1_000_000, everyMs: 14_000, latencyMs: 14_000 })));
    await vi.advanceTimersByTimeAsync(14_000 * 3 + 1000);
    await vi.waitFor(() => expect(seen.settled).toBe(true));
    expect(seen.error).toBeUndefined();
    expect(seen.value?.fingerprint).toBe(BAKE_DIGEST);
  });

  it("gives up on a trickle that never stalls once BAKE_TOTAL_TIMEOUT_MS has passed, so no link holds a player for ever", async () => {
    // A byte every ten seconds: never idle long enough, never done (the file would take about seven months).
    const signals: AbortSignal[] = [];
    const seen = watch(fetchBake(link({ bytes: 1, everyMs: 10_000 }, signals)));
    await vi.advanceTimersByTimeAsync(BAKE_TOTAL_TIMEOUT_MS - 1);
    expect(seen.settled).toBe(false);
    expect(signals[0].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((seen.error as Error).message).toBe(TOO_SLOW);
    expect(signals[0].aborted).toBe(true);
  });

  it("hands the deadline's signal to the browser's own fetch when no fetch is given (part 1 re-review)", async () => {
    // What the game calls: `fetchBake()` with the default, the platform's fetch. Without the signal the deadline
    // would still reject, but the request would go on downloading in the background after the player was told.
    const asked: [string, RequestInit | undefined][] = [];
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      asked.push([url, init]);
      return new Promise(() => {});
    });
    try {
      const seen = watch(fetchBake());
      await vi.advanceTimersByTimeAsync(0);
      expect(asked).toHaveLength(1);
      const [url, init] = asked[0];
      expect(url).toBe("/bake/roster.bin.gz");
      expect(init?.cache).toBe("no-cache");
      expect(init?.signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(BAKE_IDLE_TIMEOUT_MS);
      expect((seen.error as Error).message).toBe(TOO_SLOW);
      expect(init?.signal?.aborted).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("leaves no timer running once the bake is in, or once the file is refused", async () => {
    await fetchBake(serve(new Uint8Array(GZ)));
    expect(vi.getTimerCount()).toBe(0);
    await expect(fetchBake(serve(new Uint8Array(0), 404))).rejects.toThrow(/HTTP 404/);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is retried by the next page that asks, and that try can succeed", async () => {
    const { ensureBakeInstalled, GAME_SIM_CONTEXT: ctx } = await fresh();
    const seen = watch(ensureBakeInstalled(() => new Promise(() => {})));
    await vi.advanceTimersByTimeAsync(BAKE_IDLE_TIMEOUT_MS);
    expect((seen.error as Error).message).toBe(TOO_SLOW);
    expect(ctx.bake).toBeUndefined();
    vi.useRealTimers();
    const tables = await ensureBakeInstalled(serve(new Uint8Array(GZ)));
    expect(tables.fingerprint).toBe(BAKE_DIGEST);
    expect(ctx.bake).toBe(tables);
  });
});

describe("reading the committed bake from disk (vitest and Node scripts)", () => {
  it("decodes the committed file into the same tables the browser builds", async () => {
    const disk = readBakeFromDisk();
    const net = await fetchBake(serve(new Uint8Array(GZ)));
    expect(disk.fingerprint).toBe(BAKE_DIGEST);
    expect(disk.bones.fingerprint).toBe(net.bones.fingerprint);
    expect(disk.hurtboxes("fox")).toEqual(net.hurtboxes("fox"));
  });

  it("refuses a copy that is not this build's, naming the command that regenerates it", () => {
    const root = mkdtempSync(join(tmpdir(), "bake-node-"));
    try {
      mkdirSync(join(root, "public", "bake"), { recursive: true });
      const raw = gunzipSync(GZ);
      raw[raw.length - 1] ^= 1;
      writeFileSync(join(root, "public", "bake", "roster.bin.gz"), gzipSync(raw));
      expect(() => readBakeFromDisk(root)).toThrow(/UPDATE_BAKE=1 pnpm vitest run src\/render3d\/bake\/roster\.test\.ts/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/* ------------------------------------------------- the roster, at install -- */

/** A script that opens one hitbox, on `bone`, at `angle` degrees: the smallest thing the load check reads. */
function boxOn(bone: string, angle = 361): AcmdScript {
  return {
    name: "game_attack11",
    motion: "attack_11",
    commands: [frame(4), ATTACK({ id: 0, bone, damage: 2, angle, kbg: 100, bkb: 40, size: 4, x: 0, y: 6, z: 6 }), frame(7), clearAll()],
  };
}

const withScript = (def: FighterDef, slot: MoveSlot, script: AcmdScript): FighterDef => ({ ...def, scripts: { ...def.scripts, [slot]: script } });

const MARIO = FIGHTERS.find((f) => f.id === "mario")!;

describe("the roster, prepared against the bake (DISPATCH-NOTES 11.1)", () => {
  const tables = readBakeFromDisk();

  /** A bake that cannot place `bone`, otherwise this one. */
  const without = (bone: string): BakeTables => ({
    ...tables,
    bones: {
      ...tables.bones,
      pose: (id, motion, f, b, out) => b !== bone && tables.bones.pose(id, motion, f, b, out),
    },
  });

  it("accepts every script the roster runs against the real bake", () => {
    expect(() => prepareRoster(tables)).not.toThrow();
  });

  // Mario's baked bones are `armr` and no `handr` (decoded from the committed bake), so the same
  // script passes on the one and is refused on the other: it is the bone, not the script.
  it("refuses a script that names a bone the bake lacks, naming the fighter, the move and the bone", () => {
    expect(() => prepareRoster(tables, [withScript(MARIO, "jab1", boxOn("armr"))])).not.toThrow();
    expect(() => prepareRoster(tables, [withScript(MARIO, "jab1", boxOn("handr"))])).toThrow(
      /mario jab1 \(game_attack11\): no pose for bone "handr" of motion attack_11/,
    );
  });

  // Plan 3 Task 19's load check, run against the bake's bones as it runs against the root bone.
  describe.each([363, 366, 368])("an autolink angle the engine does not model, %i", (angle) => {
    it("is still refused, by fighter, move and angle", () => {
      expect(() => prepareRoster(tables, [withScript(MARIO, "jab1", boxOn("armr", angle))])).toThrow(
        new RegExp(`mario jab1: hitbox 0 has angle ${angle}°`),
      );
    });
  });

  it.each([365, 367])("still admits the autolink angle the engine does model, %i", (angle) => {
    expect(() => prepareRoster(tables, [withScript(MARIO, "jab1", boxOn("armr", angle))])).not.toThrow();
  });

  /** `tables`, with every bone lookup counted. */
  const counting = (): { tables: BakeTables; asked: () => number } => {
    let n = 0;
    return {
      tables: {
        ...tables,
        bones: {
          ...tables.bones,
          pose: (id, motion, f, b, out) => {
            n++;
            return tables.bones.pose(id, motion, f, b, out);
          },
        },
      },
      asked: () => n,
    };
  };

  // Task 11 review, folded into Task 13: the context hands out the limb defs, and
  // they are the very objects it prepared, so no def a match steps goes unchecked.
  it("hands out exactly the defs it prepared: asking for one places and checks nothing more", () => {
    const { tables: counted, asked } = counting();
    const ctx = bakedContext({ fighter: () => MARIO, stage: () => STAGES[0] }, counted);
    const done = asked();
    expect(done).toBeGreaterThan(0);
    const mario = ctx.fighter("mario");
    expect(asked()).toBe(done);
    expect(mario).toBe(withLimbScripts(MARIO, counted.bones));
    expect(ctx.fighter("mario")).toBe(mario);
    for (const slot of LIMB_SCRIPT_SLOTS.mario) expect(mario.scripts?.[slot], slot).toBeDefined();
  });

  it("checks a def the base hands out that is not the roster's, once, before handing it out", () => {
    const { tables: counted, asked } = counting();
    const ctx = bakedContext({ fighter: () => withScript(MARIO, "jab1", boxOn("handr")), stage: () => STAGES[0] }, counted);
    const done = asked();
    expect(() => ctx.fighter("mario")).toThrow(/mario jab1 \(game_attack11\): no pose for bone "handr"/);
    expect(asked()).toBeGreaterThan(done);
  });

  it("prepares each def against each table once, however often the context is built", () => {
    let asked = 0;
    const counted: BakeTables = {
      ...tables,
      bones: {
        ...tables.bones,
        pose: (id, motion, f, b, out) => {
          asked++;
          return tables.bones.pose(id, motion, f, b, out);
        },
      },
    };
    prepareRoster(counted);
    const once = asked;
    expect(once).toBeGreaterThan(0);
    prepareRoster(counted);
    bakedContext(registryContext, counted);
    expect(asked).toBe(once);
    // A different table is a different question.
    prepareRoster({ ...counted, bones: { ...counted.bones } });
    expect(asked).toBe(once * 2);
  });

  it("reads the roster from FIGHTERS, so it can run before the registry is filled", () => {
    const empty: Pick<SimContext, "fighter" | "stage"> = {
      fighter: () => {
        throw new Error("unregistered");
      },
      stage: () => {
        throw new Error("unregistered");
      },
    };
    expect(() => bakedContext(empty, tables)).not.toThrow();
    expect(() => bakedContext(empty, without("top"))).toThrow(/no pose for bone "top"/);
  });

  describe("installed", () => {
    // Everything an install writes, put back after each test: the game's context
    // (every key, so a `bake` added is removed) and its engine rules.
    let saved: { ctx: SimContext; rules: typeof GAME_ENGINE_RULES };
    beforeEach(() => {
      saved = { ctx: { ...GAME_SIM_CONTEXT }, rules: { ...GAME_ENGINE_RULES } };
    });
    afterEach(() => {
      for (const k of Object.keys(GAME_SIM_CONTEXT)) if (!(k in saved.ctx)) Reflect.deleteProperty(GAME_SIM_CONTEXT, k);
      Object.assign(GAME_SIM_CONTEXT, saved.ctx);
      Object.assign(GAME_ENGINE_RULES, saved.rules);
    });

    it("hands the sim the bake's bones and tables, the base's fighters with their limb-bone scripts on, and its stages", () => {
      const base: Pick<SimContext, "fighter" | "stage"> = { fighter: () => MARIO, stage: () => STAGES[0] };
      const ctx = bakedContext(base, tables);
      expect(ctx.bones).toBe(tables.bones);
      expect(ctx.bake).toBe(tables);
      expect(ctx.fighter("mario")).toBe(withLimbScripts(MARIO, tables.bones));
      expect(ctx.stage("battlefield")).toBe(STAGES[0]);
    });

    it("puts the bake in the game's context", () => {
      expect(GAME_SIM_CONTEXT.bake).toBeUndefined();
      installBake(tables);
      expect(GAME_SIM_CONTEXT.bones).toBe(tables.bones);
      expect(GAME_SIM_CONTEXT.bake).toBe(tables);
    });

    it("changes what the next online stamp says, because the stamp is read from the context when asked (11.3)", () => {
      const before = localBuild();
      installBake(tables);
      const after = localBuild();
      expect(after.bones).not.toBe(before.bones);
      expect(after.build).toBe(before.build);
      expect(after.protocol).toBe(before.protocol);
    });

    it("refuses, at install, a bake that cannot place a bone a script names, and installs none of it", () => {
      const before = localBuild();
      expect(() => installBake(without("top"))).toThrow(/mario .*no pose for bone "top"/);
      expect(GAME_SIM_CONTEXT.fighter).toBe(saved.ctx.fighter);
      expect(GAME_SIM_CONTEXT.bones).toBe(saved.ctx.bones);
      expect(GAME_SIM_CONTEXT.bake).toBeUndefined();
      expect(GAME_ENGINE_RULES.activeSlots).toBe(saved.rules.activeSlots);
      expect(localBuild()).toEqual(before);
    });

    it("switches the limb-bone scripts on, and the engine fingerprint says which ones run", async () => {
      const before = engineFingerprint();
      installBake(await fetchBake(serve(new Uint8Array(GZ))));
      const after = engineFingerprint();
      expect(after).not.toBe(before);
      for (const id of Object.keys(LIMB_SCRIPT_SLOTS)) {
        expect(GAME_ENGINE_RULES.activeSlots[id], id).toEqual(expect.arrayContaining([...(ACTIVE_SCRIPT_SLOTS[id] ?? []), ...LIMB_SCRIPT_SLOTS[id]]));
      }
      // Same bones, one limb move fewer: a different game, so a different fingerprint.
      const mario = GAME_ENGINE_RULES.activeSlots.mario.filter((s) => s !== LIMB_SCRIPT_SLOTS.mario[0]);
      expect(engineFingerprint(GAME_SIM_CONTEXT, { ...GAME_ENGINE_RULES, activeSlots: { ...GAME_ENGINE_RULES.activeSlots, mario } })).not.toBe(after);
    });

    // Carried from Plan 3 Task 20: the slots the stamp names are
    // the slots the game's fighters run from imported scripts — after the install as
    // before it (`simContext.test.ts`), now Plan 3's and the limb-bone ones together.
    it("names exactly the slots the game's fighters run from imported scripts", () => {
      bootstrapEngine();
      installBake(tables);
      const running = Object.fromEntries(FIGHTERS.map((d) => [d.id, Object.keys(GAME_SIM_CONTEXT.fighter(d.id).scripts ?? {}).sort()]));
      const named = Object.fromEntries(Object.entries(GAME_ENGINE_RULES.activeSlots).map(([id, slots]) => [id, [...slots].sort()]));
      expect(named).toEqual(running);
      expect(named).toEqual(Object.fromEntries(Object.entries(mergeSlots(ACTIVE_SCRIPT_SLOTS, LIMB_SCRIPT_SLOTS)).map(([id, slots]) => [id, [...slots].sort()])));
      expect(running.mario).toEqual(expect.arrayContaining([...LIMB_SCRIPT_SLOTS.mario]));
    });

    it("installs the same game twice over: the same defs and the same rules", () => {
      bootstrapEngine();
      installBake(tables);
      const mario = GAME_SIM_CONTEXT.fighter("mario");
      const rules = engineFingerprint();
      installBake(tables);
      expect(GAME_SIM_CONTEXT.fighter("mario")).toBe(mario);
      expect(engineFingerprint()).toBe(rules);
    });
  });
});

/* ---------------------------------------------- once per page, retried -- */

// A fresh module graph for each: `loadBake` keeps its promise in a module variable,
// and `ensureBakeInstalled` writes the game's context, so neither may leak between tests.
async function fresh() {
  vi.resetModules();
  const [bake, sim] = await Promise.all([import("./bake"), import("./simContext")]);
  return { ...bake, GAME_SIM_CONTEXT: sim.GAME_SIM_CONTEXT };
}

describe("loading it once per page", () => {
  it("fetches the file once, however many callers ask", async () => {
    const { loadBake } = await fresh();
    let fetches = 0;
    const counting = () => {
      fetches++;
      return serve(new Uint8Array(GZ))();
    };
    const [a, b] = [loadBake(counting), loadBake(counting)];
    expect(a).toBe(b);
    await a;
    await loadBake(counting);
    expect(fetches).toBe(1);
  });

  it("lets a failed fetch be retried", async () => {
    const { loadBake } = await fresh();
    await expect(loadBake(serve(new Uint8Array(0), 503))).rejects.toThrow(/HTTP 503/);
    await expect(loadBake(serve(new Uint8Array(GZ)))).resolves.toHaveProperty("fingerprint", BAKE_DIGEST);
  });

  it("is what a page awaits: it installs the bake in the game's context and returns the tables", async () => {
    const { ensureBakeInstalled, GAME_SIM_CONTEXT: ctx } = await fresh();
    expect(ctx.bake).toBeUndefined();
    const tables = await ensureBakeInstalled(serve(new Uint8Array(GZ)));
    expect(ctx.bake).toBe(tables);
    expect(ctx.bones).toBe(tables.bones);
  });

  // Task 11 review, folded into Task 13: every page that needs the bake awaits this
  // (and the lobby on every connect, ruling R2), often at once; the install runs once.
  it("installs once, however many callers await it, at once or later", async () => {
    const { ensureBakeInstalled, GAME_SIM_CONTEXT: ctx } = await fresh();
    let installs = 0;
    let bake: SimContext["bake"];
    Object.defineProperty(ctx, "bake", {
      configurable: true,
      enumerable: true,
      get: () => bake,
      set: (v: SimContext["bake"]) => {
        installs++;
        bake = v;
      },
    });
    const [a, b] = await Promise.all([ensureBakeInstalled(serve(new Uint8Array(GZ))), ensureBakeInstalled(serve(new Uint8Array(GZ)))]);
    expect(b).toBe(a);
    expect(await ensureBakeInstalled(serve(new Uint8Array(GZ)))).toBe(a);
    expect(installs).toBe(1);
    expect(ctx.bake).toBe(a);
  });

  it("lets a failed install be retried", async () => {
    const { ensureBakeInstalled, GAME_SIM_CONTEXT: ctx } = await fresh();
    await expect(ensureBakeInstalled(serve(new Uint8Array(0), 503))).rejects.toThrow(/HTTP 503/);
    const tables = await ensureBakeInstalled(serve(new Uint8Array(GZ)));
    expect(ctx.bake).toBe(tables);
  });

  it("installs nothing when the bake does not load, and says why", async () => {
    const { ensureBakeInstalled, GAME_SIM_CONTEXT: ctx } = await fresh();
    const before = ctx.bones;
    await expect(ensureBakeInstalled(serve(new Uint8Array(0), 404))).rejects.toThrow(/HTTP 404/);
    expect(ctx.bake).toBeUndefined();
    expect(ctx.bones).toBe(before);
  });
});
