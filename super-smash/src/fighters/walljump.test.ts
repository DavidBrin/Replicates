/**
 * Wall jumps and wall tech jumps, through the real `step()` (Plan 5, Task 10).
 *
 * SmashWiki "Wall jump" (https://www.ssbwiki.com/Wall_jump, revision 2065734 of
 * 2026-10-25): touch a wall, press away; of this roster Mario, Samus, Fox and
 * Pikachu can in Ultimate; each further one before landing is 0.96× as strong;
 * and "all characters can wall tech jump: by inputting a jump during a wall
 * tech, a wall jump is performed". SmashWiki "Tech"
 * (https://www.ssbwiki.com/Tech): "If a jump input is active when a wall tech is
 * performed (such as holding up or pressing a jump button), then the teching
 * character will wall jump."
 */

import { beforeAll, describe, expect, it } from "vitest";

import { fx } from "@/engine/fixed";
import { hashState } from "@/engine/hash";
import { kineticLaunch } from "@/engine/kinetic";
import { fighterParams } from "@/engine/params";
import { cloneState, createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { FighterDef, FighterState, GameState, InputFrame, MatchRules, MoveDef } from "@/engine/types";
import { STAGES } from "@/stages";
import { FIGHTERS } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: false };
const BY_ID = new Map(FIGHTERS.map((f) => [f.id, f]));

/**
 * Stand-in attackers for the exit tests: Fox with a jab, or a grab, whose one
 * box is large and live on frames 2-4, so it reaches a fighter at the wall below
 * the ledge. Not published moves.
 */
function standIn(id: string, slot: "jab1" | "grab", over: Partial<MoveDef["hitboxes"][number]>): FighterDef {
  const fox = BY_ID.get("fox")!;
  const move: MoveDef = {
    slot,
    name: "Stand-in",
    totalFrames: 20,
    hitboxes: [
      {
        id: 0,
        startFrame: 2,
        endFrame: 4,
        x: fx(0),
        y: fx(10),
        radius: fx(30),
        damage: fx(10),
        angle: fx(80),
        baseKnockback: fx(60),
        knockbackGrowth: fx(80),
        ...over,
      },
    ],
  };
  return {
    ...fox,
    id,
    // Fox's own script would replace the stand-in's legacy move.
    scripts: Object.fromEntries(Object.entries(fox.scripts ?? {}).filter(([s]) => s !== slot)),
    moves: { ...fox.moves, [slot]: move },
  };
}
const PUNCHER = standIn("puncher", "jab1", {});
const GRABBER = standIn("grabber", "grab", { damage: fx(0), angle: fx(0), baseKnockback: fx(0), knockbackGrowth: fx(0), grabbing: true });

beforeAll(() => {
  registerFighters([...FIGHTERS, PUNCHER, GRABBER]);
  registerStages(STAGES);
});

/** `defId` falling just off Final Destination's right side, below the ledge, against the wall. */
function besideTheWall(defId: string, over: Partial<FighterState> = {}): GameState {
  const s = createInitialState("finalDestination", [{ defId }], RULES, 3);
  Object.assign(s.fighters[0], { action: "fall", actionFrame: 0, grounded: false, platform: -1, x: fx(84), y: fx(-20), vx: 0, vy: 0, facing: -1, intangible: 0, jumpsUsed: 2, ...over });
  return s;
}

function run(s0: GameState, inputs: readonly InputFrame[]): GameState[] {
  let s = s0;
  let prev: InputFrame = 0;
  const out: GameState[] = [];
  for (const i of inputs) {
    s = step(s, [i], { prevInputs: [prev] }).state;
    prev = i;
    out.push(s);
  }
  return out;
}

/** Two ports: port 0 pressing `mine(i)`, port 1 `theirs(i)`. */
function duel(s0: GameState, frames: number, mine: (i: number) => InputFrame, theirs: (i: number) => InputFrame): GameState[] {
  let s = s0;
  let prev: readonly InputFrame[] = [0, 0];
  const out: GameState[] = [];
  for (let i = 0; i < frames; i++) {
    const now = [mine(i), theirs(i)];
    s = step(s, now, { prevInputs: prev }).state;
    prev = now;
    out.push(s);
  }
  return out;
}

const idle = (n: number): InputFrame[] => Array<InputFrame>(n).fill(0);

/** Drift into the wall (left), then flick right. */
const KICK_OFF: InputFrame[] = [...Array<InputFrame>(8).fill(Btn.Left), Btn.Right, ...idle(6)];

