/**
 * Structural tests over the roster data.
 *
 * These do not check that any number is *right* — no test can, short of owning
 * the game. They check that the data is internally coherent: that a hitbox
 * cannot be live after its move has ended, that an aerial declares its landing
 * lag, that nothing is negative that has no business being negative. Those are
 * the failures that would otherwise surface as a fighter silently doing nothing
 * on frame 40 of a 37-frame move.
 */

import { describe, expect, it } from "vitest";
import { fx, toFloat } from "@/engine/fixed";
import { advanceProjectile, spawnProjectile } from "@/engine/projectile";
import type { FighterDef, FighterState, Hitbox, MoveDef, MoveSlot, StageDef } from "@/engine/types";
import { flatten } from "@/engine/acmd/interpreter";
import { ACTIVE_SCRIPT_SLOTS } from "./acmd/active";
import { REFERENCE_SCRIPTS } from "./acmd/index";
import { AERIAL_SLOTS, FIGHTERS, REQUIRED_SLOTS, getFighter } from "./index";

/** Look a fighter up, failing loudly rather than returning undefined. */
function getFighterOrThrow(id: string): FighterDef {
  const fighter = getFighter(id);
  if (!fighter) throw new Error(`no fighter "${id}"`);
  return fighter;
}

const each = FIGHTERS.map((f) => [f.name, f] as const);

/** Every projectile any fighter launches, with the move that launched it. */
function everyProjectile(fighter: FighterDef) {
  return moves(fighter).flatMap(({ slot, move }) =>
    (move.projectiles ?? []).map((projectile) => ({ slot, move, projectile }))
  );
}

/** Every move a fighter defines, with its slot, for the sweeping checks. */
function moves(fighter: FighterDef): { slot: MoveSlot; move: MoveDef }[] {
  return Object.entries(fighter.moves).map(([slot, move]) => ({
    slot: slot as MoveSlot,
    move: move as MoveDef,
  }));
}

function everyHitbox(fighter: FighterDef): { slot: MoveSlot; move: MoveDef; hitbox: Hitbox }[] {
  return moves(fighter).flatMap(({ slot, move }) =>
    move.hitboxes.map((hitbox) => ({ slot, move, hitbox }))
  );
}

describe("required move slots", () => {
  it.each(each)("%s fills every required slot", (_name, fighter) => {
    for (const slot of REQUIRED_SLOTS) {
      expect(fighter.moves[slot], `${fighter.name} is missing ${slot}`).toBeDefined();
    }
  });

  it.each(each)("%s gives every move the slot it is filed under", (_name, fighter) => {
    for (const { slot, move } of moves(fighter)) {
      expect(move.slot, `${fighter.name}'s ${slot} declares slot "${move.slot}"`).toBe(slot);
    }
  });

  it.each(each)("%s names every move", (_name, fighter) => {
    for (const { move } of moves(fighter)) {
      expect(move.name.length).toBeGreaterThan(0);
    }
  });

  it.each(each)("%s points every followUp at a move it actually has", (_name, fighter) => {
    for (const { slot, move } of moves(fighter)) {
      if (!move.followUp) continue;
      expect(
        fighter.moves[move.followUp],
        `${fighter.name}'s ${slot} follows up into ${move.followUp}, which it does not have`
      ).toBeDefined();
    }
  });
});

