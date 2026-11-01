/**
 * Specials that charge, driven through the real `step()` with the real roster
 * (Plan 5, Task 2; the D32 rule: assert on what a player sees).
 *
 * Two kinds, as in SSBU:
 * - **hold**: the charge grows while B is held and the move fires on release —
 *   Hero's Bow, Shield Breaker, Hammer Flip, Skull Bash. Shield Breaker and
 *   Skull Bash also fire by themselves at full; the bow and Hammer Flip can be
 *   held there (SmashWiki "Charge", https://www.ssbwiki.com/Charge);
 * - **store**: the charge loops until B is pressed again; a shield, a roll, a
 *   spot dodge, a jump or an air dodge puts it away for later, and a full charge
 *   stores itself — Charge Shot, Giant Punch (and F.L.U.D.D. in Task 6).
 *
 * Before this, every chargeable special read the *attack* button, so the bow
 * never charged and Charge Shot always fired at 5%.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { ONE, fx, toFloat } from "@/engine/fixed";
import { chargeFraction } from "@/engine/projectile";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { chargedHitbox } from "@/engine/specialCharge";
import { hasSuperArmour } from "@/engine/states";
import { Btn } from "@/engine/types";
import type { FighterState, GameState, InputFrame, MatchRules, ProjectileState } from "@/engine/types";
import { STAGES } from "@/stages";
import { FIGHTERS, donkeyKong, kirby, link, marth, pikachu, samus } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

/** `defId` standing at centre stage, Mario far away on the right, both actionable. */
function standing(defId: string): GameState {
  const s = createInitialState("finalDestination", [{ defId }, { defId: "mario" }], RULES, 99);
  s.fighters.forEach((f, i) =>
    Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(i === 0 ? -30 : 60), y: 0, facing: 1, intangible: 0 }),
  );
  return s;
}

/** `defId` in the air at centre stage, its ground jump spent, high enough to charge without landing. */
function airborne(defId: string): GameState {
  const s = standing(defId);
  Object.assign(s.fighters[0], { action: "fall", grounded: false, platform: -1, y: fx(80), jumpsUsed: 1 });
  return s;
}

/**
 * Step with the given per-frame inputs for port 0; port 1 idles. Frame n of the
 * result (1-based: `trace[n − 1]`) is the n-th frame from the first input, so a
 * move begun by `inputs[0]` reads frame data "from the press".
 */
function play(
  s: GameState,
  inputs: readonly InputFrame[],
): { state: GameState; trace: FighterState[]; foe: FighterState[]; spawned: number[]; shots: ProjectileState[] } {
  let state = s;
  let prev: InputFrame = 0;
  const trace: FighterState[] = [];
  const foe: FighterState[] = [];
  const spawned: number[] = [];
  const shots: ProjectileState[] = [];
  for (const input of inputs) {
    const before = state.nextProjectileId;
    state = step(state, [input, 0], { prevInputs: [prev, 0] }).state;
    prev = input;
    trace.push(state.fighters[0]);
    foe.push(state.fighters[1]);
    if (state.nextProjectileId > before) {
      spawned.push(trace.length);
      shots.push(state.projectiles[state.projectiles.length - 1]);
    }
  }
  return { state, trace, foe, spawned, shots };
}

/** The 1-based frames on which `pred` holds. */
const framesWhere = <T,>(xs: readonly T[], pred: (x: T) => boolean): number[] =>
  xs.flatMap((x, i) => (pred(x) ? [i + 1] : []));

/** The first frame `f` is out of the move: the frame data's "Interruptible". */
const actsOn = (trace: readonly FighterState[]): number => trace.findIndex((f) => f.action !== "special") + 1;

const press = (b: InputFrame, then: InputFrame, frames: number): InputFrame[] => [b, ...Array<InputFrame>(frames - 1).fill(then)];

