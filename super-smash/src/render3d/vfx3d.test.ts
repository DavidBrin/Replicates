import { describe, expect, it, vi } from "vitest";
import { Color, InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";

import { ATTACK, clearAll, frame } from "@/engine/acmd/dsl";
import { SHIELD_MAX_HEALTH } from "@/engine/constants";
import { fx, toFloat } from "@/engine/fixed";
import { capsulesOverlap, circle } from "@/engine/hitbox";
import { shieldBubble } from "@/engine/shield";
import { createInitialState, step } from "@/engine/simulate";
import type { SimContext } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type {
  FighterDef,
  FighterState,
  GameState,
  InputFrame,
  MatchRules,
  StageDef,
  StepEvents,
} from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { readBakeFromDisk } from "@/game/bakeNode";
import { makeEvents, makeFighter, makeState } from "@/render/testFixtures";
import { createVfx, ingestEvents, spawnBurst, spawnDust, spawnHitSpark, updateVfx } from "@/render/vfx";
import { MAX_SHIELDS, MAX_SPRITES, SPRITE_KINDS, SPRITE_Z, createVfx3D, shieldLook, type Vfx3D } from "./vfx3d";

const roster = (id: string): FighterDef => FIGHTERS.find((f) => f.id === id)!;
const mario = roster("mario");

/** Where instance `i` of the layer's "sparks" or "shields" mesh sits and how big it is, as three holds it. */
function instance(layer: Vfx3D, name: "sparks" | "shields", i: number): { position: Vector3; scale: Vector3; rotation: Quaternion } {
  const mesh = layer.group.getObjectByName(name) as InstancedMesh;
  const out = { position: new Vector3(), scale: new Vector3(), rotation: new Quaternion() };
  mesh.getMatrixAt(i, new Matrix4()).decompose(out.position, out.rotation, out.scale);
  return out;
}
/** Instance `i`'s colour, the three floats three hands the shader. */
function instanceColour(layer: Vfx3D, name: "sparks" | "shields", i: number): Color {
  const mesh = layer.group.getObjectByName(name) as InstancedMesh;
  return new Color().fromArray(mesh.instanceColor!.array, i * 3);
}

/* ------------------------------------------------------------ the sim -- */

const BAKE = readBakeFromDisk();
const FLAT: StageDef = {
  id: "flat",
  name: "Flat",
  series: "test",
  platforms: [{ x: 0, y: 0, halfWidth: fx(80), soft: false, ledges: true }],
  blastZone: { left: fx(-240), right: fx(240), top: fx(192), bottom: fx(-140) },
  spawns: [
    { x: fx(-40), y: 0 },
    { x: fx(40), y: 0 },
  ],
  theme: "test",
};
const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: false };

interface Frame {
  readonly state: GameState;
  readonly events: StepEvents;
}

/**
 * Port 0, a hand-built jabber whose one box is live on frame 4, standing at
 * `fromX` facing right, and Mario (port 1) at x 30 facing left, in the baked
 * world on a flat stage; ten frames of port 0 pressing attack on the first and
 * Mario holding `hold`. `box` is the jab's one hitbox: a sphere, or a capsule
 * given `z2`, measured from the jabber's feet.
 */
function jab(
  box: { forward: number; up: number; radius: number; far?: number },
  fromX: number,
  setup: (mario: FighterState) => void = () => {},
  hold: InputFrame = 0,
): Frame[] {
  const swinger: FighterDef = {
    ...mario,
    id: "swinger",
    scripts: {
      jab1: {
        name: "game_attack11",
        motion: "attack_11",
        commands: [
          frame(4),
          ATTACK({
            id: 0, bone: "top", damage: 5, angle: 45, kbg: 50, bkb: 30,
            size: box.radius, x: 0, y: box.up, z: box.forward, ...(box.far === undefined ? {} : { z2: box.far }),
          }),
          frame(5),
          clearAll(),
        ],
      },
    },
  };
  const ctx: SimContext = { fighter: (id) => (id === "swinger" ? swinger : roster(id)), stage: () => FLAT, bones: BAKE.bones, bake: BAKE };
  let state = createInitialState("flat", [{ defId: "swinger" }, { defId: "mario" }], RULES, 12345, ctx);
  state.fighters.forEach((f, i) => {
    Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, y: 0, intangible: 0, invincible: 0 });
    f.x = i === 0 ? fx(fromX) : fx(30);
    f.facing = i === 0 ? 1 : -1;
  });
  setup(state.fighters[1]);
  const out: Frame[] = [];
  let prev: readonly InputFrame[] = [0, 0];
  for (let i = 0; i < 10; i++) {
    const now = [i === 0 ? Btn.Attack : 0, hold];
    const r = step(state, now, { prevInputs: prev, ctx });
    out.push(r);
    state = r.state;
    prev = now;
  }
  return out;
}

