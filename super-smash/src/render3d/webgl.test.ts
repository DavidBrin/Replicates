import { afterEach, describe, expect, it, vi } from "vitest";

import { NO_WEBGL as RENDERER_NO_WEBGL } from "./renderer3d";
import { NO_WEBGL, canDrawWebGL, webglCheck } from "./webgl";

/** A stand-in for a canvas's `getContext`: a context for the kinds named (with `WEBGL_lose_context` or not), null for any other. */
function contexts(kinds: readonly string[], opts: { loseContext?: () => void; lose?: boolean } = {}) {
  const extension = opts.lose === false ? null : { loseContext: opts.loseContext ?? (() => {}) };
  const gl = { getExtension: (name: string) => (name === "WEBGL_lose_context" ? extension : null) };
  return vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((kind: string) => (kinds.includes(kind) ? gl : null)) as never);
}

describe("webglCheck: whether the 3D world can be drawn, asked on a scratch canvas before anything needs it", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is true when a canvas gives a WebGL 2 context, the kind three.js draws with, and lets that context go at once", () => {
    const loseContext = vi.fn();
    const getContext = contexts(["webgl2"], { loseContext });
    expect(webglCheck()()).toBe(true);
    expect(getContext).toHaveBeenCalledWith("webgl2");
    // Browsers cap a page's live WebGL contexts: the scratch one is given back, not left for the collector.
    expect(loseContext).toHaveBeenCalledOnce();
  });

  it("is false when there is none: WebGL off, blocked or missing", () => {
    contexts([]);
    expect(webglCheck()()).toBe(false);
  });

  it("is false with only WebGL 1, which three.js no longer draws with (r163 on)", () => {
    contexts(["webgl", "experimental-webgl"]);
    expect(webglCheck()()).toBe(false);
  });

  it("is false when asking throws", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
      throw new Error("blocked by policy");
    });
    expect(webglCheck()()).toBe(false);
  });

  // codex confirm pass, P3: asked on every Create and Join, a check without WEBGL_lose_context used up one of the
  // page's capped contexts each time (with a cap of two: true, true, false). One check asks the browser once.
  it.each([
    ["with WEBGL_lose_context", true],
    ["without it", false],
  ])("asks the browser once however often it is asked, %s: one canvas, one context", (_how, lose) => {
    const getContext = contexts(["webgl2"], { lose });
    const createElement = vi.spyOn(document, "createElement");
    const check = webglCheck();
    for (let i = 0; i < 5; i++) expect(check()).toBe(true);
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(createElement.mock.calls.filter(([tag]) => tag === "canvas")).toHaveLength(1);
  });

  it("remembers a no as well: a browser that refused is not asked again by the same page", () => {
    const getContext = contexts([]);
    const check = webglCheck();
    for (let i = 0; i < 5; i++) expect(check()).toBe(false);
    expect(getContext).toHaveBeenCalledTimes(1);
  });

  it("is one check for the page, and refuses in the renderer's own sentence, so a lobby and a match say the same thing", () => {
    expect(typeof canDrawWebGL).toBe("function");
    expect(RENDERER_NO_WEBGL).toBe(NO_WEBGL);
  });
});
