/**
 * Registry tests, and the handful of assertions that pin the character-defining
 * mechanics in place.
 *
 * The second half of this file is deliberately not generic. If someone later
 * "tidies" Kirby down to two jumps or gives Marth's tipper the higher hitbox id,
 * the data would still be structurally valid and the game would be wrong. These
 * tests are what makes those edits fail loudly.
 */

import { describe, expect, it } from "vitest";
import { toFloat } from "@/engine/fixed";
import {
  FIGHTERS,
  FIGHTER_IDS,
  MAX_WEIGHT,
  MIN_WEIGHT,
  donkeyKong,
  fox,
  getFighter,
  kirby,
  link,
  mario,
  marth,
  pikachu,
  samus,
} from "./index";

describe("the registry", () => {
  it("holds eight fighters", () => {
    expect(FIGHTERS).toHaveLength(8);
  });

  it("resolves every id", () => {
    for (const fighter of FIGHTERS) {
      expect(getFighter(fighter.id)).toBe(fighter);
    }
  });

  it("returns undefined for a fighter nobody defined", () => {
    expect(getFighter("bowser")).toBeUndefined();
  });

  it("gives every fighter a unique id", () => {
    expect(new Set(FIGHTER_IDS).size).toBe(FIGHTERS.length);
  });

  it("gives every fighter a unique fighter number", () => {
    const numbers = FIGHTERS.map((f) => f.number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("gives every fighter a unique name", () => {
    const names = FIGHTERS.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("lists the roster in fighter-number order, which is what the CSS uses", () => {
    const numbers = FIGHTERS.map((f) => f.number);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  });

  it("uses Ultimate's real fighter numbers", () => {
    expect(FIGHTERS.map((f) => f.number)).toEqual([1, 2, 3, 4, 6, 7, 10, 13]);
  });

  it("names a series for every fighter", () => {
    for (const fighter of FIGHTERS) {
      expect(fighter.series.length).toBeGreaterThan(0);
    }
  });
});

describe("weights", () => {
  it("keeps every weight inside Ultimate's real 62-135 range", () => {
    for (const fighter of FIGHTERS) {
      expect(
        fighter.attributes.weight,
        `${fighter.name} weighs ${fighter.attributes.weight}`
      ).toBeGreaterThanOrEqual(MIN_WEIGHT);
      expect(fighter.attributes.weight).toBeLessThanOrEqual(MAX_WEIGHT);
    }
  });

  it("matches the weights SPEC section 7 tabulates", () => {
    expect(mario.attributes.weight).toBe(98);
    expect(donkeyKong.attributes.weight).toBe(127);
    expect(link.attributes.weight).toBe(104);
    expect(samus.attributes.weight).toBe(108);
    expect(kirby.attributes.weight).toBe(79);
    expect(fox.attributes.weight).toBe(77);
    expect(pikachu.attributes.weight).toBe(79);
    expect(marth.attributes.weight).toBe(90);
  });

  it("spans a real spread, so the weight term in the knockback formula matters", () => {
    const weights = FIGHTERS.map((f) => f.attributes.weight);
    expect(Math.max(...weights) - Math.min(...weights)).toBeGreaterThanOrEqual(50);
  });
});

describe("the archetypes SPEC section 7 promises", () => {
  it("makes Donkey Kong the heaviest and Fox the lightest", () => {
    const sorted = [...FIGHTERS].sort((a, b) => a.attributes.weight - b.attributes.weight);
    expect(sorted[0].id).toBe("fox");
    expect(sorted[sorted.length - 1].id).toBe("donkeyKong");
  });

  it("gives Kirby six jumps and everyone else two", () => {
    expect(kirby.attributes.jumps).toBe(6);
    for (const fighter of FIGHTERS) {
      if (fighter.id === "kirby") continue;
      expect(fighter.attributes.jumps, `${fighter.name}`).toBe(2);
    }
  });

  it("makes Fox the fastest faller and the highest-gravity fighter, as he is in the game", () => {
    for (const fighter of FIGHTERS) {
      if (fighter.id === "fox") continue;
      expect(fox.attributes.fallSpeed, `${fighter.name} falls faster`).toBeGreaterThan(
        fighter.attributes.fallSpeed
      );
      expect(fox.attributes.fastFallSpeed).toBeGreaterThan(fighter.attributes.fastFallSpeed);
      expect(fox.attributes.gravity).toBeGreaterThan(fighter.attributes.gravity);
    }
  });

  it("gives Fox the fastest run, which is the other half of the rushdown", () => {
    for (const fighter of FIGHTERS) {
      if (fighter.id === "fox") continue;
      expect(fox.attributes.runSpeed).toBeGreaterThan(fighter.attributes.runSpeed);
    }
  });

  it("gives Kirby and Pikachu the two smallest hurtboxes", () => {
    const bySize = [...FIGHTERS].sort(
      (a, b) =>
        toFloat(a.attributes.height) * toFloat(a.attributes.width) -
        toFloat(b.attributes.height) * toFloat(b.attributes.width)
    );
    expect(new Set([bySize[0].id, bySize[1].id])).toEqual(new Set(["kirby", "pikachu"]));
  });

  it("gives Donkey Kong the largest hurtbox", () => {
    for (const fighter of FIGHTERS) {
      if (fighter.id === "donkeyKong") continue;
      expect(donkeyKong.attributes.height).toBeGreaterThan(fighter.attributes.height);
      expect(donkeyKong.attributes.width).toBeGreaterThan(fighter.attributes.width);
    }
  });

  it("gives Kirby the floatiest gravity and slowest air speed of the eight", () => {
    for (const fighter of FIGHTERS) {
      if (fighter.id === "kirby") continue;
      expect(kirby.attributes.gravity).toBeLessThan(fighter.attributes.gravity);
      expect(kirby.attributes.airSpeed).toBeLessThan(fighter.attributes.airSpeed);
    }
    // ...but not the worst in the whole game: 0.84 is 85th of 89. Slower still
    // are King Dedede, Luigi, Ganondorf and the Ice Climbers, none of whom are
    // on this roster.
    expect(toFloat(kirby.attributes.airSpeed)).toBeCloseTo(0.84, 3);
  });

  it("gives Marth the fastest walk in the game", () => {
    for (const fighter of FIGHTERS) {
      if (fighter.id === "marth") continue;
      expect(marth.attributes.walkSpeed).toBeGreaterThan(fighter.attributes.walkSpeed);
    }
  });
});

describe("Marth's tipper", () => {
  // The mechanic is expressed entirely through hitbox geometry and id ordering,
  // so these are the tests that stop a refactor quietly removing it.
  const TIPPERED = ["fsmash", "fair", "bair", "dtilt", "ftilt", "jab1", "jab2"] as const;

  it.each(TIPPERED)("%s pairs a tip and a body hitbox on the same frames", (slot) => {
    const move = marth.moves[slot]!;
    const [tip, body] = move.hitboxes;

    expect(tip.startFrame).toBe(body.startFrame);
    expect(tip.endFrame).toBe(body.endFrame);
  });

  it.each(TIPPERED)("%s puts the tip further out than the body", (slot) => {
    const [tip, body] = marth.moves[slot]!.hitboxes;
    expect(
      Math.abs(toFloat(tip.x)),
      `${slot}'s tip is not further out than its body`
    ).toBeGreaterThan(Math.abs(toFloat(body.x)));
  });

  it.each(TIPPERED)("%s gives the tip the lower id, so it wins the overlap", (slot) => {
    const [tip, body] = marth.moves[slot]!.hitboxes;
    expect(tip.id, `${slot}'s tip must have the lower id`).toBeLessThan(body.id);
  });

  it.each(TIPPERED)("%s makes the tip hit markedly harder", (slot) => {
    const [tip, body] = marth.moves[slot]!.hitboxes;
    expect(toFloat(tip.damage)).toBeGreaterThan(toFloat(body.damage));
    // "Markedly" — at least a quarter more, which every one of his clears.
    expect(toFloat(tip.damage)).toBeGreaterThan(toFloat(body.damage) * 1.25);
  });

  it("gives forward smash the largest tipper payoff, in damage and base knockback", () => {
    const [tip, body] = marth.moves.fsmash!.hitboxes;
    expect(toFloat(tip.damage)).toBe(18);
    expect(toFloat(body.damage)).toBe(13);
    expect(toFloat(tip.baseKnockback)).toBeGreaterThan(toFloat(body.baseKnockback));
  });

  it("leaves forward air's knockback identical, so its tipper is pure damage", () => {
    const [tip, body] = marth.moves.fair!.hitboxes;
    expect(tip.baseKnockback).toBe(body.baseKnockback);
    expect(tip.knockbackGrowth).toBe(body.knockbackGrowth);
  });

  it("puts back air's tipper bonus in growth rather than base knockback", () => {
    const [tip, body] = marth.moves.bair!.hitboxes;
    expect(tip.baseKnockback).toBe(body.baseKnockback);
    expect(tip.knockbackGrowth).toBeGreaterThan(body.knockbackGrowth);
  });

  it("does NOT spike on the down air tipper — the meteor is a separate body hitbox", () => {
    const dair = marth.moves.dair!;
    const meteors = dair.hitboxes.filter((h) => h.meteor);
    expect(meteors).toHaveLength(1);

    const meteor = meteors[0];
    // One frame only, and it hangs behind him rather than out at the blade.
    expect(meteor.startFrame).toBe(meteor.endFrame);
    expect(toFloat(meteor.x)).toBeLessThan(0);
    // It out-damages the tip, and wins any overlap.
    const tip = dair.hitboxes.find((h) => !h.meteor && toFloat(h.x) > 5)!;
    expect(toFloat(meteor.damage)).toBeGreaterThan(toFloat(tip.damage));
    expect(meteor.id).toBeLessThan(tip.id);
    // ...and the tip itself launches at the Sakurai angle, not downward.
    expect(toFloat(tip.angle)).toBe(361);
    expect(tip.meteor).toBeUndefined();
  });
});

describe("the other character-defining mechanics", () => {
  it("gives Fox a frame-2 jab and a frame-8 up smash, not the other way round", () => {
    // The widely repeated "frame 2 up smash" is Ultimate Frame Data's charge
    // hold, misread. Both the site and the game's own script say frame 8.
    expect(fox.moves.jab1!.hitboxes[0].startFrame).toBe(2);
    expect(fox.moves.usmash!.hitboxes[0].startFrame).toBe(8);
  });

  it("gives Fox a Blaster that causes no flinch at all", () => {
    for (const hitbox of fox.moves.neutralB!.hitboxes) {
      expect(hitbox.baseKnockback).toBe(0);
      expect(hitbox.knockbackGrowth).toBe(0);
      expect(hitbox.transcendent).toBe(true);
    }
  });

  it("gives Fox a Reflector on frame 3, not frame 1", () => {
    expect(fox.moves.downB!.hitboxes[0].startFrame).toBe(3);
  });

  it("gives Kirby the back air that kills — frame 6 with growth over 100", () => {
    const clean = kirby.moves.bair!.hitboxes[0];
    expect(clean.startFrame).toBe(6);
    expect(toFloat(clean.damage)).toBe(13);
    expect(toFloat(clean.knockbackGrowth)).toBeGreaterThan(100);
    expect(kirby.moves.bair!.landingLag).toBe(10);
  });

  it("gives Pikachu a two-segment Quick Attack whose second half carries the knockback", () => {
    const quickAttack = pikachu.moves.upB!;
    expect(quickAttack.hitboxes).toHaveLength(2);
    const [first, second] = quickAttack.hitboxes;
    expect(second.startFrame).toBeGreaterThan(first.endFrame);
    expect(toFloat(second.knockbackGrowth)).toBeGreaterThan(toFloat(first.knockbackGrowth));
  });

  it("gives Pikachu a looping jab rather than a three-hit string", () => {
    expect(pikachu.moves.rapidJab).toBeDefined();
    expect(pikachu.moves.rapidJab!.rapid).toBe(true);
    expect(pikachu.moves.jab2).toBeUndefined();
    expect(pikachu.moves.jab3).toBeUndefined();
  });

  it("gives Samus a tether grab that is far slower than everyone else's", () => {
    expect(samus.moves.grab!.hitboxes[0].startFrame).toBe(15);
    for (const fighter of FIGHTERS) {
      if (fighter.id === "samus") continue;
      expect(
        fighter.moves.grab!.hitboxes[0].startFrame,
        `${fighter.name} grabs slower than Samus`
      ).toBeLessThan(15);
    }
    // ...and reaches much further, which is what it buys.
    for (const fighter of FIGHTERS) {
      if (fighter.id === "samus") continue;
      expect(toFloat(samus.moves.grab!.hitboxes[0].x)).toBeGreaterThan(
        toFloat(fighter.moves.grab!.hitboxes[0].x)
      );
    }
  });

  it("gives Link neither a wall jump nor a tether, as Ultimate's Link has neither", () => {
    expect(link.attributes.canWallJump).toBe(false);
    // A tether grab would show up as a startup like Samus's; Link's is frame 6.
    expect(link.moves.grab!.hitboxes[0].startFrame).toBe(6);
  });

  it("gives Link three projectiles he can have out at once, as the spec promises", () => {
    // Bow, boomerang, bomb — and each on a different special, which is what
    // makes "three projectiles at once" possible rather than just three moves.
    for (const slot of ["neutralB", "sideB", "downB"] as const) {
      const move = link.moves[slot]!;
      expect(move.projectiles?.length, `Link's ${slot} launches nothing`).toBe(1);
      // The throw itself never damages anyone; the object does.
      expect(move.hitboxes).toHaveLength(0);
    }
    expect(link.moves.neutralB!.projectiles![0].visual).toBe("arrow");
    expect(link.moves.sideB!.projectiles![0].visual).toBe("boomerang");
    expect(link.moves.downB!.projectiles![0].visual).toBe("bomb");
  });

  it("gives Samus a Charge Shot that is chargeable and holds its charge", () => {
    const chargeShot = samus.moves.neutralB!;
    expect(chargeShot.name).toBe("Charge Shot");
    expect(chargeShot.chargeable).toBe(true);
    expect(chargeShot.projectiles![0].chargeScaling).toBeGreaterThan(0);
  });

  it("makes every smash attack chargeable and nothing else that shouldn't be", () => {
    for (const fighter of FIGHTERS) {
      for (const slot of ["fsmash", "usmash", "dsmash"] as const) {
        expect(fighter.moves[slot]!.chargeable, `${fighter.name} ${slot}`).toBe(true);
      }
      for (const slot of ["jab1", "ftilt", "utilt", "dtilt", "nair", "fair"] as const) {
        expect(fighter.moves[slot]?.chargeable, `${fighter.name} ${slot}`).toBeUndefined();
      }
    }
  });

  it("gives Donkey Kong super armour on his charged Giant Punch", () => {
    expect(donkeyKong.moves.neutralB!.superArmourFrames).toEqual([9, 20]);
    expect(donkeyKong.moves.neutralB!.chargeable).toBe(true);
  });

  it("keeps every fighter's moveset mutually distinguishable", () => {
    // Two fighters sharing a frame-for-frame identical forward smash would mean
    // a copy-paste, not a coincidence.
    const signatures = FIGHTERS.map((f) =>
      JSON.stringify(f.moves.fsmash!.hitboxes.map((h) => [h.damage, h.angle, h.baseKnockback]))
    );
    expect(new Set(signatures).size).toBe(FIGHTERS.length);
  });
});

describe("palettes read apart at a glance", () => {
  it("gives all eight fighters distinct primary colours", () => {
    const primaries = FIGHTERS.map((f) => f.palette.primary);
    expect(new Set(primaries).size).toBe(FIGHTERS.length);
  });

  it("keeps the primaries far enough apart in RGB to tell apart mid-match", () => {
    const rgb = (hex: string) => [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
    const primaries = FIGHTERS.map((f) => ({ name: f.name, c: rgb(f.palette.primary) }));

    for (let i = 0; i < primaries.length; i++) {
      for (let j = i + 1; j < primaries.length; j++) {
        const a = primaries[i];
        const b = primaries[j];
        const distance = Math.hypot(a.c[0] - b.c[0], a.c[1] - b.c[1], a.c[2] - b.c[2]);
        expect(
          distance,
          `${a.name} and ${b.name} are too close in colour`
        ).toBeGreaterThan(60);
      }
    }
  });

  it("gives each fighter the colour the spec asks for", () => {
    // A coarse hue check, not a pixel match — enough to catch Fox turning blue.
    const dominant = (hex: string) => {
      const [r, g, b] = [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
      ];
      return { r, g, b };
    };

    const marioC = dominant(mario.palette.primary);
    expect(marioC.r).toBeGreaterThan(marioC.g + 60); // red

    const linkC = dominant(link.palette.primary);
    expect(linkC.g).toBeGreaterThan(linkC.r + 20); // green

    const kirbyC = dominant(kirby.palette.primary);
    expect(kirbyC.r).toBeGreaterThan(kirbyC.g + 40); // pink: red-dominant, blue-rich
    expect(kirbyC.b).toBeGreaterThan(kirbyC.g);

    const pikachuC = dominant(pikachu.palette.primary);
    expect(pikachuC.r).toBeGreaterThan(150); // yellow: red and green high, blue low
    expect(pikachuC.g).toBeGreaterThan(150);
    expect(pikachuC.b).toBeLessThan(150);

    const marthC = dominant(marth.palette.primary);
    expect(marthC.b).toBeGreaterThan(marthC.r + 60); // blue

    const foxC = dominant(fox.palette.primary);
    expect(foxC.r).toBeGreaterThan(foxC.b + 80); // orange
    expect(foxC.g).toBeGreaterThan(foxC.b);
  });
});