/* ------------------------------------------------------------- shield -- */

describe("the shield bubble is the sim's own", () => {
  it("sits and shrinks exactly as shieldBubble says, for every fighter and with health", () => {
    for (const def of FIGHTERS) {
      for (const hp of [SHIELD_MAX_HEALTH, SHIELD_MAX_HEALTH / 2, 0]) {
        const f = makeFighter({ action: "shield", shieldHealth: hp, x: fx(10), y: fx(2) });
        const look = shieldLook(f, def, 0)!;
        const sim = shieldBubble(f, def);
        expect(look.radius).toBeCloseTo(toFloat(sim.r), 9);
        expect(look.x).toBeCloseTo(toFloat(sim.x1), 9);
        expect(look.y).toBeCloseTo(toFloat(sim.y1), 9);
      }
    }
    const full = shieldLook(makeFighter({ action: "shield", shieldHealth: SHIELD_MAX_HEALTH }), mario, 0)!;
    const low = shieldLook(makeFighter({ action: "shield", shieldHealth: SHIELD_MAX_HEALTH / 5 }), mario, 0)!;
    expect(low.radius).toBeLessThan(full.radius);
  });

  it("stays centred half-way up the legacy box, where Plan 3 put it (R11: the shield bone is Plan 5's)", () => {
    for (const def of FIGHTERS) {
      const f = makeFighter({ action: "shield", x: fx(-7), y: fx(3) });
      const look = shieldLook(f, def, 0)!;
      expect(look.x).toBeCloseTo(-7, 9);
      expect(look.y).toBeCloseTo(3 + toFloat(Math.trunc(def.attributes.height / 2)), 9);
    }
  });

  it("is absent unless the fighter is shielding, and flashes white on a perfect shield", () => {
    expect(shieldLook(makeFighter({ action: "stand" }), mario, 0)).toBeNull();
    expect(shieldLook(makeFighter({ action: "shieldRelease", actionFrame: 1 }), mario, 6)!.colour).toBe("#FFFFFF");
  });

  it("fades in on raise and out on release, in the fighter's port colour", () => {
    const at = (action: "shieldStart" | "shield" | "shieldRelease", actionFrame: number) =>
      shieldLook(makeFighter({ action, actionFrame, port: 2 }), mario, 0)!;
    expect(at("shieldStart", 0).alpha).toBeLessThan(at("shield", 0).alpha);
    expect(at("shieldRelease", 8).alpha).toBeLessThan(at("shieldRelease", 1).alpha);
    expect(at("shield", 0).colour).toBe("#FFC61E");
  });

  describe("what is drawn is what blocks", () => {
    for (const id of ["mario", "donkeyKong"]) {
      it(`${id}: the drawn sphere's surface is the edge of the sim's bubble, at every health`, () => {
        const def = roster(id);
        for (const hp of [SHIELD_MAX_HEALTH, SHIELD_MAX_HEALTH / 2, SHIELD_MAX_HEALTH / 10]) {
          const f = makeFighter({ action: "shield", shieldHealth: hp, x: fx(10), y: fx(2) });
          const layer = createVfx3D();
          layer.update(createVfx(), [shieldLook(f, def, 0)]);
          const { position, scale } = instance(layer, "shields", 0);
          expect(scale.x).toBe(scale.y);
          expect(scale.x).toBe(scale.z);
          expect(position.z).toBe(0);
          const sim = shieldBubble(f, def);
          // A point of no size, 2% inside and 2% outside the drawn surface, all the way round.
          for (let k = 0; k < 16; k++) {
            const a = (k / 16) * Math.PI * 2;
            const at = (reach: number) => circle(fx(position.x + Math.cos(a) * scale.x * reach), fx(position.y + Math.sin(a) * scale.x * reach), 0);
            expect(capsulesOverlap(at(0.98), sim)).toBe(true);
            expect(capsulesOverlap(at(1.02), sim)).toBe(false);
          }
          layer.dispose();
        }
      });
    }

    it("the sim blocks a box on the sphere it draws, and lets one through outside it", () => {
      // A box at Mario's head, from the front, against a full shield and a worn one.
      // The full bubble (radius 9.7 about the middle of the legacy box, R11) reaches
      // the head; one worn to a tenth (radius 2.3) does not, so the same box is a
      // shield hit once and a body hit once, and the drawn sphere says which.
      const outcomes: boolean[] = [];
      for (const [hp, drawnReaches] of [
        [SHIELD_MAX_HEALTH, true],
        [SHIELD_MAX_HEALTH / 10, false],
      ] as const) {
        const box = { forward: 8, up: 13, radius: 1 };
        const frames = jab(box, 29 - box.forward, (m) => Object.assign(m, { action: "shield", actionFrame: 10, shieldHealth: hp }), Btn.Shield);
        const landed = frames.find((fr) => fr.events.hits.length + fr.events.shieldHits.length > 0)!;
        expect(landed).toBeDefined();
        const sim = landed.state.fighters[1];
        // The bubble the layer draws for the victim as the box met it: its health is
        // the one the hit left it, so take the box's own radius off the comparison.
        const layer = createVfx3D();
        layer.update(createVfx(), [shieldLook({ ...sim, shieldHealth: hp }, mario, 0)]);
        const drawn = instance(layer, "shields", 0);
        const gap = Math.hypot(drawn.position.x - 29, drawn.position.y - box.up);
        expect(gap <= drawn.scale.x + box.radius).toBe(drawnReaches);
        outcomes.push(landed.events.shieldHits.length > 0);
        layer.dispose();
      }
      expect(outcomes).toEqual([true, false]);
    });
  });
});

