/**
 * Hitlag against published totals (Plan 5, Task 7b): a freeze of n frames counts
 * the frame it starts on, so it adds n − 1 frames to a move, and its damage leaves
 * the 1v1 multiplier out.
 *
 * Sources, every one read for this task:
 * - SmashWiki "Hitlag" (https://www.ssbwiki.com/Hitlag): Ultimate's
 *   `⌊⌊⌊(d×0.65+6)×h×e×s⌋×p⌋×c⌋`, d "the amount of damage an attack would deal":
 *   "Stale/fresh damage, equipment, spirits, etc. are factored. The 1v1 multiplier
 *   and shield damage are not factored"; the attacker is frozen "in the frame when
 *   they landed the hit".
 * - SmashWiki "Marth (SSBU)/Forward throw"
 *   (https://www.ssbwiki.com/Marth_(SSBU)/Forward_throw): "During frame 14, the move
 *   inflicts 4 frames of hitlag", with its timing "without the hitlag" (release 15,
 *   interruptible 32) against UltimateFrameData's 18/34: 3 more, not 4.
 * - SmashWiki "Pikachu (SSBU)/Down throw"
 *   (https://www.ssbwiki.com/Pikachu_(SSBU)/Down_throw): the frame-14 box "set to
 *   both appear and be deleted on frame 14", "causing hitlag but not any damage";
 *   "Throw Release 21", "Interruptible 44"; the release's hitlag "causing their
 *   knockback to start on frame 30": frames 21 to 29 frozen, 9 of them.
 * - SmashWiki "Pummel" (https://www.ssbwiki.com/Pummel): totals are "the combined
 *   total frames of both the pummels' coded duration and the amount of hitlag they
 *   inflict" and "do not account for the 1v1 multiplier": Mario 19, Donkey Kong 21,
 *   Link 19, Samus 19, Kirby 15, Fox 15, Pikachu 16 ("18 prior to version 2.0.0"),
 *   Marth 19.
 * - SmashWiki "Donkey Kong (SSBU)/Pummel"
 *   (https://www.ssbwiki.com/Donkey_Kong_(SSBU)/Pummel): 1.6%, hitlag ×2.3, hitbox
 *   2, interruptible 8. SmashWiki "Pikachu (SSBU)/Pummel"
 *   (https://www.ssbwiki.com/Pikachu_(SSBU)/Pummel): 1.0%, ×1.3, electric,
 *   interruptible 6; 2.0.0 "Pummel deals less hitlag (14 frames → 12)".
 * - SmashWiki "Stale Moves" (https://www.ssbwiki.com/Stale_Moves): in Training
 *   Mode with staling off moves "deal their base damage", and in single-player
 *   "the freshness bonus is also ignored, so attacks always do their base damage".
 * - UltimateFrameData (https://ultimateframedata.com/<fighter>), fetched
 *   2026-10-30: Mario "Jab 1" startup 2, total 19, shield stun 3, advantage −14,
 *   and "Pummel" 19, "Total frames includes 14 frames of hitlag"; Fox "Jab 1"
 *   startup 2, total 17, shield stun 3, advantage −12; Mario "Forward Tilt" startup
 *   5, total 25, shield stun 7, advantage −13; Marth "Jab 1" startup 5, total 25,
 *   shield stun 4/6, advantage −16/−14 (close/tipper); Pikachu "Down Throw" 29 / 51;
 *   its definitions (https://ultimateframedata.com/smash): "Shield Lag is just extra
 *   freeze frames that both the attacker and defender suffer, so it does not affect
 *   frame advantage", "Shield Stun is the amount of frames that the defender is
 *   stuck after Shield Lag ends";
 *   pummels Mario 19, Donkey Kong 21, Link 18, Samus 19, Kirby 15, Fox 15,
 *   Pikachu 16, Marth 19.
 *
 * Move data: rubendal's SSBU Data Viewer scripts, patch 13.0.1, in `acmd/generated/`.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { fx, mul } from "@/engine/fixed";
import { moveFrameOf } from "@/engine/hitbox";
import { STALE_FRESH_BONUS, computeHitlag } from "@/engine/knockback";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import type { SimContext } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { GameState, InputFrame, MatchRules, StepEvents } from "@/engine/types";
import { bakedContext } from "@/game/bake";
import { readBakeFromDisk } from "@/game/bakeNode";
import { STAGES } from "@/stages";
import { FIGHTERS } from "./index";

const BY_ID = new Map(FIGHTERS.map((f) => [f.id, f]));
const GAME: SimContext = bakedContext({ fighter: (id) => BY_ID.get(id)!, stage: (id) => STAGES.find((s) => s.id === id)! }, readBakeFromDisk());
const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: false };
const MODES = [
  ["out of 1v1", false],
  ["in 1v1", true],
] as const;

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

/** `a` at −gap/2 facing right, `b` at +gap/2 facing left, both standing on Final Destination. */
function duel(a: string, b: string, gap: number, oneOnOne: boolean): GameState {
  const s = createInitialState("finalDestination", [{ defId: a }, { defId: b }], { ...RULES, oneOnOne }, 5, GAME);
  s.fighters.forEach((f, i) =>
    Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(i === 0 ? -gap / 2 : gap / 2), y: 0, facing: i === 0 ? 1 : -1, intangible: 0, invincible: 0 }),
  );
  return s;
}

