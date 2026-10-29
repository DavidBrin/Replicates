import { afterEach, describe, expect, it, vi } from "vitest";
import { AdditiveBlending, Color, InstancedMesh, Matrix4, Quaternion, Vector3, type MeshBasicMaterial } from "three";

import { ATTACK, clearAll, frame } from "@/engine/acmd/dsl";
import { SHIELD_MAX_HEALTH, SHIELD_RELEASE_FRAMES } from "@/engine/constants";
import { fx, toFloat } from "@/engine/fixed";
import { capsulesOverlap, circle } from "@/engine/hitbox";
import { shieldBubble } from "@/engine/shield";
import { createInitialState, step } from "@/engine/simulate";
import type { SimContext } from "@/engine/simulate";
import { STATUS_KIND_OF_ACTION } from "@/engine/status/kind";
import { Btn } from "@/engine/types";
import type {
  ActionState,
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
import { MAX_ZOOM, MIN_ZOOM, VIEW_HEIGHT, VIEW_WIDTH, createCamera, worldToScreen } from "@/render/camera";
import { makeEvents, makeFighter, makeState } from "@/render/testFixtures";
import { BURST_MAX_GROWTH, createVfx, ingestEvents, spawnBurst, spawnDust, spawnHitSpark, updateVfx, type Particle, type VfxState } from "@/render/vfx";
import { applySideCamera, createSideCamera } from "./camera3d";
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

  const SHIELDING: readonly ActionState[] = ["shieldStart", "shield", "shieldStun", "shieldRelease"];

  it("is absent unless the fighter is shielding: not in any other of the 48 actions, a broken shield included", () => {
    const actions = Object.keys(STATUS_KIND_OF_ACTION) as ActionState[];
    expect(actions).toHaveLength(48);
    for (const action of actions) {
      const look = shieldLook(makeFighter({ action }), mario, 0);
      if (SHIELDING.includes(action)) expect(look, action).not.toBeNull();
      else expect(look, action).toBeNull();
    }
  });

  it("fades in on raise and out on release, in the fighter's port colour, as the 2D bubble does", () => {
    const at = (action: ActionState, actionFrame: number) => shieldLook(makeFighter({ action, actionFrame, port: 2 }), mario, 0)!;
    // Up at 0.42; rising from 0.35 of it over the first three frames; falling to nothing over the release.
    expect(at("shield", 0).alpha).toBeCloseTo(0.42, 9);
    expect(at("shieldStun", 0).alpha).toBeCloseTo(0.42, 9);
    expect(at("shieldStart", 0).alpha).toBeCloseTo(0.42 * 0.35, 9);
    expect(at("shieldStart", 1).alpha).toBeCloseTo(0.42 * (1 / 3 + 0.35), 9);
    expect(at("shieldStart", 3).alpha).toBeCloseTo(0.42, 9);
    expect(at("shieldRelease", 0).alpha).toBeCloseTo(0.42, 9);
    expect(at("shieldRelease", 4).alpha).toBeCloseTo(0.42 * (1 - 4 / SHIELD_RELEASE_FRAMES), 9);
    expect(at("shieldRelease", SHIELD_RELEASE_FRAMES).alpha).toBe(0);
    expect(at("shield", 0).colour).toBe("#FFC61E");
  });

  it("flashes white on a perfect shield, from 0.95 as bright down to 0.41, in the geometry and the colour the layer draws", () => {
    const f = makeFighter({ action: "shieldRelease", actionFrame: 1 });
    for (const [flash, alpha] of [[10, 0.95], [5, 0.65], [1, 0.41]] as const) {
      const look = shieldLook(f, mario, flash)!;
      expect(look.colour).toBe("#FFFFFF");
      expect(look.alpha).toBeCloseTo(alpha, 9);
      const layer = createVfx3D();
      layer.update(createVfx(), [look]);
      const got = instanceColour(layer, "shields", 0);
      expect([got.r, got.g, got.b]).toEqual([alpha, alpha, alpha].map((c) => expect.closeTo(c, 6)));
      layer.dispose();
    }
    // And none once the flash is out: the port's own colour, at the release's fade.
    expect(shieldLook(f, mario, 0)!.colour).not.toBe("#FFFFFF");
  });

  // Task 18 review, carried (B8): a perfect shield flashes in whichever shielding
  // action it lands, not only the release: the raise's fade-in and the stun's
  // steady alpha give way to the flash, which is what shows the parry.
  it.each(["shieldStart", "shieldStun"] as const)("flashes white on a perfect shield in %s too, over that action's own alpha", (action) => {
    const f = makeFighter({ action, actionFrame: 0 });
    for (const [flash, alpha] of [[10, 0.95], [5, 0.65], [1, 0.41]] as const) {
      const look = shieldLook(f, mario, flash)!;
      expect(look.colour, `${action} flash ${flash}`).toBe("#FFFFFF");
      expect(look.alpha, `${action} flash ${flash}`).toBeCloseTo(alpha, 9);
    }
    expect(shieldLook(f, mario, 0)!.colour).not.toBe("#FFFFFF");
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

  describe("draws over everything, in the fighters' own plane", () => {
    const mesh = (layer: Vfx3D, name: "sparks" | "shields") => layer.group.getObjectByName(name) as InstancedMesh;

    it("is hidden by nothing: sprites take no depth test and write no depth, and are drawn after the bubbles", () => {
      // The 2D overlay draws a spark over every fighter, projectile and platform, and a
      // side view has no depth to hide one behind: not the stage's front face (z +18) and
      // not a fat fighter's own bust (Donkey Kong's is 6.09 across).
      const layer = createVfx3D();
      const sprites = mesh(layer, "sparks").material as MeshBasicMaterial;
      expect(sprites.depthTest).toBe(false);
      expect(sprites.depthWrite).toBe(false);
      expect(sprites.transparent).toBe(true);
      expect(sprites.blending).toBe(AdditiveBlending);
      // Among the transparent things three sorts by depth, the sprites go last: at the same depth as
      // everything else in the plane their order would otherwise be whichever mesh was made last.
      expect(mesh(layer, "sparks").renderOrder).toBeGreaterThan(0);
      expect(mesh(layer, "sparks").renderOrder).toBeGreaterThan(mesh(layer, "shields").renderOrder);
      layer.dispose();
    });

    it("keeps a bubble in the scene's depth, so the floor clips its lower half and the fighter shows through", () => {
      const layer = createVfx3D();
      const bubble = mesh(layer, "shields").material as MeshBasicMaterial;
      expect(bubble.depthTest).toBe(true);
      expect(bubble.depthWrite).toBe(false);
      expect(bubble.transparent).toBe(true);
      expect(bubble.blending).toBe(AdditiveBlending);
      layer.dispose();
    });

    it("lands every sprite on the pixel the 2D overlay draws it at, at every zoom and shake, out to the screen's edge", () => {
      expect(SPRITE_Z).toBe(0);
      const point = (x: number, y: number): Particle => ({ kind: "burst", x, y, vx: 0, vy: 0, life: 6, maxLife: 6, size: 1, colour: "#FFFFFF", rotation: 0, spin: 0, gravity: 0, drag: 1 });
      for (const zoom of [MIN_ZOOM, 7.5, MAX_ZOOM * 1.6]) {
        for (const [shakeX, shakeY] of [[0, 0], [14, -9]]) {
          const cam = { ...createCamera(null), x: 12, y: 30, zoom, shakeX, shakeY };
          const three = createSideCamera();
          applySideCamera(three, cam);
          const halfW = (0.48 * VIEW_WIDTH) / zoom;
          const halfH = (0.48 * VIEW_HEIGHT) / zoom;
          const spots = [[cam.x, cam.y], [cam.x - halfW, cam.y + halfH], [cam.x + halfW, cam.y - halfH], [240, 200], [-200, -100]];
          const v = createVfx();
          for (const [x, y] of spots) {
            v.particles.push(point(x, y));
            // A spark at rest has no streak, so its middle is where it is.
            v.particles.push({ ...point(x, y), kind: "spark" });
          }
          const layer = createVfx3D();
          layer.update(v, []);
          expect(layer.counts().sprites).toBe(spots.length * 2);
          spots.forEach(([x, y], k) => {
            const want = worldToScreen(cam, x, y);
            for (const i of [2 * k, 2 * k + 1]) {
              const { position } = instance(layer, "sparks", i);
              const ndc = position.clone().project(three);
              expect(((ndc.x + 1) / 2) * VIEW_WIDTH).toBeCloseTo(want.x, 2);
              expect(((1 - ndc.y) / 2) * VIEW_HEIGHT).toBeCloseTo(want.y, 2);
            }
          });
          layer.dispose();
        }
      }
    });
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

    /** One spark, from (10, 20), as the layer draws it: how long, how thick, where its middle is, which way it points. */
    function drawnSpark(speed: number, size: number, heading = 0) {
      const v: VfxState = createVfx();
      v.particles.push({ kind: "spark", x: 10, y: 20, vx: speed * Math.cos(heading), vy: speed * Math.sin(heading), life: 6, maxLife: 6, size, colour: "#FFFFFF", rotation: 0, spin: 0, gravity: 0, drag: 1 });
      const layer = createVfx3D();
      layer.update(v, []);
      const { position, scale, rotation } = instance(layer, "sparks", 0);
      const axis = new Vector3(1, 0, 0).applyQuaternion(rotation);
      layer.dispose();
      return { length: scale.x, thickness: scale.y, middle: position, points: Math.atan2(axis.y, axis.x) };
    }

    it("draws a spark as a streak back along its velocity: 2.2 times its speed long, five at most, never shorter than the spark", () => {
      // (The 2D overlay's streak: `speed x 2.2`, capped at 30 px, which is 5 units at the zoom a match opens at.)
      const slow = drawnSpark(0.5, 0.4);
      expect(slow.length).toBeCloseTo(1.1, 5);
      expect(slow.middle.x).toBeCloseTo(10 - 0.55, 5);
      expect(slow.middle.y).toBeCloseTo(20, 5);
      const fast = drawnSpark(4, 0.4);
      expect(fast.length).toBeCloseTo(5, 5);
      expect(fast.middle.x).toBeCloseTo(10 - 2.5, 5);
      // A big spark that barely moves is as long as it is big.
      expect(drawnSpark(0.1, 1).length).toBeCloseTo(1, 5);
      expect(drawnSpark(0.1, 0.1).length).toBeCloseTo(0.22, 5);
      // And it trails behind whichever way it goes.
      const up = drawnSpark(1, 0.4, Math.PI / 2);
      expect(up.length).toBeCloseTo(2.2, 5);
      expect(up.middle.x).toBeCloseTo(10, 5);
      expect(up.middle.y).toBeCloseTo(20 - 1.1, 5);
      expect(up.points).toBeCloseTo(Math.PI / 2, 5);
    });

    it("draws a spark 0.7 of its size thick, never under 0.15", () => {
      expect(drawnSpark(1, 0.4).thickness).toBeCloseTo(0.28, 5);
      expect(drawnSpark(1, 1).thickness).toBeCloseTo(0.7, 5);
      expect(drawnSpark(1, 0.1).thickness).toBeCloseTo(0.15, 5);
    });

    it("draws a burst twice its size across, turned as the particle is turned, swelling to 1.7 times that as it dies", () => {
      const burst = (life: number) => {
        const v = createVfx();
        v.particles.push({ kind: "burst", x: 3, y: 4, vx: 0, vy: 0, life, maxLife: 8, size: 1.5, colour: "#FFFFFF", rotation: 0.7, spin: 0, gravity: 0, drag: 1 });
        const layer = createVfx3D();
        layer.update(v, []);
        const { position, scale, rotation } = instance(layer, "sparks", 0);
        const axis = new Vector3(1, 0, 0).applyQuaternion(rotation);
        layer.dispose();
        return { position, scale, points: Math.atan2(axis.y, axis.x) };
      };
      const born = burst(8);
      expect([born.scale.x, born.scale.y, born.scale.z]).toEqual([3, 3, 3].map((c) => expect.closeTo(c, 5)));
      expect(born.points).toBeCloseTo(0.7, 5);
      expect([born.position.x, born.position.y]).toEqual([3, 4]);
      for (const life of [6, 4, 2, 1]) {
        const grow = 1 + (1 - life / 8) * (BURST_MAX_GROWTH - 1);
        expect(burst(life).scale.x).toBeCloseTo(3 * grow, 5);
      }
      expect(BURST_MAX_GROWTH).toBeCloseTo(1.7, 9);
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

    // The spies below are put back after every test, a failing one included.
    afterEach(() => {
      vi.restoreAllMocks();
      expect(vi.isMockFunction(Color.prototype.set)).toBe(false);
      expect(vi.isMockFunction(Color.prototype.setStyle)).toBe(false);
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
      layer.dispose();
    });

    const meshes = (layer: Vfx3D) => ["sparks", "shields"].map((name) => layer.group.getObjectByName(name) as InstancedMesh);

    it("starts with nothing to draw, and can never be culled", () => {
      // Drawn before its first update it would be 640 unit quads at the origin; and three
      // measures an instanced mesh's bounding sphere once, from the instances live then, so
      // a layer that may be culled can be culled for good.
      const layer = createVfx3D();
      for (const mesh of meshes(layer)) {
        expect(mesh.count, mesh.name).toBe(0);
        expect(mesh.frustumCulled, mesh.name).toBe(false);
      }
      layer.dispose();
    });

    it("tells three to upload both buffers of both meshes on every update", () => {
      const layer = createVfx3D();
      const v = busy();
      const versions = () => meshes(layer).flatMap((m) => [m.instanceMatrix.version, m.instanceColor!.version]);
      for (let frame = 0; frame < 3; frame++) {
        const before = versions();
        layer.update(v, shields);
        const after = versions();
        expect(before).toHaveLength(4);
        after.forEach((version, i) => expect(version, `buffer ${i}, frame ${frame}`).toBeGreaterThan(before[i]));
      }
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