/** Ultimate's wall jump heights, SmashWiki "Wall jump", "Wall jump height rankings", ''Ultimate'' (revision 2065734). */
const WALL_JUMP_HEIGHT = { pikachu: 34.29, mario: 29.263, samus: 28.35, fox: 22.05 } as const;

describe("wall jumps", () => {
  for (const id of ["mario", "samus", "fox", "pikachu"]) {
    it(`${id} kicks off the wall: up and away, facing out`, () => {
      const states = run(besideTheWall(id), KICK_OFF);
      const after = states[9].fighters[0];
      expect(after.action).toBe("jump");
      expect(after.vy).toBeGreaterThan(0);
      expect(after.vx).toBeGreaterThan(0);
      expect(after.facing).toBe(1);
      // The touch is spent by the jump off it.
      expect(states[8].fighters[0].combat).toMatchObject({ wallSide: 0, wallFrames: 0, wallJumps: 1 });
    });
  }

  for (const id of ["donkeyKong", "link", "kirby", "marth"]) {
    it(`${id} cannot`, () => {
      const states = run(besideTheWall(id), KICK_OFF);
      expect(states.every((s) => s.fighters[0].combat.wallJumps === 0)).toBe(true);
    });
  }

  // The rise is measured from the kick to the top of the jump, so the fighter's
  // gravity decides it.
  for (const [id, height] of Object.entries(WALL_JUMP_HEIGHT)) {
    it(`${id} rises its published wall jump height, ${height}`, () => {
      const states = run(besideTheWall(id), [...KICK_OFF, ...idle(80)]);
      const from = states[7].fighters[0].y;
      const top = Math.max(...states.slice(8).map((s) => s.fighters[0].y));
      expect((top - from) / 4096).toBeCloseTo(height, 0);
    });
  }

  it("weakens each further wall jump before landing to 0.96×", () => {
    // On the frame of the kick.
    const first = run(besideTheWall("mario"), KICK_OFF)[8].fighters[0];
    const s = besideTheWall("mario");
    s.fighters[0].combat.wallJumps = 1;
    const second = run(s, KICK_OFF)[8].fighters[0];
    expect(second.action).toBe("jump");
    expect(second.vy / first.vy).toBeCloseTo(0.96, 2);
  });

  it("needs a fresh press: a direction already held away does not kick off", () => {
    // Carried into the wall at 2 a frame while holding right from the first frame:
    // the wall is touched, but right was pressed before it was.
    const states = run(besideTheWall("mario", { x: fx(82.5), vx: -fx(2) }), Array<InputFrame>(6).fill(Btn.Right));
    expect(states[0].fighters[0].combat.wallSide).toBe(-1);
    expect(states.every((s) => s.fighters[0].combat.wallJumps === 0)).toBe(true);
  });

  it("ends a short hop's damage penalty, as an air jump does (UNVERIFIED)", () => {
    const states = run(besideTheWall("mario", { shortHop: true }), KICK_OFF);
    expect(states[7].fighters[0].shortHop).toBe(true);
    expect(states[8].fighters[0]).toMatchObject({ action: "jump", shortHop: false });
  });

  it("needs a fresh press away: drifting away without touching the wall does nothing", () => {
    const s = besideTheWall("mario");
    s.fighters[0].x = fx(120);
    const states = run(s, KICK_OFF);
    expect(states[9].fighters[0].combat.wallJumps).toBe(0);
  });

  it("takes the press up to the 3rd frame after the last touch, not the 4th (UNVERIFIED window)", () => {
    // The last touch is the 8th frame of drifting in (index 7); nothing touches after.
    const late = (wait: number): InputFrame[] => [...Array<InputFrame>(8).fill(Btn.Left), ...idle(wait), Btn.Right, ...idle(3)];
    const third = run(besideTheWall("mario"), late(2));
    expect(third[7].fighters[0].combat.wallSide).toBe(-1);
    expect(third[10].fighters[0]).toMatchObject({ action: "jump", facing: 1 });
    const fourth = run(besideTheWall("mario"), late(3));
    expect(fourth.every((s) => s.fighters[0].combat.wallJumps === 0)).toBe(true);
  });

  it("ages a touch through a freeze too: hitlag does not hold the window open (UNVERIFIED)", () => {
    // Frozen for the 3 frames after the touch; the press on the first free frame
    // is the 4th frame after it, past the window. Unfrozen, a press a frame sooner
    // kicks off.
    const frozen = besideTheWall("mario", { hitlag: 3 });
    Object.assign(frozen.fighters[0].combat, { wallSide: -1, wallFrames: 0 });
    const states = run(frozen, [0, 0, 0, Btn.Right, 0]);
    expect(states[2].fighters[0].hitlag).toBe(0);
    expect(states.every((s) => s.fighters[0].combat.wallJumps === 0)).toBe(true);
    const free = besideTheWall("mario", { x: fx(-200), y: fx(100) });
    Object.assign(free.fighters[0].combat, { wallSide: -1, wallFrames: 0 });
    expect(run(free, [0, 0, Btn.Right])[2].fighters[0].combat.wallJumps).toBe(1);
  });

  it("is refused from special fall: helpless allows only a ledge, drift and a fast fall", () => {
    // SmashWiki "Helpless" (https://www.ssbwiki.com/Helpless): "unable to take any
    // action, with the exception of grabbing a ledge, maneuvering left/right,
    // fastfalling, or climbing a ladder". The wall is touched; nothing kicks off it.
    const s = besideTheWall("mario", { action: "specialFall" });
    s.fighters[0].combat.helplessMove = "upB";
    const states = run(s, KICK_OFF);
    expect(states.some((q) => q.fighters[0].combat.wallSide === -1)).toBe(true);
    expect(states.every((q) => q.fighters[0].action === "specialFall" && q.fighters[0].combat.wallJumps === 0)).toBe(true);
  });

  it("kicks off from a tumble's fall too (DAMAGE_FALL shares the fall's main)", () => {
    const states = run(besideTheWall("fox", { action: "tumbleFall" }), KICK_OFF);
    expect(states[8].fighters[0]).toMatchObject({ action: "jump", facing: 1 });
    expect(states[8].fighters[0].combat.wallJumps).toBe(1);
  });
});

