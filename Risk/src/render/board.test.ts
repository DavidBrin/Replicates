/**
 * T11's board half: the layer order, the per-owner `data-owner` mapping, the
 * §8 filter chains, and the promise that a capture is one attribute write.
 */
import { describe, expect, it, vi } from "vitest";

import { TINY4, TINY4_FILE } from "@/game/__fixtures__/tiny4";
import { toMapDef } from "@/game/mapLoader";
import type { MapDef } from "@/engine/types";

import { BOARD_CSS, boardDefs, createBoard, type BoardPaint } from "./board";
import { PLAYER_COLOURS } from "./palette";

function blank(map: MapDef = TINY4): BoardPaint {
  return {
    owners: map.territories.map(() => "none"),
    states: map.territories.map(() => "idle"),
    rings: [],
    blizzards: [],
  };
}

describe("board — hit-testing (D109, the locked-units bug)", () => {
  it("the continent-ring and route layers take no pointer events", () => {
    const { svg } = createBoard(TINY4);
    expect(svg.querySelector('[data-layer="rings"]')?.getAttribute("pointer-events")).toBe("none");
    expect(svg.querySelector('[data-layer="routes"]')?.getAttribute("pointer-events")).toBe("none");
    expect(BOARD_CSS).toMatch(/\.continent-rings[^}]*pointer-events: none/);
    expect(BOARD_CSS).toMatch(/\.routes[^}]*pointer-events: none/);
  });

  it("a ring path is drawn above the territories, which is why it must not intercept", () => {
    const board = createBoard(TINY4);
    board.paint({ ...blank(), rings: [{ continent: 0, colour: "var(--c-0)" }] });
    const ring = board.svg.querySelector("path.continent-ring");
    expect(ring).not.toBeNull();
    const layers = Array.from(board.svg.children).map((c) => c.getAttribute("data-layer"));
    expect(layers.indexOf("rings")).toBeGreaterThan(layers.indexOf("territories"));
  });
});

describe("board — the Continent Overlay's fills (D109)", () => {
  it("replaces the owner fill with the continent accent, and clears it again", () => {
    const board = createBoard(TINY4);
    const fills = TINY4.territories.map(() => "var(--c-0)");
    board.paint({ ...blank(), continentFills: fills });
    expect(board.pathFor(0)?.style.fill).toBe("var(--c-0)");
    board.paint(blank());
    expect(board.pathFor(0)?.style.fill).toBe("");
  });
});

