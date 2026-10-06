import { describe, expect, it } from "vitest";

import { loadMap, validateMap } from "./schema";
import { generateVoronoiMap, normaliseOptions } from "./voronoi";

describe("voronoi smoke", () => {
  it("validates and reproduces for 20 seeds", () => {
    for (let i = 0; i < 20; i++) {
      const o = normaliseOptions({ territories: 19 + i * 4, continents: 4 + (i % 8) });
      const file = generateVoronoiMap(o, `seed-${i}`);
      const errs = validateMap(file);
      if (errs.length > 0) console.log(i, o.territories, errs.slice(0, 5));
      expect(errs).toEqual([]);
      expect(JSON.stringify(generateVoronoiMap(o, `seed-${i}`))).toEqual(JSON.stringify(file));
      const def = loadMap(file);
      console.log(
        `seed-${i}`, "T", file.territories.length, "C", file.continents.length,
        "edges", def.adjacency.reduce((n, r) => n + r.length, 0) / 2,
        "sea", file.seaLinks.length, "bytes", JSON.stringify(file).length,
      );
    }
  });
});