describe("frame counts", () => {
  it.each(each)("%s gives every move a positive FAF", (_name, fighter) => {
    for (const { slot, move } of moves(fighter)) {
      expect(move.totalFrames, `${fighter.name} ${slot}`).toBeGreaterThan(0);
      expect(Number.isInteger(move.totalFrames)).toBe(true);
    }
  });

  it.each(each)("%s never starts a hitbox before frame 1", (_name, fighter) => {
    for (const { slot, hitbox } of everyHitbox(fighter)) {
      expect(hitbox.startFrame, `${fighter.name} ${slot} hitbox ${hitbox.id}`).toBeGreaterThan(0);
    }
  });

  it.each(each)("%s ends every hitbox at or after it starts", (_name, fighter) => {
    for (const { slot, hitbox } of everyHitbox(fighter)) {
      expect(
        hitbox.endFrame,
        `${fighter.name} ${slot} hitbox ${hitbox.id} ends on ${hitbox.endFrame} but starts on ${hitbox.startFrame}`
      ).toBeGreaterThanOrEqual(hitbox.startFrame);
    }
  });

  it.each(each)("%s keeps every hitbox inside its move's total frames", (_name, fighter) => {
    // A hitbox live past FAF is unreachable: the fighter is already actionable,
    // so the swing it belongs to is over. This now holds without exception,
    // because a projectile's flight lives in `projectiles` rather than being
    // smuggled into the move as a hitbox that outlasts the animation.
    for (const { slot, move, hitbox } of everyHitbox(fighter)) {
      expect(
        hitbox.endFrame,
        `${fighter.name} ${slot} hitbox ${hitbox.id} is live on frame ${hitbox.endFrame} of a ${move.totalFrames}-frame move`
      ).toBeLessThanOrEqual(move.totalFrames);
    }
  });

  it.each(each)("%s uses whole frames everywhere", (_name, fighter) => {
    for (const { slot, hitbox } of everyHitbox(fighter)) {
      expect(Number.isInteger(hitbox.startFrame), `${fighter.name} ${slot}`).toBe(true);
      expect(Number.isInteger(hitbox.endFrame), `${fighter.name} ${slot}`).toBe(true);
    }
  });

  it.each(each)("%s declares no negative frame counts anywhere", (_name, fighter) => {
    for (const { slot, move } of moves(fighter)) {
      expect(move.totalFrames, `${fighter.name} ${slot}`).toBeGreaterThanOrEqual(0);
      if (move.landingLag !== undefined) {
        expect(move.landingLag, `${fighter.name} ${slot} landingLag`).toBeGreaterThanOrEqual(0);
      }
      if (move.autoCancelBefore !== undefined) {
        expect(move.autoCancelBefore, `${fighter.name} ${slot}`).toBeGreaterThanOrEqual(0);
      }
      if (move.autoCancelAfter !== undefined) {
        expect(move.autoCancelAfter, `${fighter.name} ${slot}`).toBeGreaterThanOrEqual(0);
      }
      if (move.superArmourFrames) {
        const [from, to] = move.superArmourFrames;
        expect(from).toBeGreaterThanOrEqual(0);
        expect(to).toBeGreaterThanOrEqual(from);
      }
      for (const h of move.hitboxes) {
        expect(h.startFrame, `${fighter.name} ${slot}`).toBeGreaterThanOrEqual(0);
        expect(h.endFrame, `${fighter.name} ${slot}`).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("aerials", () => {
  it.each(each)("%s declares landing lag on all five aerials", (_name, fighter) => {
    for (const slot of AERIAL_SLOTS) {
      const move = fighter.moves[slot];
      expect(move, `${fighter.name} has no ${slot}`).toBeDefined();
      expect(
        move!.landingLag,
        `${fighter.name}'s ${slot} declares no landingLag`
      ).toBeDefined();
      expect(move!.landingLag).toBeGreaterThan(0);
    }
  });

  it.each(each)("%s declares landing lag only where it means something", (_name, fighter) => {
    // Grounded normals cannot land out of an attack, so landing lag on a jab
    // would be a copy-paste rather than a fact.
    const groundedNormals: MoveSlot[] = [
      "jab1",
      "ftilt",
      "utilt",
      "dtilt",
      "dashAttack",
      "fsmash",
      "usmash",
      "dsmash",
    ];
    for (const slot of groundedNormals) {
      const move = fighter.moves[slot];
      if (!move) continue;
      expect(move.landingLag, `${fighter.name}'s ${slot} declares landingLag`).toBeUndefined();
    }
    // Nor anything but an aerial: the engine reads `landingLag` for aerials alone, and a
    // special's own landing lag is `aerialLandingLag` (Plan 5, Task 13d fix round 1: Fox
    // Illusion's 16 sat in `landingLag`, never read).
    for (const { slot, move } of moves(fighter)) {
      if (move.landingLag !== undefined) expect(AERIAL_SLOTS, `${fighter.name}'s ${slot} declares landingLag`).toContain(slot);
    }
  });

  it.each(each)("%s orders every autocancel window sensibly", (_name, fighter) => {
    for (const { slot, move } of moves(fighter)) {
      if (move.autoCancelBefore === undefined || move.autoCancelAfter === undefined) continue;
      expect(
        move.autoCancelAfter,
        `${fighter.name}'s ${slot} autocancels after ${move.autoCancelAfter} but before ${move.autoCancelBefore}`
      ).toBeGreaterThan(move.autoCancelBefore);
      // An autocancel window opening after the move is already over is a window
      // the fighter can never reach, so it is always a transcription error
      // rather than a quirk.
      expect(
        move.autoCancelAfter,
        `${fighter.name}'s ${slot} autocancels from frame ${move.autoCancelAfter} but is actionable on ${move.totalFrames}`
      ).toBeLessThanOrEqual(move.totalFrames);
    }
  });
});

describe("projectiles", () => {
  it.each(each)("%s spawns every projectile during the move that throws it", (_name, fighter) => {
    for (const { slot, move, projectile } of everyProjectile(fighter)) {
      expect(projectile.spawnFrame, `${fighter.name} ${slot} ${projectile.id}`).toBeGreaterThan(0);
      expect(
        projectile.spawnFrame,
        `${fighter.name}'s ${slot} spawns ${projectile.id} on frame ${projectile.spawnFrame}, after its ${move.totalFrames}-frame animation has ended`
      ).toBeLessThanOrEqual(move.totalFrames);
    }
  });

  it.each(each)("%s gives every projectile a life and a way to move", (_name, fighter) => {
    for (const { slot, projectile } of everyProjectile(fighter)) {
      expect(projectile.lifetime, `${fighter.name} ${slot} ${projectile.id}`).toBeGreaterThan(0);
      expect(projectile.gravity, `${fighter.name} ${slot} ${projectile.id}`).toBeGreaterThanOrEqual(0);
      // Something that neither moves nor falls is not a projectile.
      const moving = projectile.vx !== 0 || projectile.vy !== 0 || projectile.gravity !== 0;
      expect(moving, `${fighter.name}'s ${projectile.id} never goes anywhere`).toBe(true);
    }
  });

  it.each(each)("%s keeps every projectile's hitbox inside its lifetime", (_name, fighter) => {
    for (const { slot, projectile } of everyProjectile(fighter)) {
      const h = projectile.hitbox;
      // These frames are relative to the spawn, so they start at zero.
      expect(h.startFrame, `${fighter.name} ${slot} ${projectile.id}`).toBeGreaterThanOrEqual(0);
      expect(h.endFrame).toBeGreaterThanOrEqual(h.startFrame);
      expect(
        h.endFrame,
        `${fighter.name}'s ${projectile.id} is live at age ${h.endFrame} of a ${projectile.lifetime}-frame life (ages 0 to ${projectile.lifetime - 1})`
      ).toBeLessThan(projectile.lifetime);
    }
  });

  /**
   * Each projectile's published life, counting the frame it appears on (Plan 5,
   * Task 6 fix round 1): a pump that leaves on frame 21 and lives 12 frames is
   * live on 21-32, not 21-33. The life, then the hitbox's window in frames of
   * age (0 = the spawn frame), from each move's SmashWiki page.
   */
  const PUBLISHED_LIFE: readonly [fighter: string, id: string, life: number, window: readonly [number, number], source: string][] = [
    // "Lifetime 70 frames"; "Clean hit 17-21", "Late hit 22-46", "Latest hit 47-86".
    ["mario", "fireball", 70, [0, 69], "https://www.ssbwiki.com/Mario_(SSBU)/Neutral_special"],
    // "Lifetime 12 frames"; "Pumps 21-32, 26-37, …".
    ["mario", "water", 12, [0, 11], "https://www.ssbwiki.com/Mario_(SSBU)/Down_special"],
    // "Lifetime 60 frames"; "Hitbox 16-75".
    ["samus", "chargeShot", 60, [0, 59], "https://www.ssbwiki.com/Samus_(SSBU)/Neutral_special"],
    // Homing Missile "Lifetime 120 frames"; "Missile 18-137".
    ["samus", "missile", 120, [0, 119], "https://www.ssbwiki.com/Samus_(SSBU)/Side_special"],
    // The Super Missile (Plan 5, Task 13d): "Super Missile 21-96"; "Period before
    // accelerating 26 frames", "Lifetime upon accelerating 50 frames".
    ["samus", "superMissile", 76, [0, 75], "https://www.ssbwiki.com/Samus_(SSBU)/Side_special"],
    // "Bomb generation 11", "Maximum duration before exploding 72 frames",
    // "Explosion (early, mid, late) 83-94, 95-97, 98-100": frames 11-100, exploding from 83.
    ["samus", "bomb", 90, [72, 89], "https://www.ssbwiki.com/Samus_(SSBU)/Down_special"],
    // "Lifetime 22 frames"; "Clean hit 11-12", "Mid hit 13-19", "Late hit 20-32".
    ["fox", "blaster", 22, [0, 21], "https://www.ssbwiki.com/Fox_(SSBU)/Neutral_special"],
    // "Lifetime 46 frames (2.0.0 onward)"; "Arrow (from release) 16-61 (1-46)".
    ["link", "arrow", 46, [0, 45], "https://www.ssbwiki.com/Link_(SSBU)/Neutral_special"],
    // A tilt throw: "Lifetime 125 frames (tilt)"; "Tilt input hitboxes (clean, late, returning) 27-36, 37-71, 72-151".
    ["link", "boomerang", 125, [0, 124], "https://www.ssbwiki.com/Link_(SSBU)/Side_special"],
    // A smash throw (Plan 5, Task 13d): "Lifetime ... 167 frames (smash)". Its "Smash
    // input hitboxes (clean, late, returning) 27-36, 37-86, 87-192" span 166 frames;
    // the lifetime is followed, as the tilt throw's 125 is (27-151).
    ["link", "boomerangSmash", 167, [0, 166], "https://www.ssbwiki.com/Link_(SSBU)/Side_special"],
    // "Maximum time before exploding 1800 frames (30 seconds)".
    ["link", "remoteBomb", 1800, [0, 1799], "https://www.ssbwiki.com/Link_(SSBU)/Down_special"],
    // The grounded jolt: "Lifetime 96 frames"; "Clean hit 19-52", "Mid hit 53-85", "Late hit 86-114".
    ["pikachu", "thunderJolt", 96, [0, 95], "https://www.ssbwiki.com/Pikachu_(SSBU)/Neutral_special"],
    // Kirby's spit star (Plan 5, Task 9), live as long as it flies: "a maximum of 60"
    // frames, and "The star's speed decreases by 0.05 per frame, and it releases the
    // target when its speed drops below 0.4", so at its base speed 2.8 it is gone
    // after (2.8 − 0.4) / 0.05 = 48. Its rider's own flight (`25 + 0.5t`) ends it
    // sooner still (`engine/inhale.ts`).
    ["kirby", "star", 48, [0, 59], "https://www.ssbwiki.com/Kirby_(SSBU)/Neutral_special"],
    // Mario Finale's flames (Plan 5, Task 16): "Fireballs generated 5", "Early hits
    // 65-104", "Late hits 155-224": live on frames 5-224, hitting from 65, ages 60-219.
    // Their article's script clears its boxes on 220 (rubendal `mario_hugeflame` `Regular`).
    ["mario", "hugeFlame", 220, [60, 219], "https://www.ssbwiki.com/Mario_(SSBU)/Final_Smash"],
    // The Ancient Arrow (Task 16): UNVERIFIED, no published lifetime; it is gone on its
    // first hit or at the blast zone long before (`link.ts`).
    ["link", "ancientArrow", 60, [0, 59], "UNVERIFIED: https://www.ssbwiki.com/Link_(SSBU)/Final_Smash publishes none"],
  ];

  it("lists every projectile on the roster in the published lives", () => {
    const listed = new Set(PUBLISHED_LIFE.map(([f, id]) => `${f} ${id}`));
    const launched = new Set(FIGHTERS.flatMap((f) => everyProjectile(f).map(({ projectile }) => `${f.id} ${projectile.id}`)));
    expect(listed).toEqual(launched);
  });

  it.each(PUBLISHED_LIFE)("%s's %s lives its published %i frames, its spawn frame included", (fighter, id, life, window, source) => {
    const def = everyProjectile(getFighterOrThrow(fighter)).find((p) => p.projectile.id === id)!.projectile;
    expect([def.hitbox.startFrame, def.hitbox.endFrame], source).toEqual(window);
    // Out in the open: no surface to bounce off or die against, no blast zone to reach.
    const open = { platforms: [], blastZone: { left: -fx(1e7), right: fx(1e7), top: fx(1e7), bottom: -fx(1e7) } } as unknown as StageDef;
    const owner = { port: 0, defId: fighter, x: 0, y: 0, facing: 1, charge: 0 } as unknown as FighterState;
    const p = spawnProjectile(def, owner, 1);
    // Live on the frame it spawns (age 0), then one frame per step it survives.
    let frames = 1;
    while (advanceProjectile(p, def, open, null, frames).alive) frames += 1;
    expect(frames, source).toBe(life);
  });

  it.each(each)("%s gives every projectile a positive radius and damage", (_name, fighter) => {
    for (const { slot, projectile } of everyProjectile(fighter)) {
      expect(projectile.hitbox.radius, `${fighter.name} ${slot}`).toBeGreaterThan(0);
      // A windbox (Plan 5: F.L.U.D.D.'s water) pushes and deals nothing.
      if (projectile.hitbox.windbox === true) expect(projectile.hitbox.damage).toBe(0);
      else expect(projectile.hitbox.damage, `${fighter.name} ${slot}`).toBeGreaterThan(0);
    }
  });

  // Each projectile clanks as its article's script says (Plan 5, Task 13c): the
  // table and its sources are `projectiles.test.ts`'s. A projectile is never both.
  it.each(each)("%s gives no projectile both no-clank and no-rebound", (_name, fighter) => {
    for (const { slot, projectile } of everyProjectile(fighter)) {
      expect(projectile.hitbox.transcendent === true && projectile.hitbox.noRebound === true, `${fighter.name}'s ${slot} ${projectile.id}`).toBe(false);
    }
  });

  it.each(each)("%s gives every projectile a unique id within its fighter", (_name, fighter) => {
    // One definition may be fired on several frames (Plan 5: F.L.U.D.D.'s seven
    // pumps): an id repeats only for the same projectile at another frame.
    const byId = new Map<string, string>();
    for (const { projectile } of everyProjectile(fighter)) {
      const shape = JSON.stringify({ ...projectile, spawnFrame: 0 });
      expect(byId.get(projectile.id) ?? shape, `${fighter.name} ${projectile.id}`).toBe(shape);
      byId.set(projectile.id, shape);
    }
  });

  it("puts a projectile on exactly the specials the spec says have one", () => {
    // SPEC section 7: Link has three at once, Samus charges one.
    const owners = FIGHTERS.filter((f) => everyProjectile(f).length > 0).map((f) => f.id);
    // Plan 5, Task 9: Kirby's spit fires the spat fighter as a star.
    expect(new Set(owners)).toEqual(new Set(["mario", "link", "samus", "kirby", "fox", "pikachu"]));

    // Plan 5, Task 13d: his Boomerang has a smash throw of its own, a fourth definition.
    // Plan 5, Task 16: a Final Smash's arrows and flames are not specials.
    const linkProjectiles = everyProjectile(getFighterOrThrow("link")).filter((p) => p.slot !== "finalSmash");
    expect(linkProjectiles).toHaveLength(4);
    expect(new Set(linkProjectiles.map((p) => p.slot))).toEqual(
      new Set(["neutralB", "sideB", "sideBSmash", "downB"])
    );
  });

  it("gives Link's boomerang the return that defines it", () => {
    const boomerang = everyProjectile(getFighterOrThrow("link")).find(
      (p) => p.projectile.id === "boomerang"
    )!.projectile;
    // Its way back, from its page (Plan 5, Task 13c; `projectiles.test.ts` pins the numbers).
    expect(boomerang.returns).toBeDefined();
    // It has to survive the hit, or it could never come back.
    expect(boomerang.destroyOnHit).toBe(false);
  });

  it("gives Samus and Link the charge scaling their specials are built around", () => {
    const chargeShot = everyProjectile(getFighterOrThrow("samus")).find(
      (p) => p.projectile.id === "chargeShot"
    )!.projectile;
    // 5% uncharged to 28% at full charge (Plan 5: interpolated, `charged`).
    expect(toFloat(chargeShot.hitbox.damage)).toBeCloseTo(5, 2);
    expect(toFloat(chargeShot.charged!.hitbox.damage!)).toBeCloseTo(28, 2);

    const arrow = everyProjectile(getFighterOrThrow("link")).find(
      (p) => p.projectile.id === "arrow"
    )!.projectile;
    // 4% uncharged to 12% at full charge.
    expect(toFloat(arrow.hitbox.damage)).toBeCloseTo(4, 2);
    expect(toFloat(arrow.charged!.hitbox.damage!)).toBeCloseTo(12, 2);
  });

  it("gives Fox's Blaster no knockback, no hitlag and no flinch whatsoever", () => {
    const blaster = everyProjectile(getFighterOrThrow("fox")).find(
      (p) => p.projectile.id === "blaster"
    )!.projectile;
    expect(blaster.hitbox.baseKnockback).toBe(0);
    expect(blaster.hitbox.knockbackGrowth).toBe(0);
    expect(blaster.hitbox.hitlagMultiplier).toBe(0);
    expect(blaster.hitbox.transcendent).toBe(true);
    // ...and it passes through rather than stopping on the first target.
    expect(blaster.destroyOnHit).toBe(false);
  });

  it("makes the ground-hugging projectiles actually fall", () => {
    // Mario's fireball and Pikachu's Thunder Jolt are defined by bouncing along
    // the floor. Zero gravity would make both of them lasers.
    for (const [id, owner] of [
      ["fireball", "mario"],
      ["thunderJolt", "pikachu"],
    ] as const) {
      const p = everyProjectile(getFighterOrThrow(owner)).find(
        (x) => x.projectile.id === id
      )!.projectile;
      expect(p.gravity, `${id} does not fall`).toBeGreaterThan(0);
      expect(p.bounces, `${id} does not bounce`).toBeGreaterThan(0);
    }
  });
});

describe("hitbox values", () => {
  it.each(each)("%s deals nothing with any windbox, on a move or a projectile", (_name, fighter) => {
    // Plan 5, Task 6: the engine's push (`applyWindbox`) deals no damage, which
    // is right only for a 0% windbox (F.L.U.D.D.'s, SmashWiki "Mario
    // (SSBU)/Down special"). A damaging one would lose its damage silently.
    const boxes = [...everyHitbox(fighter).map((h) => h.hitbox), ...everyProjectile(fighter).map((p) => p.projectile.hitbox)];
    for (const hb of boxes.filter((b) => b.windbox === true)) expect(hb.damage, `${fighter.name} hitbox ${hb.id}`).toBe(0);
  });

  it.each(each)("%s holds every windbox on a move to one frame, and imports none (Plan 5, Task 9 fix round 2)", (_name, fighter) => {
    // A fighter's own windbox leaves no mark on its swing's hit record
    // (`simulate.ts` `unrecorded`), which is right only for a box one frame long:
    // Kirby's Inhale pull times its `Rehit=10` with one-frame boxes. A longer one
    // would push on every frame it is out; it must fail here until its record is
    // decided.
    for (const { slot, hitbox } of everyHitbox(fighter).filter((h) => h.hitbox.windbox === true)) {
      expect(hitbox.endFrame, `${fighter.name} ${slot} windbox ${hitbox.id}`).toBe(hitbox.startFrame);
    }
    // And no imported script has a flinchless ATTACK (a windbox) of any length.
    const ref = REFERENCE_SCRIPTS[fighter.id];
    for (const [name, script] of Object.entries(ref?.scripts ?? {})) {
      for (const c of flatten(script)) if (c.op === "attack") expect(c.params.flinchless, `${fighter.name} ${name} ATTACK ${c.params.id}`).toBe(false);
    }
  });

  it.each(each)("%s gives every hitbox a non-negative damage", (_name, fighter) => {
    for (const { slot, hitbox } of everyHitbox(fighter)) {
      expect(hitbox.damage, `${fighter.name} ${slot} hitbox ${hitbox.id}`).toBeGreaterThanOrEqual(0);
    }
  });

  it.each(each)("%s gives every damaging hitbox a plausible damage", (_name, fighter) => {
    for (const { slot, hitbox } of everyHitbox(fighter)) {
      if (hitbox.grabbing) continue;
      // A Final Smash's finishing blow is in a class of its own (Plan 5:
      // Critical Hit is 60%).
      if (slot === "finalSmash" || slot === "finalAttack" || slot === "finalEnd") continue;
      // Kirby's fully charged Hammer Flip is the largest single hit in the game
      // at 35%; nothing here should exceed it.
      expect(
        toFloat(hitbox.damage),
        `${fighter.name} ${slot} hitbox ${hitbox.id} deals ${toFloat(hitbox.damage)}%`
      ).toBeLessThanOrEqual(35);
    }
  });

  it.each(each)("%s gives every hitbox a positive radius", (_name, fighter) => {
    for (const { slot, hitbox } of everyHitbox(fighter)) {
      expect(hitbox.radius, `${fighter.name} ${slot} hitbox ${hitbox.id}`).toBeGreaterThan(0);
    }
  });

  it.each(each)("%s gives every hitbox non-negative knockback", (_name, fighter) => {
    for (const { slot, hitbox } of everyHitbox(fighter)) {
      expect(hitbox.baseKnockback, `${fighter.name} ${slot}`).toBeGreaterThanOrEqual(0);
      expect(hitbox.knockbackGrowth, `${fighter.name} ${slot}`).toBeGreaterThanOrEqual(0);
      // A fixed knockback is a script's non-zero `fkb`; one of 0 would say set
      // knockback while meaning none (Plan 3, Task 16b).
      if (hitbox.fixedKnockback !== undefined) {
        expect(hitbox.fixedKnockback, `${fighter.name} ${slot} hitbox ${hitbox.id}`).toBeGreaterThan(0);
      }
    }
  });

  it.each(each)("%s keeps every angle in range", (_name, fighter) => {
    for (const { slot, hitbox } of everyHitbox(fighter)) {
      const angle = toFloat(hitbox.angle);
      // 0-360 are real angles; 361 is the Sakurai angle and 365/366/367 are
      // autolink angles. Anything above 368 is a typo.
      expect(angle, `${fighter.name} ${slot} hitbox ${hitbox.id} angle`).toBeGreaterThanOrEqual(0);
      expect(angle, `${fighter.name} ${slot} hitbox ${hitbox.id} angle`).toBeLessThanOrEqual(368);
    }
  });

  // Distinct among the boxes live on any one frame, which is what lowest-id
  // priority reads. A move run from its imported script (Plan 3, Task 18) reuses
  // a slot from one window to the next — Mario's down-air drill is slot 0 five
  // times — and its table keeps the script's ids (`scriptHitboxTable`).
  it.each(each)("%s gives the hitboxes live on any one frame of a move distinct ids", (_name, fighter) => {
    for (const { slot, move } of moves(fighter)) {
      for (let frame = 1; frame <= move.totalFrames + 1; frame++) {
        const ids = move.hitboxes
          .filter((h) => frame >= h.startFrame && frame <= h.endFrame)
          .map((h) => `${h.grabbing ? "grab " : ""}${h.id}`);
        expect(
          new Set(ids).size,
          `${fighter.name}'s ${slot} reuses a hitbox id on frame ${frame}: ${ids.join(", ")}`
        ).toBe(ids.length);
      }
    }
  });

  // The check this replaced was every box of a move distinct, which caught a mistyped
  // id (two boxes both 0 on different frames pass the per-frame rule above). It still
  // holds for every move the sim runs from its compiled table: only a script-run slot
  // reuses ids across windows (`ACTIVE_SCRIPT_SLOTS`), so those alone are exempt (Plan 3,
  // Task 18 review, minor 6).
  it.each(each)("%s gives each move it runs from its compiled table ids distinct across the whole move", (_name, fighter) => {
    const scripted = new Set<MoveSlot>(ACTIVE_SCRIPT_SLOTS[fighter.id]);
    let checked = 0;
    for (const { slot, move } of moves(fighter)) {
      if (scripted.has(slot)) continue;
      checked += 1;
      const ids = move.hitboxes.map((h) => `${h.grabbing ? "grab " : ""}${h.id}`);
      expect(new Set(ids).size, `${fighter.name}'s ${slot} reuses a hitbox id: ${ids.join(", ")}`).toBe(ids.length);
    }
    expect(checked, "some moves are still compiled-only").toBeGreaterThan(0);
  });

  it.each(each)("%s only meteors on a downward angle", (_name, fighter) => {
    for (const { slot, hitbox } of everyHitbox(fighter)) {
      if (!hitbox.meteor) continue;
      const angle = toFloat(hitbox.angle);
      expect(
        angle,
        `${fighter.name}'s ${slot} is flagged meteor at ${angle} degrees, which is not downward`
      ).toBeGreaterThan(230);
      expect(angle).toBeLessThan(310);
    }
  });

  it.each(each)("%s keeps hitboxes near the body that owns them", (_name, fighter) => {
    // A hitbox thirty units from a twelve-unit fighter is a units mistake, not
    // a long sword. Projectiles are the deliberate exception, and so is a slot
    // run from its imported script (`ACTIVE_SCRIPT_SLOTS`): its table is the
    // published script's boxes, not hand-typed numbers (Samus's up throw burns
    // its victim 23 above her feet: `game_throwhi`, Plan 5 Task 7).
    const projectileSlots: MoveSlot[] = ["neutralB", "sideB", "downB", "upB"];
    const scripted = new Set<MoveSlot>(ACTIVE_SCRIPT_SLOTS[fighter.id]);
    // Zero Laser's upper fringe beam and its blast (`samus_laser2` `Upper`, 14 above the
    // beam's 9: 23 up), an article's boxes the script places (Plan 5, Task 16 fix round 1,
    // ruling R-T16e).
    const placedByScript = new Set(["samus finalSmash 11", "samus finalSmash 13"]);
    for (const { slot, hitbox } of everyHitbox(fighter)) {
      if (projectileSlots.includes(slot) || scripted.has(slot) || placedByScript.has(`${fighter.id} ${slot} ${hitbox.id}`)) continue;
      const reach = Math.abs(toFloat(hitbox.x));
      expect(
        reach,
        `${fighter.name}'s ${slot} hitbox ${hitbox.id} sits ${reach} units out`
      ).toBeLessThanOrEqual(20);
      const rise = toFloat(hitbox.y);
      expect(rise).toBeGreaterThan(-10);
      expect(rise).toBeLessThan(toFloat(fighter.attributes.height) + 10);
    }
  });

  it.each(each)("%s only marks a grab hitbox on a grabbing move", (_name, fighter) => {
    const grabSlots: MoveSlot[] = ["grab", "dashGrab", "neutralB"];
    for (const { slot, hitbox } of everyHitbox(fighter)) {
      if (!hitbox.grabbing) continue;
      expect(grabSlots, `${fighter.name}'s ${slot} has a grabbing hitbox`).toContain(slot);
    }
  });
});

describe("attributes", () => {
  it.each(each)("%s jumpsquats for three frames, as everyone does", (_name, fighter) => {
    expect(fighter.attributes.jumpSquatFrames).toBe(3);
  });

  it.each(each)("%s has a positive hurtbox", (_name, fighter) => {
    expect(fighter.attributes.width).toBeGreaterThan(0);
    expect(fighter.attributes.height).toBeGreaterThan(0);
  });

  it.each(each)("%s has at least two jumps", (_name, fighter) => {
    expect(fighter.attributes.jumps).toBeGreaterThanOrEqual(2);
    expect(Number.isInteger(fighter.attributes.jumps)).toBe(true);
  });

  it.each(each)("%s fast-falls faster than it falls", (_name, fighter) => {
    expect(fighter.attributes.fastFallSpeed).toBeGreaterThan(fighter.attributes.fallSpeed);
  });

  it.each(each)("%s full-hops higher than it short-hops", (_name, fighter) => {
    expect(fighter.attributes.fullHopVelocity).toBeGreaterThan(fighter.attributes.shortHopVelocity);
  });

  it.each(each)("%s runs at least as fast as it walks", (_name, fighter) => {
    expect(fighter.attributes.runSpeed).toBeGreaterThan(fighter.attributes.walkSpeed);
  });

  it.each(each)("%s has every movement attribute positive", (_name, fighter) => {
    const a = fighter.attributes;
    for (const [key, value] of Object.entries(a)) {
      if (typeof value !== "number") continue;
      expect(value, `${fighter.name}.${key} is ${value}`).toBeGreaterThan(0);
    }
  });
});

describe("palettes", () => {
  const HEX = /^#[0-9A-Fa-f]{6}$/;

  it.each(each)("%s carries at least four alternate costumes", (_name, fighter) => {
    expect(
      fighter.palette.alts.length,
      `${fighter.name} has ${fighter.palette.alts.length} alts`
    ).toBeGreaterThanOrEqual(4);
  });

  it.each(each)("%s uses six-digit hex everywhere", (_name, fighter) => {
    const p = fighter.palette;
    for (const [key, value] of Object.entries(p)) {
      if (typeof value !== "string") continue;
      expect(value, `${fighter.name}.palette.${key} is "${value}"`).toMatch(HEX);
    }
    for (const [i, alt] of p.alts.entries()) {
      expect(alt.primary, `${fighter.name} alt ${i}`).toMatch(HEX);
      expect(alt.secondary, `${fighter.name} alt ${i}`).toMatch(HEX);
      expect(alt.accent, `${fighter.name} alt ${i}`).toMatch(HEX);
    }
  });

  it.each(each)("%s makes each alt distinct from the default and each other", (_name, fighter) => {
    const keys = [fighter.palette.primary + fighter.palette.secondary];
    for (const alt of fighter.palette.alts) {
      const key = alt.primary + alt.secondary;
      expect(keys, `${fighter.name} repeats a costume`).not.toContain(key);
      keys.push(key);
    }
  });

  it.each(each)("%s writes a blurb", (_name, fighter) => {
    expect(fighter.blurb.length).toBeGreaterThan(10);
    // One line for the character select screen, not a paragraph.
    expect(fighter.blurb.length).toBeLessThan(140);
    expect(fighter.blurb).not.toContain("\n");
  });
});