describe("Charge Shot stores its charge (store mode)", () => {
  it("charges in a loop after pressing B once, and a full charge stores itself on the frame it fills", () => {
    // UltimateFrameData (https://ultimateframedata.com/samus): "125 frames to
    // reach full charge", the 13 entry frames and SmashWiki's 112 charge frames
    // (https://www.ssbwiki.com/Samus_(SSBU)/Neutral_special). SmashWiki "Charge
    // Shot" (https://www.ssbwiki.com/Charge_Shot): at full "Samus will stop
    // charging and resume her neutral standing position".
    const { state, trace } = play(standing("samus"), press(Btn.Special, 0, 200));
    expect(actsOn(trace)).toBe(125);
    expect(state.fighters[0].combat.storedCharge).toBe(112);
    expect(state.fighters[0].action).toBe("stand");
    expect(state.projectiles).toHaveLength(0);
  });

  it("puts a partial charge away on shield, and keeps it", () => {
    const inputs = [...press(Btn.Special, 0, 43), Btn.Shield];
    const { state } = play(standing("samus"), inputs);
    expect(state.fighters[0].combat.storedCharge).toBe(30);
    expect(state.fighters[0].action).toBe("shieldStart");
  });

  it("puts it away on a jump too", () => {
    const { state } = play(standing("samus"), [...press(Btn.Special, 0, 33), Btn.Jump]);
    expect(state.fighters[0].combat.storedCharge).toBe(20);
    expect(state.fighters[0].action).toBe("jumpSquat");
  });

  it("fires a stored full charge 16 frames after B, at full strength, and acts again on frame 61", () => {
    // SmashWiki "Samus (SSBU)/Neutral special", fully charged: "Hitbox 16-75",
    // "Interruptible (grounded) 61"; UltimateFrameData (https://ultimateframedata.com/samus):
    // "Charge Shot, Full Charge", startup 16. She plays her 13 entry frames first.
    const charged = play(standing("samus"), press(Btn.Special, 0, 200)).state;
    const { state, trace, spawned, shots } = play(charged, press(Btn.Special, 0, 70));
    expect(spawned).toEqual([16]);
    expect(shots[0].charge).toBe(ONE);
    expect(actsOn(trace)).toBe(61);
    expect(state.fighters[0].combat.storedCharge).toBe(0);
  });

  it("an uncharged or partial shot still acts again on frame 45 (32 from release)", () => {
    // SmashWiki "Samus (SSBU)/Neutral special", not fully charged: "Interruptible (grounded) 45 (32)".
    const { trace } = play(standing("samus"), [Btn.Special, ...Array<InputFrame>(12).fill(0), Btn.Special, ...Array<InputFrame>(40).fill(0)]);
    expect(actsOn(trace)).toBe(45);
  });

  it("fires on a second B press, with the charge built so far", () => {
    const { shots } = play(standing("samus"), [...press(Btn.Special, 0, 69), Btn.Special, 0, 0, 0, 0]);
    expect(shots).toHaveLength(1);
    expect(shots[0].charge).toBe(Math.trunc((56 * ONE) / 112));
  });

  it("puts it away on a spot dodge (shield and down) and on a roll (shield and a side)", () => {
    // SmashWiki "Charge Shot": in Ultimate "she can cancel the charge with a
    // jump or spotdodge", and the move list: "Can keep the charge after dodging
    // or shielding".
    const spot = play(standing("samus"), [...press(Btn.Special, 0, 33), Btn.Shield | Btn.Down]).state.fighters[0];
    expect(spot.action).toBe("spotDodge");
    expect(spot.combat.storedCharge).toBe(20);
    const roll = play(standing("samus"), [...press(Btn.Special, 0, 33), Btn.Shield | Btn.Left]).state.fighters[0];
    expect(roll.action).toBe("roll");
    expect(roll.combat.storedCharge).toBe(20);
  });

  it("in the air, puts it away on a midair jump and on an air dodge", () => {
    // SmashWiki "Charge Shot": Ultimate is the first game where it is charged
    // in midair, and it cancels "with a jump"; "Charge storage cancel"
    // (https://www.ssbwiki.com/Charge_storage_cancel): from Brawl on, a shield
    // press in the air is an air dodge.
    const jumped = play(airborne("samus"), [...press(Btn.Special, 0, 33), Btn.Jump]).state.fighters[0];
    expect(jumped.action).toBe("jump");
    expect(jumped.jumpsUsed).toBe(2);
    expect(jumped.combat.storedCharge).toBe(20);
    const dodged = play(airborne("samus"), [...press(Btn.Special, 0, 33), Btn.Shield]).state.fighters[0];
    expect(dodged.action).toBe("airDodge");
    expect(dodged.combat.storedCharge).toBe(20);
  });

  it("fires uncharged on a second B pressed during the entry frames, through the 9-frame buffer", () => {
    // A press 7 frames before the loop is still in the buffer when it is reached
    // (frame 14), so the shot leaves at once, uncharged; one 11 frames before has
    // expired, and she charges.
    const quick = play(standing("samus"), [Btn.Special, 0, 0, 0, 0, 0, Btn.Special, ...Array<InputFrame>(20).fill(0)]);
    expect(quick.spawned).toEqual([16]);
    expect(quick.shots[0].charge).toBe(0);
    const early = play(standing("samus"), [Btn.Special, 0, Btn.Special, ...Array<InputFrame>(30).fill(0)]);
    expect(early.spawned).toEqual([]);
    expect(early.trace[early.trace.length - 1].charge).toBeGreaterThan(0);
  });

  it("is not charged by holding attack", () => {
    const { trace } = play(standing("samus"), press(Btn.Special, Btn.Attack, 40));
    expect(trace.some((f) => f.charge > 0)).toBe(true);
    const held = play(standing("samus"), press(Btn.Attack, Btn.Attack, 40)).trace;
    expect(held.every((f) => f.move !== "neutralB")).toBe(true);
  });
});

