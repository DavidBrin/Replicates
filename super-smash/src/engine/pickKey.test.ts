/**
 * The pick key (`simulate.ts`, `pickKeyOf`). A candidate competes for a victim under
 * its source's key and, within a fighter's swing, its box's part (smash-script `Part`;
 * Plan 5, Task 16 fix round 1, ruling R-T16e): the lowest id lands per part. The key
 * is built on `HITBOX_PARTS`, as the hit record's is (`hitbox.ts`), so the bound on a
 * part and both encodings stay in step (fix round 4; re-review 2's Minor 2: it was a
 * literal × 4). Here the bound is mocked to 6, and every source and part below it
 * still gets a key of its own; a literal multiplier would collide.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("./hitbox", async (importOriginal) => ({ ...(await importOriginal<typeof import("./hitbox")>()), HITBOX_PARTS: 6 }));

import { HITBOX_PARTS } from "./hitbox";
import { pickKeyOf } from "./simulate";

describe("the pick key", () => {
  it("gives every source and every part below HITBOX_PARTS a key of its own, whatever HITBOX_PARTS is", () => {
    expect(HITBOX_PARTS).toBe(6);
    // The four ports, and projectiles (`candidateKey`: 1000 + the instance id).
    const sources = [0, 1, 2, 3, 1000, 1001, 1002];
    const keys = sources.flatMap((s) => Array.from({ length: HITBOX_PARTS }, (_, p) => pickKeyOf(s, p)));
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of sources) {
      for (let p = 0; p < HITBOX_PARTS; p++) expect([Math.floor(pickKeyOf(s, p) / HITBOX_PARTS), pickKeyOf(s, p) % HITBOX_PARTS]).toEqual([s, p]);
    }
  });
});
