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
import { toFloat } from "@/engine/fixed";
import type { FighterDef, Hitbox, MoveDef, MoveSlot } from "@/engine/types";
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
        `${fighter.name}'s ${projectile.id} is live on frame ${h.endFrame} of a ${projectile.lifetime}-frame life`
      ).toBeLessThanOrEqual(projectile.lifetime);
    }
  });

  it.each(each)("%s gives every projectile a positive radius and damage", (_name, fighter) => {
    for (const { slot, projectile } of everyProjectile(fighter)) {
      expect(projectile.hitbox.radius, `${fighter.name} ${slot}`).toBeGreaterThan(0);
      expect(projectile.hitbox.damage, `${fighter.name} ${slot}`).toBeGreaterThan(0);
    }
  });

  it.each(each)("%s makes every projectile transcendent", (_name, fighter) => {
    // A projectile that clanks would be deleted by any jab, which is not how
    // Ultimate works — projectiles pass through opposing hitboxes.
    for (const { slot, projectile } of everyProjectile(fighter)) {
      expect(
        projectile.hitbox.transcendent,
        `${fighter.name}'s ${slot} projectile ${projectile.id} is not transcendent`
      ).toBe(true);
    }
  });

  it.each(each)("%s gives every projectile a unique id within its fighter", (_name, fighter) => {
    const ids = everyProjectile(fighter).map((p) => p.projectile.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("puts a projectile on exactly the specials the spec says have one", () => {
    // SPEC section 7: Link has three at once, Samus charges one.
    const owners = FIGHTERS.filter((f) => everyProjectile(f).length > 0).map((f) => f.id);
    expect(new Set(owners)).toEqual(new Set(["mario", "link", "samus", "fox", "pikachu"]));

    const linkProjectiles = everyProjectile(getFighterOrThrow("link"));
    expect(linkProjectiles).toHaveLength(3);
    expect(new Set(linkProjectiles.map((p) => p.slot))).toEqual(
      new Set(["neutralB", "sideB", "downB"])
    );
  });

  it("gives Link's boomerang the return that defines it", () => {
    const boomerang = everyProjectile(getFighterOrThrow("link")).find(
      (p) => p.projectile.id === "boomerang"
    )!.projectile;
    expect(boomerang.returns).toBe(true);
    // It has to survive the hit, or it could never come back.
    expect(boomerang.destroyOnHit).toBe(false);
  });

  it("gives Samus and Link the charge scaling their specials are built around", () => {
    const chargeShot = everyProjectile(getFighterOrThrow("samus")).find(
      (p) => p.projectile.id === "chargeShot"
    )!.projectile;
    // 5% uncharged to 28% at full charge.
    expect(toFloat(chargeShot.chargeScaling!)).toBeCloseTo(5.6, 2);
    expect(toFloat(chargeShot.hitbox.damage) * toFloat(chargeShot.chargeScaling!)).toBeCloseTo(
      28,
      1
    );

    const arrow = everyProjectile(getFighterOrThrow("link")).find(
      (p) => p.projectile.id === "arrow"
    )!.projectile;
    // 4% uncharged to 12% at full charge.
    expect(toFloat(arrow.hitbox.damage) * toFloat(arrow.chargeScaling!)).toBeCloseTo(12, 1);
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
  it.each(each)("%s gives every hitbox a non-negative damage", (_name, fighter) => {
    for (const { slot, hitbox } of everyHitbox(fighter)) {
      expect(hitbox.damage, `${fighter.name} ${slot} hitbox ${hitbox.id}`).toBeGreaterThanOrEqual(0);
    }
  });

  it.each(each)("%s gives every damaging hitbox a plausible damage", (_name, fighter) => {
    for (const { slot, hitbox } of everyHitbox(fighter)) {
      if (hitbox.grabbing) continue;
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

  it.each(each)("%s gives each move's hitboxes distinct ids", (_name, fighter) => {
    for (const { slot, move } of moves(fighter)) {
      const ids = move.hitboxes.map((h) => h.id);
      expect(
        new Set(ids).size,
        `${fighter.name}'s ${slot} reuses a hitbox id: ${ids.join(", ")}`
      ).toBe(ids.length);
    }
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
    // a long sword. Projectiles are the deliberate exception.
    const projectileSlots: MoveSlot[] = ["neutralB", "sideB", "downB", "upB"];
    for (const { slot, hitbox } of everyHitbox(fighter)) {
      if (projectileSlots.includes(slot)) continue;
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