/** `thrower` holding Fox, as a landed grab leaves them. */
function holding(thrower: string, oneOnOne: boolean): GameState {
  const s = createInitialState("finalDestination", [{ defId: thrower }, { defId: "fox" }], { ...RULES, oneOnOne }, 5, GAME);
  const [a, v] = s.fighters;
  Object.assign(a, { action: "grabHold", actionFrame: 0, grounded: true, platform: 0, x: fx(-4), y: 0, facing: 1, intangible: 0, invincible: 0, grabbing: 1 });
  Object.assign(v, { action: "grabbed", actionFrame: 0, grounded: true, platform: 0, x: fx(4), y: 0, facing: -1, intangible: 0, invincible: 0, grabbedBy: 0, grabTimer: 500 });
  return s;
}

/** Step `n` frames with port 0's and port 1's inputs; step 0 is game frame 1 of a move pressed on it. */
function run(s0: GameState, n: number, in0: (i: number) => InputFrame, in1: (i: number) => InputFrame = () => 0) {
  let s = s0;
  let prev: InputFrame[] = [0, 0];
  const states: GameState[] = [];
  const events: StepEvents[] = [];
  for (let i = 0; i < n; i++) {
    const now = [in0(i), in1(i)];
    const out = step(s, now, { prevInputs: prev, ctx: GAME });
    s = out.state;
    prev = now;
    states.push(s);
    events.push(out.events);
  }
  return { states, events };
}

const press = (b: Btn, at = 0) => (i: number): InputFrame => (i === at ? b : 0);
/** How many frames from the press port 0 spends in `action`. */
const framesIn = (states: readonly GameState[], action: GameState["fighters"][number]["action"]): number =>
  states.findIndex((s) => s.fighters[0].action !== action);

describe("Mario's jab 1 against UltimateFrameData", () => {
  // `game_attack11`: 2.2%, hitlag ×1.8, so fresh (×1.05) ⌊(2.31 × 0.65 + 6) × 1.8⌋ = 13
  // frames, one-on-one too: in 1v1 the 2.772% it deals would freeze 14.
  const N = computeHitlag(mul(fx(2.2), STALE_FRESH_BONUS), { moveMultiplier: fx(1.8) });

  it("freezes 13, where its 1v1 damage would freeze 14", () => {
    expect(N).toBe(13);
    expect(computeHitlag(mul(mul(fx(2.2), STALE_FRESH_BONUS), fx(1.2)), { moveMultiplier: fx(1.8) })).toBe(14);
  });

  it("lasts UFD's 19 frames when it whiffs", () => {
    expect(framesIn(run(duel("mario", "fox", 80, false), 40, press(Btn.Attack)).states, "attack")).toBe(19);
  });

  it.each(MODES)("on Fox %s: holds frame 2 for 13 frames, ends on 19 + 12 = 31, and Fox moves 13 frames after the hit", (_mode, oneOnOne) => {
    const { states, events } = run(duel("mario", "fox", 10, oneOnOne), 60, press(Btn.Attack));
    const hit = events.findIndex((e) => e.hits.length > 0);
    // Game frame 2, UFD's startup.
    expect(hit + 1).toBe(2);
    expect(states[hit].fighters.map((f) => f.hitlag)).toEqual([N - 1, N - 1]);
    // Mario stands on his frame 2 for the hit's frame and 12 more.
    const onFrame2 = states.filter((s) => s.fighters[0].action === "attack" && moveFrameOf(s.fighters[0].actionFrame) === 2).length;
    expect(onFrame2).toBe(N);
    expect(framesIn(states, "attack")).toBe(19 + N - 1);
    // Fox's launch fires on the freeze's last frame and moves him on the next.
    const x = states[hit].fighters[1].x;
    expect(states.findIndex((s, i) => i > hit && s.fighters[1].x !== x)).toBe(hit + N);
  });
});