describe("Giant Punch stores its charge too", () => {
  /** Donkey Kong with Mario in reach of the punch. */
  function facingMario(): GameState {
    const s = standing("donkeyKong");
    s.fighters[1].x = fx(-18);
    s.fighters[1].facing = 1;
    s.fighters[0].x = fx(-30);
    return s;
  }

  it("swings its arms until B, then punches at the charged damage", () => {
    const { state } = play(facingMario(), [...press(Btn.Special, 0, 117), Btn.Special, ...Array<InputFrame>(40).fill(0)]);
    // 110 charge frames: 10% + 18 = 28%; ×1.05 fresh, ×1.2 one-on-one.
    expect(toFloat(state.fighters[1].damage)).toBeCloseTo(28 * 1.05 * 1.2, 2);
  });

  /** A stored full punch from B, into Mario or (`whiff`) into the air: frame data count no hitlag. */
  function storedFullPunch(whiff: boolean) {
    const s = whiff ? standing("donkeyKong") : facingMario();
    s.fighters[0].combat.storedCharge = 110;
    return play(s, press(Btn.Special, 0, 60));
  }

  it("a stored full punch skips to the punch: it connects 19 frames after B and acts on 48", () => {
    // SmashWiki "Donkey Kong (SSBU)/Neutral special"
    // (https://www.ssbwiki.com/Donkey_Kong_(SSBU)/Neutral_special), fully
    // charged: "Hitbox 19-20", "Interruptible 48".
    expect(framesWhere(storedFullPunch(false).foe, (f) => f.damage > 0)[0]).toBe(19);
    expect(actsOn(storedFullPunch(true).trace)).toBe(48);
  });

  it("is super armoured on frames 9-20 of a stored full punch, which covers its hit on 19-20", () => {
    // SmashWiki, fully charged: "Super armor (grounded) 9-20"; UltimateFrameData
    // (https://ultimateframedata.com/donkey_kong): "Ground version has Super Armor frames 9-20".
    const armoured = framesWhere(storedFullPunch(true).trace, (f) => hasSuperArmour(f, donkeyKong));
    expect(armoured).toEqual(Array.from({ length: 12 }, (_, i) => 9 + i));
    expect(armoured).toContain(framesWhere(storedFullPunch(false).foe, (f) => f.damage > 0)[0]);
  });

  it("has no super armour uncharged or partly charged (SmashWiki lists it for the full charge only)", () => {
    const tap = play(facingMario(), [Btn.Special, 0, 0, 0, 0, 0, 0, Btn.Special, ...Array<InputFrame>(70).fill(0)]).trace;
    expect(framesWhere(tap, (f) => hasSuperArmour(f, donkeyKong))).toEqual([]);
    const half = play(facingMario(), [...press(Btn.Special, 0, 62), Btn.Special, ...Array<InputFrame>(70).fill(0)]).trace;
    expect(framesWhere(half, (f) => hasSuperArmour(f, donkeyKong))).toEqual([]);
  });
});