/* ------------------------------------------------------------ sprites -- */

describe("3D sparks, KO blasts and shields as instances", () => {
  const hit = (n: number): StepEvents =>
    makeEvents({
      hits: Array.from({ length: n }, () => ({
        attacker: 0,
        victim: 1,
        damage: 4096 * 12,
        x: 0,
        y: 4096 * 6,
        contactX: 0,
        contactY: 4096 * 6,
        knockback: 4096 * 80,
        angle: 45,
        hitboxId: 0,
      })),
    });

  it("draws a hit's sparks and burst, and leaves dust to the 2D overlay", () => {
    const v = createVfx();
    const state = makeState();
    ingestEvents(v, hit(1), state);
    spawnDust(v, 0, 0, 1, 6);
    const fx = createVfx3D();
    fx.update(v, []);
    const kinds = new Set(v.particles.map((p) => p.kind));
    expect(kinds.has("dust")).toBe(true);
    expect(fx.counts().sprites).toBe(v.particles.filter((p) => p.kind === "spark" || p.kind === "burst").length);
    expect(fx.counts().sprites).toBeGreaterThan(0);
    expect([...SPRITE_KINDS].sort()).toEqual(["burst", "spark"]);
  });

  it("draws a KO's blast, and leaves its ring to the 2D overlay", () => {
    const v = createVfx();
    ingestEvents(v, makeEvents({ kos: [{ port: 1, x: fx(120), y: fx(40), kind: "blast" }] }), makeState());
    const layer = createVfx3D();
    layer.update(v, []);
    expect(v.particles.some((p) => p.kind === "ring")).toBe(true);
    const blast = v.particles.filter((p) => p.kind === "spark");
    expect(blast.length).toBeGreaterThan(20);
    expect(layer.counts().sprites).toBe(blast.length);
    // Every streak is at the blast, in front of the fighters' plane.
    for (let i = 0; i < layer.counts().sprites; i++) {
      const { position } = instance(layer, "sparks", i);
      expect(Math.hypot(position.x - 120, position.y - 40)).toBeLessThan(5);
      expect(position.z).toBe(SPRITE_Z);
    }
  });

  it("never draws more instances than it allocated, however busy the screen", () => {
    // The 2D pool caps itself at the same 640, so flooding it through
    // ingestEvents can never exceed MAX_SPRITES; hand the layer more than that.
    const v = createVfx();
    ingestEvents(v, hit(1), makeState());
    const spark = v.particles.find((p) => p.kind === "spark")!;
    v.particles.length = 0;
    for (let i = 0; i < MAX_SPRITES + 50; i++) v.particles.push({ ...spark });
    const fx = createVfx3D();
    fx.update(v, []);
    expect(fx.counts().sprites).toBe(MAX_SPRITES);
  });

  it("holds as many instances as the 2D pool holds particles", () => {
    const v = createVfx();
    for (let i = 0; i < 100; i++) spawnBurst(v, 0, 0, 34, "#FFFFFF", 3);
    expect(v.particles).toHaveLength(MAX_SPRITES);
  });

  it("puts the sprites between the fighters' plane and the camera, which looks down −Z", () => {
    expect(SPRITE_Z).toBeGreaterThan(0);
  });

  it("places one bubble per shielding fighter, and no more than four", () => {
    const layer = createVfx3D();
    layer.update(createVfx(), [shieldLook(makeFighter({ action: "shield" }), mario, 0), null]);
    expect(layer.counts().shields).toBe(1);
    const five = Array.from({ length: MAX_SHIELDS + 1 }, (_, port) => shieldLook(makeFighter({ action: "shield", port }), mario, 0));
    layer.update(createVfx(), five);
    expect(layer.counts().shields).toBe(MAX_SHIELDS);
  });

  describe("a spark lands where the box touched the body (R9)", () => {
    it("at the contact point of a capsule hit, a blade's length from the box's near end", () => {
      // The jabber's box is a capsule from 4 forward to 34: its near end is 26 units
      // short of Mario, who stands 30 from the jabber's feet; the contact is on him.
      const frames = jab({ forward: 4, up: 6, radius: 2, far: 34 }, 0);
      const landed = frames.find((fr) => fr.events.hits.length > 0)!;
      expect(landed).toBeDefined();
      const [h] = landed.events.hits;
      expect([h.contactX, h.contactY]).not.toEqual([h.x, h.y]);
      expect(toFloat(h.contactX) - toFloat(h.x)).toBeGreaterThan(10);

      const v = createVfx();
      ingestEvents(v, landed.events, landed.state);
      const layer = createVfx3D();
      layer.update(v, []);
      // The first particle is the burst, the star at the point of contact itself.
      const burst = instance(layer, "sparks", 0);
      expect(burst.position.x).toBeCloseTo(toFloat(h.contactX), 5);
      expect(burst.position.y).toBeCloseTo(toFloat(h.contactY), 5);
      expect(burst.position.z).toBe(SPRITE_Z);
      expect(Math.hypot(burst.position.x - toFloat(h.x), burst.position.y - toFloat(h.y))).toBeGreaterThan(10);
      // And every spark of the fan was thrown from there too, none from the near end.
      for (const p of v.particles) expect([p.x, p.y]).toEqual([toFloat(h.contactX), toFloat(h.contactY)]);
      layer.dispose();
    });
  });

  describe("draws what the 2D overlay draws", () => {
    it("stretches a spark back along its own velocity, and swells a burst as it ages", () => {
      const v = createVfx();
      spawnHitSpark(v, 3, 5, 14, 120, 0);
      const layer = createVfx3D();
      layer.update(v, []);
      const burstAt = (age: number) => {
        const p = v.particles.find((q) => q.kind === "burst")!;
        p.life = Math.round(p.maxLife * (1 - age));
        layer.update(v, []);
        return instance(layer, "sparks", 0).scale.x;
      };
      expect(burstAt(0.9)).toBeGreaterThan(burstAt(0));

      layer.update(v, []);
      const i = v.particles.findIndex((q) => q.kind === "spark");
      const spark = v.particles[i];
      const { position, rotation } = instance(layer, "sparks", i);
      const heading = new Vector3(1, 0, 0).applyQuaternion(rotation);
      expect(Math.atan2(heading.y, heading.x)).toBeCloseTo(Math.atan2(spark.vy, spark.vx), 5);
      // The head is at the particle; the streak's middle trails behind it.
      expect((position.x - spark.x) * spark.vx + (position.y - spark.y) * spark.vy).toBeLessThan(0);
      layer.dispose();
    });

    it("hands the shader the sRGB colour the 2D overlay fills with, dimmed as it fades", () => {
      const v = createVfx();
      spawnHitSpark(v, 0, 0, 14, 120, 0);
      const spark = v.particles.find((p) => p.kind === "spark")!;
      spark.colour = "#ff8040";
      spark.life = spark.maxLife;
      const layer = createVfx3D();
      layer.update(v, []);
      const i = v.particles.indexOf(spark);
      const want = new Color("#ff8040");
      const got = instanceColour(layer, "sparks", i);
      expect([got.r, got.g, got.b]).toEqual([want.r, want.g, want.b].map((c) => expect.closeTo(c, 6)));
      spark.life = spark.maxLife * 0.25;
      layer.update(v, []);
      const dim = instanceColour(layer, "sparks", i);
      expect(dim.r).toBeCloseTo(want.r * 0.45, 6);
      layer.dispose();
    });

    it("fills a bubble with its port's colour scaled by its alpha, additively", () => {
      const f = makeFighter({ action: "shield", port: 1 });
      const look = shieldLook(f, mario, 0)!;
      const layer = createVfx3D();
      layer.update(createVfx(), [null, look]);
      const want = new Color(look.colour).multiplyScalar(look.alpha);
      const got = instanceColour(layer, "shields", 0);
      expect([got.r, got.g, got.b]).toEqual([want.r, want.g, want.b].map((c) => expect.closeTo(c, 6)));
      layer.dispose();
    });
  });

  describe("builds nothing once it is running", () => {
    function busy() {
      const v = createVfx();
      for (let i = 0; i < 10; i++) {
        ingestEvents(v, hit(1), makeState());
        spawnBurst(v, 5, 5, 34, "#BFE8FF", 2);
      }
      return v;
    }
    const shields = [shieldLook(makeFighter({ action: "shield", port: 0 }), mario, 0), shieldLook(makeFighter({ action: "shield", port: 1 }), mario, 3)];

    it("keeps its meshes, buffers, geometries and materials from frame to frame", () => {
      const layer = createVfx3D();
      const v = busy();
      layer.update(v, shields);
      const meshes = layer.group.children.map((c) => c as InstancedMesh);
      const before = meshes.map((m) => [m, m.geometry, m.material, m.instanceMatrix, m.instanceMatrix.array, m.instanceColor, m.instanceColor!.array]);
      for (let i = 0; i < 30; i++) {
        updateVfx(v);
        layer.update(v, shields);
      }
      expect(layer.group.children).toHaveLength(2);
      const after = layer.group.children.map((c) => {
        const m = c as InstancedMesh;
        return [m, m.geometry, m.material, m.instanceMatrix, m.instanceMatrix.array, m.instanceColor, m.instanceColor!.array];
      });
      for (let i = 0; i < before.length; i++) for (let j = 0; j < before[i].length; j++) expect(after[i][j]).toBe(before[i][j]);
      layer.dispose();
    });

    it("never parses a colour string on the frame path", () => {
      const layer = createVfx3D();
      const v = busy();
      layer.update(v, shields);
      const set = vi.spyOn(Color.prototype, "set");
      const style = vi.spyOn(Color.prototype, "setStyle");
      for (let i = 0; i < 10; i++) layer.update(v, shields);
      expect(set).not.toHaveBeenCalled();
      expect(style).not.toHaveBeenCalled();
      set.mockRestore();
      style.mockRestore();
      layer.dispose();
    });

    it("draws the particles that are left, and nothing stale, as the pool empties", () => {
      const layer = createVfx3D();
      const v = busy();
      layer.update(v, shields);
      const live = v.particles.filter((p) => SPRITE_KINDS.has(p.kind)).length;
      expect(layer.counts()).toEqual({ sprites: live, shields: 2 });
      // What three draws is the mesh's own count, not ours.
      expect((layer.group.getObjectByName("sparks") as InstancedMesh).count).toBe(live);
      expect((layer.group.getObjectByName("shields") as InstancedMesh).count).toBe(2);
      for (let i = 0; i < 40; i++) updateVfx(v);
      layer.update(v, [null, null]);
      expect(layer.counts()).toEqual({ sprites: 0, shields: 0 });
      expect((layer.group.getObjectByName("sparks") as InstancedMesh).count).toBe(0);
      expect((layer.group.getObjectByName("shields") as InstancedMesh).count).toBe(0);
      layer.dispose();
    });
  });

  it("frees its buffers, materials and texture on dispose", () => {
    const fx = createVfx3D();
    const geometries = vi.fn();
    const materials = vi.fn();
    const textures = vi.fn();
    const meshes = vi.fn();
    type Disposable = { addEventListener(t: string, f: () => void): void };
    fx.group.traverse((o) => {
      const { geometry, material } = o as { geometry?: Disposable; material?: Disposable & { map?: Disposable | null } };
      geometry?.addEventListener("dispose", geometries);
      material?.addEventListener("dispose", materials);
      material?.map?.addEventListener("dispose", textures);
      if ((o as InstancedMesh).isInstancedMesh) o.addEventListener("dispose", meshes);
    });
    fx.dispose();
    expect(geometries).toHaveBeenCalledTimes(2);
    expect(materials).toHaveBeenCalledTimes(2);
    expect(textures).toHaveBeenCalledTimes(1);
    // The meshes' own, which is what lets the renderer free their instance buffers.
    expect(meshes).toHaveBeenCalledTimes(2);
    expect(fx.group.children).toHaveLength(0);
  });
});