describe("board — structure", () => {
  it("builds <defs> and then §8's eight layers, in order", () => {
    const { svg } = createBoard(TINY4);
    const children = Array.from(svg.children);
    expect(children[0]?.tagName).toBe("defs");
    expect(children.slice(1).map((c) => c.getAttribute("data-layer"))).toEqual([
      "ocean",
      "net",
      "coast",
      "wall",
      "territories",
      "rings",
      "routes",
      "vignette",
    ]);
    expect(children).toHaveLength(9);
  });

  it("paints a flat ocean rect and never a gradient", () => {
    const { svg } = createBoard(TINY4);
    const ocean = svg.querySelector('[data-layer="ocean"]');
    expect(ocean?.tagName).toBe("rect");
    expect(ocean?.getAttribute("fill")).toBeNull();
    expect(BOARD_CSS).toContain(".risk-board .ocean { fill: var(--ocean); }");
    // The net is a pattern, not a gradient, and the vignette is the only radial.
    expect(svg.querySelector('[data-layer="net"]')?.getAttribute("fill")).toBeNull();
    expect(svg.querySelectorAll("linearGradient")).toHaveLength(0);
    expect(svg.querySelectorAll("radialGradient")).toHaveLength(1);
  });

  it("gives every territory one path with its own d, in index order", () => {
    const { svg, pathFor } = createBoard(TINY4);
    const paths = svg.querySelectorAll<SVGPathElement>("path.territory");
    expect(paths).toHaveLength(TINY4.territories.length);
    TINY4.territories.forEach((territory, index) => {
      const path = paths[index];
      expect(path?.getAttribute("data-territory")).toBe(String(index));
      expect(path?.getAttribute("d")).toBe(territory.d);
      expect(pathFor(index)).toBe(path);
    });
    expect(pathFor(99)).toBeNull();
  });

  it("concatenates every d into one land-union path, used by coast and wall", () => {
    const { svg } = createBoard(TINY4);
    const union = TINY4.territories.map((t) => t.d).join(" ");
    const coast = svg.querySelector('[data-layer="coast"]');
    const wall = svg.querySelector('[data-layer="wall"]');
    expect(coast?.getAttribute("d")).toBe(union);
    expect(wall?.getAttribute("d")).toBe(union);
    expect(coast?.getAttribute("filter")).toBe("url(#coast)");
    // §8 step 4: the same union again, seven units down — the fake slab.
    expect(wall?.getAttribute("transform")).toBe("translate(0,7)");
  });

  it("puts the territories under the relief filter and the vignette out of the way", () => {
    const { svg } = createBoard(TINY4);
    expect(svg.querySelector("g.territories")?.getAttribute("filter")).toBe("url(#relief)");
    const vignette = svg.querySelector('[data-layer="vignette"]');
    expect(vignette?.getAttribute("fill")).toBe("url(#vignette)");
    expect(vignette?.getAttribute("pointer-events")).toBe("none");
  });

  it("honours a non-zero viewBox origin", () => {
    const shifted = toMapDef({ ...TINY4_FILE, viewBox: "0 8 1024 643" });
    const { svg } = createBoard(shifted);
    expect(svg.getAttribute("viewBox")).toBe("0 8 1024 643");
    expect(svg.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
    // The ocean, net and vignette all cover the box as authored, origin included.
    for (const layer of ["ocean", "net", "vignette"]) {
      const node = svg.querySelector(`[data-layer="${layer}"]`);
      expect(node?.getAttribute("y")).toBe("8");
      expect(node?.getAttribute("height")).toBe("643");
    }
  });

  it("draws each seaLinked pair exactly once, with a node at both ends", () => {
    const { svg } = createBoard(TINY4);
    const routes = svg.querySelectorAll("path.route");
    // TINY4 has one sea link (alpha↔delta) listed on both territories.
    expect(routes).toHaveLength(1);
    expect(routes[0]?.getAttribute("data-route")).toBe("0-3");
    expect(svg.querySelectorAll("circle.route-node")).toHaveLength(2);
    expect(BOARD_CSS).toContain("stroke-dasharray: 14 12");
    expect(BOARD_CSS).toContain("stroke-linecap: round");
    expect(BOARD_CSS).toContain("stroke-width: 4");
  });
});

describe("board — defs", () => {
  const defs = boardDefs(TINY4);

  it("carries §8's coastal halo chain", () => {
    expect(defs).toContain('<feGaussianBlur in="SourceAlpha" stdDeviation="14" result="coastBlur"/>');
    expect(defs).toContain('flood-color="#7FE3FF"');
    expect(defs).toContain('flood-opacity=".75"');
    expect(defs).toContain('<feComposite in="coastGlow" in2="coastBlur" operator="in"/>');
  });

  it("carries §8's relief chain — highlight, mirror shadow, merge", () => {
    for (const fragment of [
      '<feOffset in="SourceAlpha" dy="-3" result="hiOffset"/>',
      '<feGaussianBlur in="hiOffset" stdDeviation="3" result="hiBlur"/>',
      '<feComposite in="hiBlur" in2="SourceAlpha" operator="out" result="hiMask"/>',
      '<feFlood flood-color="#fff" flood-opacity=".30" result="hiFlood"/>',
      '<feOffset in="SourceAlpha" dy="4" result="loOffset"/>',
      '<feGaussianBlur in="loOffset" stdDeviation="4" result="loBlur"/>',
      '<feFlood flood-color="#000" flood-opacity=".42" result="loFlood"/>',
      '<feMergeNode in="SourceGraphic"/>',
      '<feMergeNode in="highlight"/>',
      '<feMergeNode in="shadow"/>',
    ]) {
      expect(defs).toContain(fragment);
    }
  });

  it("tiles the line net at 600 px with 1 px --ocean-line strokes", () => {
    expect(defs).toContain('<pattern id="net" width="600" height="600"');
    const lines = defs.match(/<line class="net-line"/g) ?? [];
    expect(lines.length).toBeGreaterThanOrEqual(6);
    expect(BOARD_CSS).toContain(".risk-board .net-line { stroke: var(--ocean-line); stroke-width: 1;");
    // Deterministic: two builds of the same map must be byte-identical.
    expect(boardDefs(TINY4)).toBe(defs);
  });

  it("anchors the vignette on the map's own centre, origin honoured", () => {
    const shifted = boardDefs(toMapDef({ ...TINY4_FILE, viewBox: "100 8 400 300" }));
    expect(shifted).toContain('cx="300" cy="158"');
    expect(shifted).toContain('<stop offset=".55" stop-color="#02161E" stop-opacity="0"/>');
    expect(shifted).toContain('<stop offset="1" stop-color="#02161E" stop-opacity=".85"/>');
  });
});

describe("board — owners and paint", () => {
  it("emits a --p / --p-dark / --p-hot rule for all nine colours plus the three sentinels", () => {
    for (const colour of PLAYER_COLOURS) {
      expect(BOARD_CSS).toContain(
        `.territory[data-owner="${colour}"] { --p: var(--p-${colour}); ` +
          `--p-dark: var(--p-${colour}-dark); --p-hot: var(--p-${colour}-hot); }`,
      );
    }
    for (const sentinel of ["none", "neutral", "unknown"]) {
      expect(BOARD_CSS).toContain(`.territory[data-owner="${sentinel}"]`);
    }
    expect(BOARD_CSS).toContain("--p-dark: var(--land-neutral);");
    expect(BOARD_CSS).toContain("transition: fill 240ms ease-out");
  });

  it("writes every data-owner value the engine can produce", () => {
    const board = createBoard(TINY4);
    const keys = [...PLAYER_COLOURS, "none", "neutral", "unknown"];
    for (const key of keys) {
      board.paint({ ...blank(), owners: TINY4.territories.map(() => key) });
      for (let i = 0; i < TINY4.territories.length; i += 1) {
        expect(board.pathFor(i)?.getAttribute("data-owner")).toBe(key);
      }
    }
  });

  it("paints only what changed — a capture is one attribute write", () => {
    const board = createBoard(TINY4);
    const start = blank();
    board.paint(start);

    const spies = TINY4.territories.map((_, i) =>
      vi.spyOn(board.pathFor(i) as SVGPathElement, "setAttribute"),
    );
    // Same paint again: nothing moved, so nothing is written.
    board.paint({ ...start });
    expect(spies.flatMap((s) => s.mock.calls)).toEqual([]);

    // One capture: one `data-owner` write on one path, and nothing else.
    const owners = [...start.owners];
    owners[1] = "red";
    board.paint({ ...start, owners });
    expect(spies.flatMap((s) => s.mock.calls)).toEqual([["data-owner", "red"]]);

    // Selecting it as well: one further write, on the same path.
    const states = [...start.states];
    states[1] = "selected";
    board.paint({ ...start, owners, states });
    expect(spies[1]?.mock.calls).toEqual([
      ["data-owner", "red"],
      ["data-state", "selected"],
    ]);
  });

  it("hatches a blizzard tile and takes it out of hit-testing", () => {
    const board = createBoard(TINY4);
    board.paint({ ...blank(), blizzards: [2] });
    expect(board.pathFor(2)?.getAttribute("data-blizzard")).toBe("1");
    expect(board.pathFor(0)?.hasAttribute("data-blizzard")).toBe(false);
    const overlay = board.svg.querySelector('path.overlay[data-overlay="2"]');
    expect(overlay?.getAttribute("fill")).toBe("url(#blizzard)");
    expect(BOARD_CSS).toContain('.territory[data-blizzard="1"] { pointer-events: none;');

    // Thawed again: the attribute goes, the overlay is parked rather than rebuilt.
    board.paint(blank());
    expect(board.pathFor(2)?.hasAttribute("data-blizzard")).toBe(false);
    expect(overlay?.getAttribute("display")).toBe("none");
  });

  it("overlays the colour-vision pattern, and lets the blizzard hatch win", () => {
    const board = createBoard(TINY4);
    board.paint({
      ...blank(),
      blizzards: [0],
      patterns: ["cv-dots", "cv-diagonal", null, "cv-cross"],
    });
    const fill = (i: number) =>
      board.svg.querySelector(`path.overlay[data-overlay="${i}"]`)?.getAttribute("fill");
    expect(fill(0)).toBe("url(#blizzard)");
    expect(fill(1)).toBe("url(#cv-diagonal)");
    expect(fill(3)).toBe("url(#cv-cross)");
    expect(board.svg.querySelector('path.overlay[data-overlay="2"]')).toBeNull();
  });

  it("rings a held continent with its accent, and only rebuilds when the set changes", () => {
    const board = createBoard(TINY4);
    board.paint({ ...blank(), rings: [{ continent: 0, colour: "var(--c-na)" }] });
    const rings = board.svg.querySelector("g.continent-rings");
    const first = rings?.firstElementChild as SVGPathElement | null;
    expect(rings?.children).toHaveLength(1);
    expect(first?.getAttribute("data-continent")).toBe("0");
    expect(first?.getAttribute("filter")).toBe("url(#ring)");
    expect(first?.style.fill).toBe("var(--c-na)");
    expect(first?.getAttribute("d")).toBe(TINY4.territories.map((t) => t.d).join(" "));

    board.paint({ ...blank(), rings: [{ continent: 0, colour: "var(--c-na)" }] });
    expect(rings?.firstElementChild).toBe(first);

    board.paint(blank());
    expect(rings?.children).toHaveLength(0);
  });

  it("destroy detaches the board and empties it", () => {
    const board = createBoard(TINY4);
    document.body.appendChild(board.svg);
    expect(document.querySelector("svg.risk-board")).toBe(board.svg);
    board.destroy();
    expect(document.querySelector("svg.risk-board")).toBeNull();
    expect(board.svg.children).toHaveLength(0);
    expect(board.pathFor(0)).toBeNull();
  });
});