describe("hold-mode specials charge on B, not on attack", () => {
  it("Hero's Bow looses a stronger, faster arrow the longer B is held", () => {
    const quick = play(standing("link"), [Btn.Special, 0, ...Array<InputFrame>(30).fill(0)]).shots[0];
    const full = play(standing("link"), [...press(Btn.Special, Btn.Special, 90), ...Array<InputFrame>(20).fill(0)]).shots[0];
    expect(quick.charge).toBe(0);
    expect(full.charge).toBe(ONE);
    expect(Math.abs(full.vx)).toBeGreaterThan(Math.abs(quick.vx) * 3);
  });

  it("Hero's Bow can be held at full: the arrow leaves when B comes up", () => {
    // SmashWiki "Charge" (https://www.ssbwiki.com/Charge): Hero's Bow "Can be
    // held indefinitely". Held 150 frames, it looses on the release, frame 151.
    const { spawned, shots } = play(standing("link"), [...press(Btn.Special, Btn.Special, 150), ...Array<InputFrame>(20).fill(0)]);
    expect(spawned).toEqual([151]);
    expect(shots[0].charge).toBe(ONE);
  });

  it("...up to its 180-frame maximum hold", () => {
    // SmashWiki "Link (SSBU)/Neutral special" (https://www.ssbwiki.com/Link_(SSBU)/Neutral_special):
    // "Maximum hold time 180 frames". The loop is reached on frame 16, so the
    // 180th charge frame is frame 195, and the arrow leaves on 196.
    const { spawned } = play(standing("link"), press(Btn.Special, Btn.Special, 300));
    expect(spawned).toEqual([196]);
  });

  it("Hammer Flip can be held at full, burning Kirby 1% every 26 frames there", () => {
    // SmashWiki "Charge": Hammer Flip "Can be held indefinitely"; "While fully
    // charged, 1% damage is dealt to Kirby". SmashWiki "Kirby (SSBU)/Side
    // special" (https://www.ssbwiki.com/Kirby_(SSBU)/Side_special): "Interval
    // for recoil damage at full charge 26 frames". Full on frame 135 (loop 15
    // + 120): burns on 161, 187 and 213.
    const { state, trace } = play(standing("kirby"), [Btn.Special | Btn.Right, ...Array<InputFrame>(219).fill(Btn.Special)]);
    expect(trace.every((f) => f.action === "special" && f.move === "sideB")).toBe(true);
    expect(toFloat(state.fighters[0].damage)).toBeCloseTo(3, 5);
    expect(framesWhere(trace, (f) => f.damage > 0)[0]).toBe(161);
  });

  it("Hammer Flip's recoil stops at 100%", () => {
    // SmashWiki "Kirby (SSBU)/Side special": "Maximum percent for full charge
    // recoil damage 100%". UNVERIFIED reading: no burn at or above 100%.
    const s = standing("kirby");
    s.fighters[0].damage = fx(100);
    const { state } = play(s, [Btn.Special | Btn.Right, ...Array<InputFrame>(219).fill(Btn.Special)]);
    expect(state.fighters[0].damage).toBe(fx(100));
  });

  it("Skull Bash fires by itself at full charge, B still held", () => {
    // SmashWiki "Charge": Skull Bash "Automatically activates at full charge".
    const { trace } = play(standing("pikachu"), [Btn.Special | Btn.Right, ...Array<InputFrame>(149).fill(Btn.Special)]);
    expect(Math.max(...trace.map((f) => f.charge))).toBe(80);
    expect(trace[119].actionFrame).toBeGreaterThan(pikachu.moves.sideB!.specialCharge!.loopFrame);
  });

  it("Shield Breaker waits while B is held, then lands at its full-charge damage", () => {
    const s = standing("marth");
    s.fighters[1].x = fx(-20);
    const { state, trace } = play(s, [...press(Btn.Special, Btn.Special, 75), ...Array<InputFrame>(20).fill(0)]);
    expect(Math.max(...trace.map((f) => f.charge))).toBe(60);
    expect(toFloat(state.fighters[1].damage)).toBeCloseTo(24 * 1.05 * 1.2, 2);
  });
});