describe("what a wall jump remembers, and what clears it", () => {
  const SET = { wallSide: -1, wallFrames: 0, wallJumps: 2 };
  const withWall = (s: GameState): GameState => {
    Object.assign(s.fighters[0].combat, SET);
    return s;
  };
  const wallOf = (f: FighterState) => ({ wallSide: f.combat.wallSide, wallFrames: f.combat.wallFrames, wallJumps: f.combat.wallJumps });
  const CLEAR = { wallSide: 0, wallFrames: 0, wallJumps: 0 };

  it("a landing clears all three (SmashWiki: \"without touching the ground\")", () => {
    const [landed] = run(withWall(besideTheWall("mario", { x: 0, y: fx(0.5), vy: -fx(1) })), [0]);
    expect(landed.fighters[0].grounded).toBe(true);
    expect(wallOf(landed.fighters[0])).toEqual(CLEAR);
  });

  it("a floor tech touches the ground too: the run of wall jumps starts again", () => {
    // The golden tech lab's Mario: tumbling onto the floor with a shield press.
    const s = createInitialState("finalDestination", [{ defId: "mario" }], RULES, 3);
    const f = s.fighters[0];
    Object.assign(f, { x: fx(-50), y: fx(6), grounded: false, platform: -1, action: "tumble", actionFrame: 0, hitstun: 60, intangible: 0, invincible: 0 });
    kineticLaunch(f, 0, -fx(2), fx(2));
    f.combat.wallJumps = 2;
    const states = run(s, [Btn.Shield, ...idle(5)]);
    const tech = states.findIndex((q) => q.fighters[0].action === "tech");
    expect(tech).toBeGreaterThanOrEqual(0);
    expect(states[tech + 1].fighters[0].combat.wallJumps).toBe(0);
  });

  it("a ledge grab clears all three", () => {
    const [hung] = run(withWall(besideTheWall("mario", { x: fx(81.5), y: fx(-1), vy: -fx(0.5) })), [0]);
    expect(hung.fighters[0].action).toBe("ledgeHang");
    expect(wallOf(hung.fighters[0])).toEqual(CLEAR);
  });

  /** Mario pressing into the wall below the right ledge, the stand-in `attacker` at the lip facing him. */
  function atTheWall(attacker: string): GameState {
    const s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: attacker }], RULES, 3);
    // At the wall already: its body stops at 81.99 (Mario's ECB), so each frame's drift in touches it.
    Object.assign(s.fighters[0], { action: "fall", actionFrame: 0, grounded: false, platform: -1, x: fx(82), y: fx(-15), vx: 0, vy: 0, facing: -1, intangible: 0, invincible: 0, jumpsUsed: 2 });
    Object.assign(s.fighters[1], { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(78), y: 0, facing: 1, intangible: 0, invincible: 0 });
    s.fighters[0].combat.wallJumps = 2;
    return s;
  }

  it("a hit forgets the wall, and keeps the count: only the ground resets it", () => {
    const states = duel(atTheWall("puncher"), 12, () => Btn.Left, (i) => (i === 3 ? Btn.Attack : 0));
    const hit = states.findIndex((q) => q.fighters[0].action === "hitstun" || q.fighters[0].action === "tumble");
    expect(hit).toBeGreaterThan(0);
    expect(states[hit - 1].fighters[0].combat.wallSide).toBe(-1);
    expect(wallOf(states[hit].fighters[0])).toEqual({ wallSide: 0, wallFrames: 0, wallJumps: 2 });
  });

  it("a grab forgets the wall, and keeps the count when held in the air", () => {
    const states = duel(atTheWall("grabber"), 12, () => Btn.Left, (i) => (i === 3 ? Btn.Grab : 0));
    const caught = states.findIndex((q) => q.fighters[0].action === "grabbed");
    expect(caught).toBeGreaterThan(0);
    expect(states[caught - 1].fighters[0].combat.wallSide).toBe(-1);
    expect(wallOf(states[caught].fighters[0])).toEqual({ wallSide: 0, wallFrames: 0, wallJumps: 2 });
  });

  it("a KO clears all three, and the respawn starts clean", () => {
    const states = run(withWall(besideTheWall("mario", { x: fx(-200), y: fx(-139), vy: -fx(2) })), idle(200));
    expect(states[0].fighters[0].action).toBe("dead");
    expect(wallOf(states[0].fighters[0])).toEqual(CLEAR);
    const back = states.findIndex((q) => q.fighters[0].action === "respawnPlatform");
    expect(back).toBeGreaterThan(0);
    expect(wallOf(states[back].fighters[0])).toEqual(CLEAR);
  });

  it("forgets a touch nothing could use any more", () => {
    // Past both windows: the wall jump's 3 frames and the wall tech jump's 5.
    const states = run(withWall(besideTheWall("mario", { x: fx(-200), y: fx(100) })), idle(7));
    expect(states[4].fighters[0].combat).toMatchObject({ wallSide: -1, wallFrames: 5 });
    expect(wallOf(states[5].fighters[0])).toEqual({ wallSide: 0, wallFrames: 0, wallJumps: 2 });
  });

  it("re-simulates identically across a rollback, before and after the kick", () => {
    const inputs = [...KICK_OFF, Btn.Left, ...Array<InputFrame>(6).fill(Btn.Left), Btn.Right, ...idle(10)];
    const live = run(besideTheWall("pikachu"), inputs);
    expect(live[8].fighters[0].combat.wallJumps).toBe(1);
    for (const at of [5, 8, 12]) {
      let replay = cloneState(live[at]);
      expect(hashState(replay)).toBe(hashState(live[at]));
      for (let i = at + 1; i < inputs.length; i++) replay = step(replay, [inputs[i]], { prevInputs: [inputs[i - 1]] }).state;
      expect(hashState(replay), `rolled back to ${at}`).toBe(hashState(live[inputs.length - 1]));
    }
  });
});

