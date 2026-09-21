import { describe, expect, it } from "vitest";

import type { Progress } from "@/ports/localProgress";

import { MAX_STARS, furthestUnlocked, hasStar, isUnlocked, starsFor, totalStars } from "./campaign";

function progress(levels: Progress["levels"]): Progress {
  return { levels, challengeMedals: {}, deviceId: "test" };
}

describe("campaign progression", () => {
  it("level 01 is always unlocked, nothing else on a fresh device", () => {
    const p = progress({});
    expect(isUnlocked(p, "01")).toBe(true);
    expect(isUnlocked(p, "02")).toBe(false);
    expect(isUnlocked(p, "12")).toBe(false);
    expect(isUnlocked(p, "nope")).toBe(false);
    expect(furthestUnlocked(p)).toBe("01");
    expect(totalStars(p)).toBe(0);
    expect(MAX_STARS).toBe(36);
  });

  it("a star on N unlocks N+1 only", () => {
    const p = progress({ "01": { starsWon: ["easy"], bestTurns: { easy: 9 } } });
    expect(isUnlocked(p, "02")).toBe(true);
    expect(isUnlocked(p, "03")).toBe(false);
    expect(furthestUnlocked(p)).toBe("02");
  });

  it("counts one star per difficulty, ignoring duplicates and unknown values", () => {
    const p = progress({
      "03": { starsWon: ["easy", "hard", "easy", "bogus" as never], bestTurns: {} },
      "05": { starsWon: ["normal"], bestTurns: {} },
    });
    expect(starsFor(p, "03")).toBe(2);
    expect(hasStar(p, "03", "easy")).toBe(true);
    expect(hasStar(p, "03", "normal")).toBe(false);
    expect(starsFor(p, "05")).toBe(1);
    expect(totalStars(p)).toBe(3);
  });

  it("a gap in progress stops the unlock chain", () => {
    const p = progress({
      "01": { starsWon: ["easy"], bestTurns: {} },
      "03": { starsWon: ["easy"], bestTurns: {} },
    });
    expect(isUnlocked(p, "02")).toBe(true);
    expect(isUnlocked(p, "03")).toBe(false);
    expect(isUnlocked(p, "04")).toBe(true); // 03 has a star (edge case: unlock is pairwise)
    expect(furthestUnlocked(p)).toBe("02");
  });
});
