/**
 * Plan 5, Task 21b (ruling P5-R27): the keyboard's Tilt key, from the key to
 * the move, along the path a local match takes. Config 1 is built as the
 * menus build it (`schemeForMenuId` with `DEFAULT_BINDINGS`); every tick its
 * `KeyboardInput` is drained, merged with an idle pad (`mergeKeyboardAndPad`)
 * and stepped by the real `step()`, with the real roster on Final Destination.
 *
 * Why the key exists: from `stand`, a fresh direction with Attack inside
 * `SMASH_INPUT_WINDOW` is a smash, and a held direction is a dash after
 * `DASH_THRESHOLD_FRAMES`, where Attack is a dash attack. So without the Tilt
 * key a keyboard reaches neither a standing forward tilt nor a walk. Each
 * case is played with the key, and again without it to show what it changes.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import type { FighterState, GameState, InputFrame, MatchRules } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { mergeKeyboardAndPad } from "@/input/gamepad";
import { KeyboardInput } from "@/input/keyboard";
import { DEFAULT_BINDINGS } from "@/lib/matchConfig";
import { STAGES } from "@/stages";
import { schemeForMenuId } from "./bootstrap";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: false };
const KEYS = DEFAULT_BINDINGS.arrows;

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

let live: KeyboardInput | null = null;
afterEach(() => {
  live?.detach();
  live = null;
});

/** `id` standing still on Final Destination, actionable. */
function standing(id: string): GameState {
  let s = createInitialState("finalDestination", [{ defId: id }], RULES, 7);
  for (let i = 0; i < 80; i++) s = step(s, [0], { prevInputs: [0] }).state;
  expect(s.fighters[0].action).toBe("stand");
  return s;
}

/**
 * `frames` ticks from `id` standing, on Config 1's keys. Before tick `i` the
 * keys in `presses[i]` go down, and they stay down. The fighter after each tick.
 */
function play(id: string, frames: number, presses: Readonly<Record<number, readonly string[]>>): FighterState[] {
  const kb = new KeyboardInput([{ port: 0, scheme: schemeForMenuId("arrows", KEYS) }], { window, overlayHost: null });
  kb.attach();
  live = kb;
  let s = standing(id);
  let prev: InputFrame = 0;
  const out: FighterState[] = [];
  for (let i = 0; i < frames; i++) {
    for (const code of presses[i] ?? []) window.dispatchEvent(new KeyboardEvent("keydown", { code, cancelable: true }));
    const input = mergeKeyboardAndPad(kb.drain().frames[0], 0);
    s = step(s, [input], { prevInputs: [prev] }).state;
    prev = input;
    out.push(s.fighters[0]);
  }
  kb.detach();
  live = null;
  return out;
}

const last = (frames: readonly FighterState[]): [string, string | null] => {
  const f = frames[frames.length - 1];
  return [f.action, f.move];
};

describe("the keyboard's Tilt key, from stand", () => {
  it("Tilt + Right, then Attack, is a forward tilt; without Tilt the same keys are a forward smash", () => {
    expect(last(play("mario", 2, { 0: [KEYS.tilt, KEYS.right], 1: [KEYS.attack] }))).toEqual(["attack", "ftilt"]);
    expect(last(play("mario", 2, { 0: [KEYS.right], 1: [KEYS.attack] }))).toEqual(["attack", "fsmash"]);
  });

  it("is still a forward tilt with Right held past the dash threshold; without Tilt, a dash attack", () => {
    expect(last(play("mario", 13, { 0: [KEYS.tilt, KEYS.right], 12: [KEYS.attack] }))).toEqual(["attack", "ftilt"]);
    expect(last(play("mario", 13, { 0: [KEYS.right], 12: [KEYS.attack] }))).toEqual(["attack", "dashAttack"]);
  });

  it("Tilt + Up never jumps (Task 20: a soft Up never stick-jumps), and Attack is an up tilt; without Tilt, Up jumps", () => {
    const held = play("mario", 12, { 0: [KEYS.tilt, KEYS.up] });
    expect(new Set(held.map((f) => f.action))).toEqual(new Set(["stand"]));
    expect(last(play("mario", 13, { 0: [KEYS.tilt, KEYS.up], 12: [KEYS.attack] }))).toEqual(["attack", "utilt"]);
    expect(play("mario", 12, { 0: [KEYS.up] }).map((f) => f.action)).toContain("jumpSquat");
  });

  it("Tilt + Right held walks and never dashes; without Tilt it dashes, then runs", () => {
    expect(new Set(play("mario", 40, { 0: [KEYS.tilt, KEYS.right] }).map((f) => f.action))).toEqual(new Set(["walk"]));
    // Without it, the first frames are a step (SPEC §6), then the dash commits.
    expect(new Set(play("mario", 40, { 0: [KEYS.right] }).map((f) => f.action))).toEqual(new Set(["walk", "dashStart", "run"]));
  });

  /** SPEC §6 (Task 13d, R-T13d-b/c): the Tilt key gives a side special's ordinary version, never its smash one. */
  it.each(["samus", "link"])("%s: Tilt + Right + Special is the ordinary side special; without Tilt, the smash version", (id) => {
    expect(last(play(id, 1, { 0: [KEYS.tilt, KEYS.right, KEYS.special] }))).toEqual(["special", "sideB"]);
    expect(last(play(id, 1, { 0: [KEYS.right, KEYS.special] }))).toEqual(["special", "sideBSmash"]);
  });
});