describe("wall tech jumps", () => {
  it("a jump in a wall tech's first frames launches off the wall, for anyone", () => {
    const s = besideTheWall("donkeyKong");
    Object.assign(s.fighters[0], { action: "techWall", actionFrame: 0 });
    s.fighters[0].combat.wallSide = -1;
    const states = run(s, [Btn.Jump, 0, 0]);
    expect(states[0].fighters[0].action).toBe("jump");
    expect(states[0].fighters[0].vx).toBeGreaterThan(0);
  });

  it("weakens a repeat 0.96× both ways: up, and away with no stick held", () => {
    const kick = (wallJumps: number): FighterState => {
      const s = besideTheWall("donkeyKong", { action: "techWall", actionFrame: 0 });
      Object.assign(s.fighters[0].combat, { wallSide: -1, wallJumps });
      return run(s, [Btn.Jump])[0].fighters[0];
    };
    const [first, second] = [kick(0), kick(1)];
    expect(second.combat.wallJumps).toBe(2);
    expect(second.vy / first.vy).toBeCloseTo(0.96, 2);
    expect(second.vx / first.vx).toBeCloseTo(0.96, 2);
  });

  /**
   * `defId` launched at Final Destination's right wall below the floor, tumbling,
   * with a shield press on its first frame: a wall tech, as the golden tech lab's Fox.
   */
  function intoTheWall(defId: string): GameState {
    const s = createInitialState("finalDestination", [{ defId }], RULES, 3);
    const f = s.fighters[0];
    Object.assign(f, { x: fx(100), y: fx(-20), grounded: false, platform: -1, action: "tumble", actionFrame: 0, hitstun: 60, intangible: 0, invincible: 0, jumpsUsed: 1 });
    kineticLaunch(f, -fx(4), 0, fx(4));
    return s;
  }
  /** The index of the frame the wall tech begins on. */
  function techFrame(defId: string): number {
    const states = run(intoTheWall(defId), [Btn.Shield, ...idle(12)]);
    const t = states.findIndex((q) => q.fighters[0].action === "techWall");
    expect(t).toBeGreaterThan(0);
    return t;
  }
  const pressAt = (t: number, key: InputFrame, after = 3): InputFrame[] => [Btn.Shield, ...idle(t - 1), key, ...idle(after)];

  it("takes a jump on the tech's 5th frame, not its 6th (UNVERIFIED window): then it is an air jump", () => {
    const t = techFrame("donkeyKong");
    const fifth = run(intoTheWall("donkeyKong"), pressAt(t + 5, Btn.Jump));
    expect(fifth[t + 5].fighters[0]).toMatchObject({ action: "jump", facing: 1 });
    expect(fifth[t + 5].fighters[0].combat.wallJumps).toBe(1);
    expect(fifth[t + 5].fighters[0].vx).toBeGreaterThan(0);
    const sixth = run(intoTheWall("donkeyKong"), pressAt(t + 6, Btn.Jump));
    expect(sixth[t + 6].fighters[0]).toMatchObject({ action: "jump", jumpsUsed: 2 });
    expect(sixth[t + 6].fighters[0].combat.wallJumps).toBe(0);
  });

  it("takes a jump held into the tech (\"holding up\"), and the press does not jump again from the buffer", () => {
    const t = techFrame("donkeyKong");
    // Jump pressed in the tumble (buffered there) and held through the tech.
    const states = run(intoTheWall("donkeyKong"), [Btn.Shield, ...Array<InputFrame>(t + 12).fill(Btn.Jump)]);
    expect(states[t + 1].fighters[0]).toMatchObject({ action: "jump", jumpsUsed: 1 });
    expect(states[t + 1].fighters[0].combat.wallJumps).toBe(1);
    expect(states.slice(t + 1).every((q) => q.fighters[0].jumpsUsed === 1)).toBe(true);
    // Holding up is a jump input too.
    const up = run(intoTheWall("fox"), [Btn.Shield, ...Array<InputFrame>(techFrame("fox") + 3).fill(Btn.Up)]);
    expect(up[techFrame("fox") + 1].fighters[0].combat.wallJumps).toBe(1);
  });

  it("is not intangible: Ultimate removed the wall tech jump's intangibility", () => {
    // SmashWiki "Wall jump": "the intangibility still applies when the character
    // performs a wall tech jump, although this intangibility would later be
    // removed in Ultimate".
    const t = techFrame("fox");
    const states = run(intoTheWall("fox"), pressAt(t + 2, Btn.Jump));
    expect(states[t + 1].fighters[0].intangible).toBeGreaterThan(0);
    expect(states[t + 2].fighters[0]).toMatchObject({ action: "jump", intangible: 0 });
  });

  it("rises the published wall jump height for a wall jumper, and the air jump's for the rest (UNVERIFIED)", () => {
    const rise = (id: string): number => {
      const t = techFrame(id);
      const states = run(intoTheWall(id), pressAt(t + 1, Btn.Jump, 80));
      expect(states[t + 1].fighters[0].combat.wallJumps).toBe(1);
      const top = Math.max(...states.slice(t + 1).map((q) => q.fighters[0].y));
      return (top - states[t].fighters[0].y) / 4096;
    };
    expect(rise("fox")).toBeCloseTo(WALL_JUMP_HEIGHT.fox, 0);
    expect(rise("donkeyKong")).toBeCloseTo(fighterParams(BY_ID.get("donkeyKong")!).jump_aerial_y / 4096, 0);
  });
});
