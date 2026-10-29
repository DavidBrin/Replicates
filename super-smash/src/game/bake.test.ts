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
import { BAKE_DIGEST } from "@/fighters/bake/digest";
import { STAGES } from "@/stages";
import { bakedContext, fetchBake, installBake, prepareRoster } from "./bake";
import { readBakeFromDisk } from "./bakeNode";
import { localBuild } from "./onlineConfig";
import { GAME_SIM_CONTEXT } from "./simContext";

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
    let saved: Pick<SimContext, "fighter" | "bones" | "bake">;
    beforeEach(() => {
      saved = { fighter: GAME_SIM_CONTEXT.fighter, bones: GAME_SIM_CONTEXT.bones, bake: GAME_SIM_CONTEXT.bake };
    });
    afterEach(() => {
      Object.assign(GAME_SIM_CONTEXT, saved);
      if (saved.bake === undefined) delete GAME_SIM_CONTEXT.bake;
    });

    it("hands the sim the bake's bones and tables, and the base's fighters and stages", () => {
      const base: Pick<SimContext, "fighter" | "stage"> = { fighter: () => MARIO, stage: () => STAGES[0] };
      const ctx = bakedContext(base, tables);
      expect(ctx.bones).toBe(tables.bones);
      expect(ctx.bake).toBe(tables);
      expect(ctx.fighter("mario")).toBe(MARIO);
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
      expect(GAME_SIM_CONTEXT.bones).toBe(saved.bones);
      expect(GAME_SIM_CONTEXT.bake).toBeUndefined();
      expect(localBuild()).toEqual(before);
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

  it("installs nothing when the bake does not load, and says why", async () => {
    const { ensureBakeInstalled, GAME_SIM_CONTEXT: ctx } = await fresh();
    const before = ctx.bones;
    await expect(ensureBakeInstalled(serve(new Uint8Array(0), 404))).rejects.toThrow(/HTTP 404/);
    expect(ctx.bake).toBeUndefined();
    expect(ctx.bones).toBe(before);
  });
});
