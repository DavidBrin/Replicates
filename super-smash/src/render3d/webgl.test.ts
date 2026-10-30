import { afterEach, describe, expect, it, vi } from "vitest";

import { NO_WEBGL as RENDERER_NO_WEBGL } from "./renderer3d";
import { NO_WEBGL, canDrawWebGL } from "./webgl";

/** A stand-in for a canvas's `getContext`: a context for the kinds named, null for any other. */
function contexts(kinds: readonly string[], loseContext = vi.fn()) {
  const gl = { getExtension: (name: string) => (name === "WEBGL_lose_context" ? { loseContext } : null) };
  return vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((kind: string) => (kinds.includes(kind) ? gl : null)) as never);
}

describe("canDrawWebGL: whether the 3D world can be drawn, asked on a scratch canvas before anything needs it", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is true when a canvas gives a WebGL 2 context, the kind three.js draws with, and lets that context go at once", () => {
    const loseContext = vi.fn();
    const getContext = contexts(["webgl2"], loseContext);
    expect(canDrawWebGL()).toBe(true);
    expect(getContext).toHaveBeenCalledWith("webgl2");
    // Browsers cap a page's live WebGL contexts: the scratch one is given back, not left for the collector.
    expect(loseContext).toHaveBeenCalledOnce();
  });

  it("is false when there is none: WebGL off, blocked or missing", () => {
    contexts([]);
    expect(canDrawWebGL()).toBe(false);
  });

  it("is false with only WebGL 1, which three.js no longer draws with (r163 on)", () => {
    contexts(["webgl", "experimental-webgl"]);
    expect(canDrawWebGL()).toBe(false);
  });

  it("is false when asking throws", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
      throw new Error("blocked by policy");
    });
    expect(canDrawWebGL()).toBe(false);
  });

  it("refuses in the renderer's own sentence, so a lobby and a match say the same thing", () => {
    expect(RENDERER_NO_WEBGL).toBe(NO_WEBGL);
  });
});
