import { describe, expect, it } from "vitest";

import { runScript } from "@/engine/acmd/interpreter";
import type { AcmdScript } from "@/engine/acmd/types";
import { REFERENCE_SCRIPTS } from "./index";

/** How far to run a script looking for windows; longer than any move here. */
const HORIZON = 300;

/**
 * Our interpreter's windows for a script: "id:first-last", last −1 when still
 * open at the horizon. A slot issued again — new arguments, or the same ones
 * after a clear on the same frame (a multihit loop) — starts a new window, as
 * the calculator lists it.
 */
function windows(s: AcmdScript): string[] {
  const out: string[] = [];
  const open = new Map<number, number>();
  for (let g = 1; g <= HORIZON; g++) {
    const st = runScript(s, g);
    const live = new Set(st.attacks.map((a) => a.id));
    const issued = new Set(st.fired.flatMap((c) => (c.op === "attack" ? [c.params.id] : [])));
    for (const [id, from] of [...open]) {
      if (live.has(id) && !issued.has(id)) continue;
      out.push(`${id}:${from}-${g - 1}`);
      open.delete(id);
    }
    for (const id of live) if (!open.has(id)) open.set(id, g);
  }
  for (const [id, from] of open) out.push(`${id}:${from}--1`);
  return out.sort();
}

/**
 * Where the calculator reads a script differently from us, and why we keep
 * ours. Each was checked against Ultimate Frame Data (ultimateframedata.com):
 * - mario game_specialhi: the dump holds two copies of the move behind a
 *   costume flag; we take the first, frame 3 (UFD: Super Jump Punch 3), the
 *   calculator the second, which starts on 1.
 * - fox game_attackhi3: `ATK_POWER` weakens a live hitbox on frame 6; the
 *   calculator splits it into 3–4 and 6–7 and drops frame 5. UFD: 3—5(6—7).
 * - fox game_attack100: a decompiler `wait_loop_clear` the calculator reads as
 *   a zero-length window.
 * - pikachu game_throwlw, game_final: zero-length windows on the calculator's
 *   side (EndFrame before StartFrame).
 * Anything new here is a parser regression or a data change: look before
 * adding it.
 */
const KNOWN_DISAGREEMENTS: readonly string[] = [
  "fox game_attack100",
  "fox game_attackhi3",
  "mario game_specialhi",
  "pikachu game_final",
  "pikachu game_throwlw",
];

describe("the ACMD importer reads scripts as the calculator does", () => {
  it("agrees on every hitbox window except the documented few", () => {
    const disagree: string[] = [];
    let compared = 0;
    for (const ref of Object.values(REFERENCE_SCRIPTS)) {
      for (const [key, calc] of Object.entries(ref.calculatorWindows)) {
        compared += 1;
        const theirs = calc.map(([id, a, b]) => `${id}:${a}-${b}`).sort();
        const ours = windows(ref.scripts[key]);
        const missing = theirs.filter((w) => !ours.includes(w));
        const extra = ours.filter((w) => !theirs.includes(w));
        if (missing.length > 0 || extra.length > 0) disagree.push(`${ref.fighter} ${key}`);
      }
    }
    expect(compared).toBeGreaterThan(100);
    expect(disagree.sort()).toEqual([...KNOWN_DISAGREEMENTS].sort());
  });
});

// Plan 3, Task 18 (carried from Plan 2 Task 16): the parser used to stop at the decompiler's
// duplicate and drop the `clear_all` both copies share, so the imported Super Jump Punch kept
// its launcher live to the horizon. Ultimate Frame Data: active 3-6/7-16/17-18
// (https://ultimateframedata.com/mario, Super Jump Punch).
describe("Mario's imported up special", () => {
  const upB = REFERENCE_SCRIPTS.mario.scripts.game_specialhi;

  it("is live from frame 3 to frame 18, and clears its boxes after", () => {
    const live = Array.from({ length: 40 }, (_, i) => i + 1).filter((g) => runScript(upB, g).attacks.length > 0);
    expect(live[0]).toBe(3);
    expect(live.at(-1)).toBe(18);
    expect(runScript(upB, HORIZON).attacks).toEqual([]);
  });
});