describe("Pikachu's down throw against UltimateFrameData's 29 / 51, in 1v1 and out of it", () => {
  // The frame-14 box: 3%, hitlag ×1.2, fresh ⌊(3.15 × 0.65 + 6) × 1.2⌋ = 9; the
  // release's ATTACK_ABS: 5%, ×1.0, fresh ⌊5.25 × 0.65 + 6⌋ = 9. One-on-one they
  // would be 10 and 10 if the multiplier counted.
  it("freezes 9 for the frame-14 box and 9 for the release, where their 1v1 damage would freeze 10 and 10", () => {
    const partial = mul(fx(3), STALE_FRESH_BONUS);
    const release = mul(fx(5), STALE_FRESH_BONUS);
    expect([computeHitlag(partial, { moveMultiplier: fx(1.2) }), computeHitlag(release)]).toEqual([9, 9]);
    expect([computeHitlag(mul(partial, fx(1.2)), { moveMultiplier: fx(1.2) }), computeHitlag(mul(release, fx(1.2)))]).toEqual([10, 10]);
  });

  it.each(MODES)("%s: the release on 29 and 51 frames in all, Fox's knockback 9 frames after the release", (_mode, oneOnOne) => {
    const { states, events } = run(holding("pikachu", oneOnOne), 90, press(Btn.Down));
    // Frame 14 (game frame 14): both freeze 9 frames counting it, nothing reported.
    const partial = states.findIndex((s) => moveFrameOf(s.fighters[0].actionFrame) === 14);
    expect(partial + 1).toBe(14);
    expect(states[partial].fighters.map((f) => f.hitlag)).toEqual([8, 8]);
    expect(events[partial].hits).toEqual([]);
    // The release: the script's 21, 8 frames later in the game.
    const release = events.findIndex((e) => e.hits.length > 0);
    expect(release + 1).toBe(29);
    expect(moveFrameOf(states[release].fighters[0].actionFrame)).toBe(21);
    expect(states[release].fighters.map((f) => f.hitlag)).toEqual([0, 8]);
    // Interruptible on 52: 51 frames in the throw.
    expect(framesIn(states, "throw")).toBe(51);
    // "Knockback to start on frame 30": frames 21 to 29 of the throw's own count frozen.
    const x = states[release].fighters[1].x;
    expect(states.findIndex((s, i) => i > release && s.fighters[1].x !== x) - release).toBe(9);
  });
});