describe("the roster", () => {
  const SPECIALS = ["neutralB", "sideB", "upB", "downB"] as const;

  it("charges no special on the attack button: `chargeable` is for smashes only", () => {
    for (const def of FIGHTERS) {
      for (const slot of SPECIALS) {
        expect(def.moves[slot]?.chargeable, `${def.id} ${slot}`).toBeUndefined();
      }
    }
  });

  it("auto-releases at full only Shield Breaker, Skull Bash and the Spin Attack; the bow and Hammer Flip hold (SmashWiki Charge)", () => {
    const atFull = FIGHTERS.flatMap((def) =>
      SPECIALS.flatMap((slot) => {
        const sc = def.moves[slot]?.specialCharge;
        return sc?.mode === "hold" ? [`${def.id} ${slot} ${sc.atFull}`] : [];
      }),
    ).sort();
    // Link's Spin Attack (Plan 5, Task 13b): "Automatically activates at full charge".
    expect(atFull).toEqual(["kirby sideB hold", "link neutralB hold", "link upB release", "marth neutralB release", "pikachu sideB release"]);
  });
});

describe("a stored charge and a KO", () => {
  it("is lost with the stock", () => {
    // SmashWiki "Charge" (https://www.ssbwiki.com/Charge) notes surviving a KO
    // only for Oil Panic and Wario Waft ("Charge can be held even after ... is KO'd").
    const s = standing("samus");
    Object.assign(s.fighters[0], { action: "fall", grounded: false, platform: -1, x: fx(-1000) });
    s.fighters[0].combat.storedCharge = 112;
    const { state } = play(s, [0]);
    expect(state.fighters[0].action).toBe("dead");
    expect(state.fighters[0].combat.storedCharge).toBe(0);
  });
});

describe("a charged shot hits with its charged hitbox", () => {
  /** Samus's Charge Shot into Mario, fired from a stored charge of `stored` frames. */
  function shotInto(stored: number): number {
    const s = standing("samus");
    s.fighters[1].x = fx(10);
    s.fighters[0].combat.storedCharge = stored;
    // A full charge fires by itself; anything less fires on a second B at the loop (frame 14).
    const inputs = stored >= 112 ? press(Btn.Special, 0, 60) : [...press(Btn.Special, 0, 13), Btn.Special, ...Array<InputFrame>(60).fill(0)];
    return toFloat(play(s, inputs).state.fighters[1].damage);
  }

  it("a full Charge Shot lands 28%, an uncharged one 5% (×1.2 one-on-one, ×1.05 fresh)", () => {
    // SmashWiki "Samus (SSBU)/Neutral special": 5% uncharged, 28% at full. A
    // projectile's hit stales as its move was when it was fired (Plan 5 final wave 2,
    // ruling R-FW2b): here fresh, ×1.05 (`effectiveDamage`).
    expect(shotInto(112)).toBeCloseTo(28 * 1.05 * 1.2, 2);
    expect(shotInto(0)).toBeCloseTo(5 * 1.05 * 1.2, 2);
  });
});

