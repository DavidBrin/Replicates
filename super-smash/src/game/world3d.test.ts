import { afterEach, describe, expect, it, vi } from "vitest";

import { getStageOrThrow, bootstrapEngine } from "./bootstrap";
import { readBakeFromDisk } from "./bakeNode";
import { FIGHTERS } from "@/fighters";
import { withLimbScripts } from "@/fighters/acmd/limb";
import { MODEL_TIMEOUT_MS, type LoadedModel, type ModelCache } from "@/render3d/models/loader";
import type { GLLike } from "@/render3d/renderer3d";
import { createWorld, followSize, preloadModels, sharedModels, withModelWait } from "./world3d";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const bake = readBakeFromDisk();
const gameDef = (id: string) => withLimbScripts(FIGHTERS.find((f) => f.id === id)!, bake.bones);

function fakeGL(canvas: HTMLCanvasElement): GLLike {
  return {
    domElement: canvas,
    info: { render: { calls: 0, triangles: 0 } },
    setPixelRatio: () => {},
    setSize: () => {},
    setClearColor: () => {},
    render: () => {},
    dispose: () => {},
  };
}

function layers() {
  return { gl: document.createElement("canvas"), background: document.createElement("canvas") };
}

/** An index listing `ids`, as `pnpm models` writes it. */
function indexOf(ids: readonly string[]) {
  return { schema: 1, models: Object.fromEntries(ids.map((id) => [id, { file: `${id}.0123abcd.glb`, bytes: 10, sha256: "00" }])) };
}

/** Whether `p` has settled, without waiting for it. */
function watch(p: Promise<unknown>): { readonly settled: boolean } {
  const state = { settled: false };
  void p.then(() => (state.settled = true));
  return state;
}

describe("the page's model cache", () => {
  it("preloads the lobby's fighters into the cache the match will use, and never throws", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await preloadModels(["mario", "fox"]);
    expect(fetchMock).toHaveBeenCalledWith("/models/index.json", { cache: "no-cache" });
    expect(sharedModels().status()).toEqual({ mario: "standIn", fox: "standIn" });
  });

  /**
   * DISPATCH-NOTES carry (Task 16 review): `MODEL_TIMEOUT_MS` bounds each request,
   * the index and then the glb, so a model's worst case is twice it. The local
   * gate waits that out, and always opens: the fighter plays as a stand-in.
   */
  it("opens a local match's gate by twice the per-request timeout, however slowly the models come", async () => {
    vi.useFakeTimers();
    bootstrapEngine();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url === "/models/index.json"
          ? // The index just inside its own timeout; then the glb never comes.
            new Promise((resolve) => setTimeout(() => resolve(new Response(JSON.stringify(indexOf(["link", "samus"])))), MODEL_TIMEOUT_MS - 1))
          : new Promise(() => {}),
      ),
    );
    const world = createWorld(layers(), getStageOrThrow("battlefield"), [gameDef("link"), gameDef("samus")], bake, { makeGL: fakeGL });
    const ready = watch(world.ready);
    await vi.advanceTimersByTimeAsync(2 * MODEL_TIMEOUT_MS - 2);
    expect(ready.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(ready.settled).toBe(true);
    expect(world.info().fighters).toEqual(["standIn", "standIn"]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/drawing link as a stand-in — link\.0123abcd\.glb: download timed out/));
    world.dispose();
  });

  /**
   * Ruling R3(a): online, a match waits for its models at most
   * `modelWaitMs`, then plays whoever is not in as a stand-in, so the peer that
   * loaded first is never left stalled long enough for its link monitor to call
   * the match lost. The download carries on into the shared cache, for the next
   * match; this one keeps its stand-in.
   */
  it("caps an online match's wait for models, and plays the late ones as stand-ins", async () => {
    vi.useFakeTimers();
    bootstrapEngine();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        url === "/models/index.json" ? Promise.resolve(new Response(JSON.stringify(indexOf(["pikachu", "kirby"])))) : new Promise(() => {}),
      ),
    );
    const world = createWorld(layers(), getStageOrThrow("battlefield"), [gameDef("pikachu"), gameDef("kirby")], bake, {
      modelWaitMs: 5_000,
      makeGL: fakeGL,
    });
    const ready = watch(world.ready);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(ready.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(ready.settled).toBe(true);
    expect(world.info().fighters).toEqual(["standIn", "standIn"]);
    expect(warn).toHaveBeenCalledWith("David-Smash: drawing pikachu as a stand-in — not loaded within 5000 ms (online)");
    // The shared cache is still fetching it for the next match.
    expect(sharedModels().status().pikachu).toBe("loading");
    world.dispose();
    // Let the cache's own timeouts run out, so nothing is left pending for the next test.
    await vi.advanceTimersByTimeAsync(MODEL_TIMEOUT_MS);
  });
});

describe("a model wait", () => {
  const glb = { kind: "glb", scene: {} } as unknown as LoadedModel;

  function cacheOf(get: (id: string) => Promise<LoadedModel>): ModelCache {
    return { get, preload: async () => {}, status: () => ({}) };
  }

  it("passes a model through that arrives in time, and warns of nothing", async () => {
    vi.useFakeTimers();
    const warn = vi.fn();
    const capped = withModelWait(cacheOf(() => new Promise((r) => setTimeout(() => r(glb), 4_999))), 5_000, warn);
    const got = capped.get("mario");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await got).toBe(glb);
    expect(warn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is a stand-in, for this match, once the wait is over", async () => {
    vi.useFakeTimers();
    const warn = vi.fn();
    const capped = withModelWait(cacheOf(() => new Promise(() => {})), 5_000, warn);
    const got = capped.get("fox");
    const state = watch(got);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await got).toEqual({ kind: "standIn", reason: "not loaded within 5000 ms (online)" });
    expect(warn).toHaveBeenCalledWith("David-Smash: drawing fox as a stand-in — not loaded within 5000 ms (online)");
  });
});

describe("the 3D layer's buffer follows its canvas", () => {
  it("sizes the buffer now, on every resize and on a change of display, and stops when asked", () => {
    let resized: (() => void) | null = null;
    const observer = { observe: vi.fn(), disconnect: vi.fn() };
    vi.stubGlobal(
      "ResizeObserver",
      vi.fn(function (this: unknown, cb: () => void) {
        resized = cb;
        return observer;
      }),
    );
    const queries: { listeners: Set<() => void> }[] = [];
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => {
        const listeners = new Set<() => void>();
        queries.push({ listeners });
        return { addEventListener: (_: string, l: () => void) => listeners.add(l), removeEventListener: (_: string, l: () => void) => listeners.delete(l) };
      }),
    );
    vi.stubGlobal("devicePixelRatio", 2);
    const canvas = document.createElement("canvas");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ width: 1280, height: 720 } as DOMRect);
    const presenter = { resize: vi.fn() };
    const stop = followSize(canvas, presenter);
    expect(presenter.resize).toHaveBeenLastCalledWith(1280, 720, 2);
    expect(observer.observe).toHaveBeenCalledWith(canvas);
    resized!();
    expect(presenter.resize).toHaveBeenCalledTimes(2);
    // Dragged to another display: the DPR query fires, and a fresh one is watched.
    vi.stubGlobal("devicePixelRatio", 1);
    for (const l of [...queries[0].listeners]) l();
    expect(presenter.resize).toHaveBeenLastCalledWith(1280, 720, 1);
    expect(queries[0].listeners.size).toBe(0);
    expect(queries[1].listeners.size).toBe(1);
    stop();
    expect(observer.disconnect).toHaveBeenCalled();
    expect(queries[1].listeners.size).toBe(0);
  });
});