describe("pummels against SmashWiki \"Pummel\": coded frames and hitlag, less the frame they share", () => {
  /** The frames the captor spends pummelling once, and the pummel's freeze. */
  function pummel(id: string, oneOnOne: boolean): { frames: number; n: number; coded: number } {
    const { states, events } = run(holding(id, oneOnOne), 60, press(Btn.Attack));
    const hit = events.findIndex((e) => e.hits.length > 0);
    return { frames: framesIn(states, "pummel"), n: states[hit].fighters[0].hitlag + 1, coded: GAME.fighter(id).moves.pummel!.totalFrames };
  }

  // Six of the eight. UFD agrees on five of these; it lists Link at 18 ("Total frames
  // includes 13 frames of hitlag"), SmashWiki at 19. UFD's hitlag notes cannot settle
  // n against n − 1: they say 14 for Mario and Samus and 13 for Marth and Link, on
  // the same 1.3% ×2.1.
  it.each([
    ["mario", 19],
    ["link", 19],
    ["samus", 19],
    ["kirby", 15],
    ["fox", 15],
    ["marth", 19],
  ] as const)("%s's lasts %i, in 1v1 and out of it", (id, total) => {
    for (const [, oneOnOne] of MODES) {
      const p = pummel(id, oneOnOne);
      expect(p.frames, `${id}, 1v1 ${oneOnOne}`).toBe(total);
      expect(p.frames).toBe(p.coded + p.n - 1);
    }
  });

  // The two that are not, each one frame over, neither for the freeze's count:
  // - Donkey Kong: UNVERIFIED, the sources disagree. SmashWiki "Donkey Kong
  //   (SSBU)/Pummel" gives interruptible 8 and ×2.3 on 1.6%: 7 coded frames
  //   (`totalFrames`) and a fresh ⌊(1.68 × 0.65 + 6) × 2.3⌋ = 16 make 7 + 16 − 1 =
  //   22 under the convention the other six match. SmashWiki "Pummel"'s table and
  //   UFD give 21. No source gives him a 6-frame pummel.
  // - Pikachu: not an engine fault. Its freeze is the published formula's, d with
  //   "Stale/fresh damage ... factored" (SmashWiki "Hitlag"): fresh (×1.05),
  //   ⌊(1.05 × 0.65 + 6) × 1.3 × 1.5⌋ = 13, so 5 + 13 − 1 = 17. The published 16
  //   (18 before 2.0.0, SmashWiki "Pummel") is the base-damage figure: SmashWiki
  //   "Pikachu (SSBU)/Pummel", 2.0.0 "Pummel deals less hitlag (14 frames → 12)",
  //   ⌊(1 × 0.65 + 6) × 1.3 × 1.5⌋ = 12; the freshness bonus is ignored where frame
  //   data is measured (SmashWiki "Stale Moves").
  it("Donkey Kong's lasts 22 and Pikachu's 17, a frame over the published 21 and 16", () => {
    expect(pummel("donkeyKong", false)).toEqual({ frames: 22, n: 16, coded: 7 });
    expect(pummel("pikachu", false)).toEqual({ frames: 17, n: 13, coded: 5 });
    expect(computeHitlag(fx(1), { moveMultiplier: fx(1.3), electric: true })).toBe(12);
  });
});

describe("the frame advantage on a shield is UltimateFrameData's, whatever the freeze", () => {
  // Both fighters freeze alike, so the freeze moves neither's first free frame
  // against the other's (UFD: shield lag "does not affect frame advantage"). UFD's
  // advantage is the shield stun less the frames after the hit: 3 − (19 − 2) = −14
  // for Mario's jab 1. Each side is timed by its first actionable frame:
  // - the attacker's is the frame its move hands off (`handOff`), the first frame it
  //   is out of `attack`;
  // - the defender's is the frame after `shieldStun` ends: a status entered on
  //   contact ends through `endStatus` on its *last* frame, and the fighter acts on
  //   the next (`states.ts`). His shield stun of 3 holds him 3 frames after the
  //   freeze, as UFD's "stuck after Shield Lag ends" counts.
  it.each([
    { name: "Mario's jab 1", id: "mario", keys: Btn.Attack, gap: 10, hitFrame: 2, stun: 3, ufd: -14 },
    { name: "Fox's jab 1", id: "fox", keys: Btn.Attack, gap: 10, hitFrame: 2, stun: 3, ufd: -12 },
    { name: "Mario's forward tilt", id: "mario", keys: Btn.Right | Btn.Soft | Btn.Attack, gap: 12, hitFrame: 5, stun: 7, ufd: -13 },
    { name: "Marth's jab 1, close", id: "marth", keys: Btn.Attack, gap: 14, hitFrame: 5, stun: 4, ufd: -16 },
  ] as const)("$name: UFD's $ufd", ({ id, keys, gap, hitFrame, stun, ufd }) => {
    const { states, events } = run(duel(id, "fox", gap, false), 80, press(keys, 10), () => Btn.Shield);
    const hit = events.findIndex((e) => e.shieldHits.length > 0);
    expect(moveFrameOf(states[hit].fighters[0].actionFrame)).toBe(hitFrame);
    expect(states[hit].fighters[1].hitstun).toBe(stun);
    const attackerActs = states.findIndex((s, i) => i > hit && s.fighters[0].action !== "attack");
    const stunEnds = states.findIndex((s, i) => i > hit && s.fighters[1].action !== "shieldStun");
    const defenderActs = stunEnds + 1;
    expect(defenderActs - attackerActs).toBe(ufd);
  });
});