describe("a charge a frame short of full (SmashWiki's partial-charge formulas)", () => {
  /** The move's box `id` after `c` charge frames, as the sim builds it. */
  function box(move: NonNullable<typeof marth.moves.neutralB>, id: number, c: number) {
    const sc = move.specialCharge!;
    const hb = move.hitboxes.find((h) => h.id === id)!;
    return chargedHitbox(hb, sc.full?.[id], chargeFraction(c, sc.frames), sc.partial);
  }

  it("Shield Breaker: 1 + 1.2·c/60 — 19.62% tip, 17.44% body at 59; 24% / 22% at 60", () => {
    const sb = marth.moves.neutralB!;
    expect(toFloat(box(sb, 0, 59).damage)).toBeCloseTo(19.62, 1);
    expect(toFloat(box(sb, 1, 59).damage)).toBeCloseTo(17.44, 1);
    expect(box(sb, 0, 60).damage).toBe(fx(24));
    expect(box(sb, 1, 60).damage).toBe(fx(22));
  });

  it("Hammer Flip: 0.085% a frame — 29.115% at 119; 35% at 361° at 120", () => {
    const hf = kirby.moves.sideB!;
    expect(toFloat(box(hf, 0, 119).damage)).toBeCloseTo(29.115, 2);
    expect(box(hf, 0, 119).angle).toBe(hf.hitboxes[0].angle);
    expect(box(hf, 0, 120).damage).toBe(fx(35));
    expect(box(hf, 0, 120).angle).toBe(fx(361));
  });

  it("Charge Shot: every number linear, radius included — r 1.9 + 6.1·c/112", () => {
    // SmashWiki "Samus (SSBU)/Neutral special": damage, BK, KS and radius
    // "linearly scaled from the ID 0 hitbox to the ID 1 hitbox"; the angle is
    // the ID 0 box's until full.
    const shot = samus.moves.neutralB!.projectiles![0];
    const at = chargedHitbox(shot.hitbox, shot.charged!.hitbox, chargeFraction(56, 112), shot.charged!.partial);
    expect(toFloat(at.radius)).toBeCloseTo(1.9 + (6.1 * 56) / 112, 2);
    expect(toFloat(at.damage)).toBeCloseTo(5 + (23 * 56) / 112, 2);
    expect(toFloat(at.baseKnockback)).toBeCloseTo(14 + (32 * 56) / 112, 2);
    expect(toFloat(at.knockbackGrowth)).toBeCloseTo(42 + (8 * 56) / 112, 2);
    expect(at.angle).toBe(shot.hitbox.angle);
  });

  it("Giant Punch: 10 + 18·c/110 rounded down — 27% at 109, 28% at 110", () => {
    const gp = donkeyKong.moves.neutralB!;
    expect(box(gp, 0, 109).damage).toBe(fx(27));
    expect(box(gp, 0, 110).damage).toBe(fx(28));
  });

  it("Skull Bash: 6.2 + 15.2·c/80, unrounded", () => {
    const sk = pikachu.moves.sideB!;
    expect(toFloat(box(sk, 0, 79).damage)).toBeCloseTo(6.2 + (15.2 * 79) / 80, 2);
  });

  it("the bow: 4 + 8·c/60 rounded down — 11% at 59", () => {
    const arrow = link.moves.neutralB!.projectiles![0];
    const at = (c: number) => chargedHitbox(arrow.hitbox, arrow.charged!.hitbox, chargeFraction(c, 60), arrow.charged!.partial);
    expect(at(59).damage).toBe(fx(11));
    expect(at(60).damage).toBe(fx(12));
    expect(at(7).damage).toBe(fx(4));
  });
});
