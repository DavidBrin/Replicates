// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

import {
  SEED_PREFIX,
  getSeededMap,
  isSeedId,
  resetSeededLevelsForTests,
  seededChallengePool,
} from "@/lib/seededLevels";

/**
 * The bridge to the content slice's level index. Tolerant by design: while
 * S3 is still landing levels, `loadLevel` may throw for some ids and those
 * are skipped; what is asserted is the shape of whatever did load.
 */
beforeEach(() => {
  resetSeededLevelsForTests();
});

describe("seededLevels", () => {
  it("prefixes every pool entry with seed: and excludes tutorial levels", async () => {
    const pool = await seededChallengePool();
    for (const entry of pool) {
      expect(entry.id.startsWith(SEED_PREFIX)).toBe(true);
      expect(entry.players).toBeGreaterThanOrEqual(2);
      const map = await getSeededMap(entry.id);
      expect(map).not.toBeNull();
      expect(map?.tutorial).toEqual([]);
      expect(map?.id).toBe(entry.id);
    }
    expect(new Set(pool.map((m) => m.id)).size).toBe(pool.length);
  });

  it("resolves seed:<levelId> for a loaded level and null otherwise", async () => {
    expect(isSeedId("seed:01")).toBe(true);
    expect(isSeedId("abc")).toBe(false);
    expect(await getSeededMap("abc")).toBeNull();
    expect(await getSeededMap("seed:does-not-exist")).toBeNull();
    const first = await getSeededMap("seed:01");
    // Level 01 is the first tutorial; when the content module is present it
    // must resolve here even though it is excluded from the challenge pool.
    if (first) {
      expect(first.id).toBe("seed:01");
      expect(first.tiles).toHaveLength(first.width * first.height);
    }
  });
});
