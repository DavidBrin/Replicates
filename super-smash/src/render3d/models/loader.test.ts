import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { Group } from "three";

import {
  MODEL_INDEX_URL,
  MODEL_TIMEOUT_MS,
  createModelCache,
  parseModelIndex,
  verifyModelBytes,
  type ModelSource,
} from "./loader";

// The decoder is mocked: these tests never decode a glb, and never read one. What they pin is
// that nothing reaches the decoder, not even its import, before the bytes are checked.
const decoder = vi.hoisted(() => ({
  parseAsync: vi.fn(),
  setMeshoptDecoder: vi.fn(),
  meshopt: { synthetic: true },
  /** How many times each decoder module's factory ran, i.e. how many times the module was evaluated. */
  evaluated: { gltfLoader: 0, meshopt: 0 },
}));
const GLTF_LOADER = "three/examples/jsm/loaders/GLTFLoader.js";
const MESHOPT = "three/examples/jsm/libs/meshopt_decoder.module.js";

/** A fresh copy of the loader whose two decoder modules count their own evaluation. */
async function freshLoader(): Promise<typeof import("./loader")> {
  vi.resetModules();
  decoder.evaluated.gltfLoader = 0;
  decoder.evaluated.meshopt = 0;
  vi.doMock(GLTF_LOADER, () => {
    decoder.evaluated.gltfLoader++;
    return {
      GLTFLoader: class {
        setMeshoptDecoder(d: unknown) {
          decoder.setMeshoptDecoder(d);
          return this;
        }
        parseAsync(bytes: ArrayBuffer, path: string) {
          return decoder.parseAsync(bytes, path);
        }
      },
    };
  });
  vi.doMock(MESHOPT, () => {
    decoder.evaluated.meshopt++;
    return { MeshoptDecoder: decoder.meshopt };
  });
  return import("./loader");
}

const INDEX = { schema: 1, models: { mario: { file: "mario.0123abcd.glb", bytes: 1, sha256: "x" } } } as const;

function source(over: Partial<ModelSource> = {}): ModelSource {
  return { index: async () => parseModelIndex(INDEX), load: async () => new Group(), ...over };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.doUnmock(GLTF_LOADER);
  vi.doUnmock(MESHOPT);
  vi.clearAllMocks();
});

describe("loading fighter models (never fatal)", () => {
  it("loads a listed model once and shares it", async () => {
    const load = vi.fn(async () => new Group());
    const cache = createModelCache(source({ load }), () => {});
    const [a, b] = await Promise.all([cache.get("mario"), cache.get("mario")]);
    expect(a.kind).toBe("glb");
    expect(a).toBe(b);
    expect(load).toHaveBeenCalledOnce();
    expect(cache.status()).toEqual({ mario: "glb" });
  });

  it("stands a fighter in when the index is missing — a checkout that never ran pnpm models", async () => {
    const warn = vi.fn();
    const cache = createModelCache(source({ index: async () => null }), warn);
    expect(await cache.get("mario")).toEqual({ kind: "standIn", reason: "no model index (run pnpm models)" });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("pnpm models"));
  });

  it("stands a fighter in when its glb is corrupt or 404s, and the others still load", async () => {
    const cache = createModelCache(
      source({
        index: async () => parseModelIndex({ schema: 1, models: { ...INDEX.models, fox: { file: "fox.89abcdef.glb", bytes: 1, sha256: "y" } } }),
        load: async (entry) => {
          if (entry.file.startsWith("fox")) throw new Error("Unexpected token in glTF JSON");
          return new Group();
        },
      }),
      () => {},
    );
    expect((await cache.get("fox")).kind).toBe("standIn");
    expect((await cache.get("mario")).kind).toBe("glb");
  });

  it("gives up on a hung download and starts with the stand-in", async () => {
    vi.useFakeTimers();
    const cache = createModelCache(source({ load: () => new Promise(() => {}) }), () => {}, 1000);
    const got = cache.get("mario");
    await vi.advanceTimersByTimeAsync(1001);
    expect((await got).kind).toBe("standIn");
  });

  it("tries a failed model again next match instead of standing it in for the rest of the page", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("network error")).mockResolvedValue(new Group());
    const index = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(parseModelIndex(INDEX));
    const cache = createModelCache(source({ load, index }), () => {});
    expect((await cache.get("mario")).kind).toBe("standIn"); // index unreachable
    expect((await cache.get("mario")).kind).toBe("standIn"); // index back, glb fails
    expect((await cache.get("mario")).kind).toBe("glb"); // third match: loaded
    expect(await cache.get("mario")).toBe(await cache.get("mario")); // and kept
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("preloads a lobby's fighters so the match starts with them", async () => {
    const load = vi.fn(async () => new Group());
    const cache = createModelCache(source({ load }), () => {});
    await cache.preload(["mario", "mario"]);
    expect(load).toHaveBeenCalledOnce();
    expect(cache.status()).toEqual({ mario: "glb" });
  });

  it("refuses an index whose file names could reach outside /models/", () => {
    expect(parseModelIndex({ schema: 1, models: { mario: { file: "../secrets.glb", bytes: 1, sha256: "" } } })).toBeNull();
    expect(parseModelIndex({ schema: 2, models: {} })).toBeNull();
  });

  it("stands a fighter in when the index request itself throws, says why, and asks for the index again next time", async () => {
    const warn = vi.fn();
    const index = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue(parseModelIndex(INDEX));
    const cache = createModelCache(source({ index }), warn);
    expect(await cache.get("mario")).toEqual({ kind: "standIn", reason: "model index: Failed to fetch" });
    expect(warn).toHaveBeenCalledWith("David-Smash: drawing mario as a stand-in — model index: Failed to fetch");
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("pnpm models")); // the hint is for a missing index only
    expect((await cache.get("mario")).kind).toBe("glb");
    expect(index).toHaveBeenCalledTimes(2);
  });

  it("does not let a stalled index request hang every get and preload", async () => {
    vi.useFakeTimers();
    const index = vi.fn().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue(parseModelIndex(INDEX));
    const cache = createModelCache(source({ index }), () => {});
    const got = cache.get("mario");
    const fox = cache.get("fox"); // shares the one pending request
    const preloaded = cache.preload(["mario", "fox"]);
    await vi.advanceTimersByTimeAsync(MODEL_TIMEOUT_MS - 1);
    expect(cache.status()).toEqual({ mario: "loading", fox: "loading" });
    await vi.advanceTimersByTimeAsync(1);
    expect(await got).toEqual({ kind: "standIn", reason: "model index: request timed out after 20000 ms" });
    expect((await fox).kind).toBe("standIn");
    await expect(preloaded).resolves.toBeUndefined();
    expect(index).toHaveBeenCalledOnce();
    expect((await cache.get("mario")).kind).toBe("glb"); // the next match asks for the index again
    expect(index).toHaveBeenCalledTimes(2);
  });

  it("asks for the index again after a load fails, so a deploy that renamed the glbs is picked up", async () => {
    const stale = { schema: 1, models: { mario: { file: "mario.0123abcd.glb", bytes: 1, sha256: "x" } } };
    const fresh = { schema: 1, models: { mario: { file: "mario.89abcdef.glb", bytes: 1, sha256: "y" } } };
    const index = vi.fn().mockResolvedValueOnce(parseModelIndex(stale)).mockResolvedValue(parseModelIndex(fresh));
    const load = vi.fn(async (entry: { file: string }) => {
      if (entry.file === "mario.0123abcd.glb") throw new Error("HTTP 404"); // the old file is gone
      return new Group();
    });
    const cache = createModelCache(source({ index, load }), () => {});
    expect((await cache.get("mario")).kind).toBe("standIn"); // this match: the index in memory is out of date
    expect((await cache.get("mario")).kind).toBe("glb"); // next match: re-read, and the new name loads
    expect(index).toHaveBeenCalledTimes(2);
    expect(load.mock.calls.map(([e]) => e.file)).toEqual(["mario.0123abcd.glb", "mario.89abcdef.glb"]);
    expect((await cache.get("mario")).kind).toBe("glb");
    expect(index).toHaveBeenCalledTimes(2); // and a good index is kept
  });

  it("stands in an id that is only a property of every object, without fetching anything", async () => {
    const load = vi.fn(async () => new Group());
    const cache = createModelCache(source({ load }), () => {});
    for (const id of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(await cache.get(id), id).toEqual({ kind: "standIn", reason: "not in the model index" });
    }
    expect(load).not.toHaveBeenCalled();
    expect(Object.keys(cache.status())).toEqual(["constructor", "__proto__", "toString", "hasOwnProperty"]);
  });

  it("does not let an index() that throws instead of rejecting make preload reject", async () => {
    const warn = vi.fn();
    const cache = createModelCache(
      source({
        index: () => {
          throw new Error("not async");
        },
      }),
      warn,
    );
    await expect(cache.preload(["mario"])).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("David-Smash: drawing mario as a stand-in — model index: not async");
  });

  it("discards what a timed-out load delivers late: it stays a stand-in and the next get loads again", async () => {
    vi.useFakeTimers();
    let deliver: (g: Group) => void = () => {};
    const lateScene = new Group();
    const nextScene = new Group();
    const load = vi
      .fn()
      .mockImplementationOnce(() => new Promise<Group>((r) => (deliver = r)))
      .mockResolvedValue(nextScene);
    const cache = createModelCache(source({ load }), () => {}, 1000);
    const first = cache.get("mario");
    await vi.advanceTimersByTimeAsync(1001);
    expect((await first).kind).toBe("standIn");
    deliver(lateScene); // the download finally lands
    await vi.advanceTimersByTimeAsync(0);
    expect(cache.status()).toEqual({ mario: "standIn" });
    const next = await cache.get("mario");
    expect(next).toEqual({ kind: "glb", scene: nextScene });
    expect(next.kind === "glb" && next.scene).not.toBe(lateScene);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("stands in a fighter the index does not list, for this match only, at the price of a lookup", async () => {
    const warn = vi.fn();
    const index = vi.fn(async () => parseModelIndex(INDEX));
    const cache = createModelCache(source({ index }), warn);
    expect(await cache.get("fox")).toEqual({ kind: "standIn", reason: "not in the model index" });
    expect(warn).toHaveBeenCalledWith("David-Smash: drawing fox as a stand-in — not in the model index");
    expect(cache.status()).toEqual({ fox: "standIn" });
    expect((await cache.get("fox")).kind).toBe("standIn");
    expect(index).toHaveBeenCalledOnce(); // a listed index is kept; only the lookup repeats
  });

  it("says why a model failed, naming its file", async () => {
    const warn = vi.fn();
    const cache = createModelCache(source({ load: async () => Promise.reject(new Error("HTTP 404")) }), warn);
    expect(await cache.get("mario")).toEqual({ kind: "standIn", reason: "mario.0123abcd.glb: HTTP 404" });
    expect(warn).toHaveBeenCalledWith("David-Smash: drawing mario as a stand-in — mario.0123abcd.glb: HTTP 404");
  });

  it("reports a model as loading until it settles", async () => {
    let finish: (g: Group) => void = () => {};
    const load = vi.fn(() => new Promise<Group>((r) => (finish = r)));
    const cache = createModelCache(source({ load }), () => {});
    const got = cache.get("mario");
    expect(cache.status()).toEqual({ mario: "loading" });
    await vi.waitFor(() => expect(load).toHaveBeenCalled()); // the index answers first
    expect(cache.status()).toEqual({ mario: "loading" });
    finish(new Group());
    expect((await got).kind).toBe("glb");
    expect(cache.status()).toEqual({ mario: "glb" });
  });

  it("preload settles even when a fighter fails: a lobby never waits on a rejection", async () => {
    const cache = createModelCache(source({ load: async () => Promise.reject(new Error("boom")) }), () => {});
    await expect(cache.preload(["mario", "fox"])).resolves.toBeUndefined();
    expect(cache.status()).toEqual({ mario: "standIn", fox: "standIn" });
  });

  it("waits 20 s by default, then forgets the hung model so the next match asks again", async () => {
    expect(MODEL_TIMEOUT_MS).toBe(20_000);
    vi.useFakeTimers();
    const load = vi.fn().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue(new Group());
    const cache = createModelCache(source({ load }), () => {});
    const first = cache.get("mario");
    await vi.advanceTimersByTimeAsync(MODEL_TIMEOUT_MS - 1);
    expect(cache.status()).toEqual({ mario: "loading" });
    await vi.advanceTimersByTimeAsync(1);
    expect(await first).toEqual({ kind: "standIn", reason: "mario.0123abcd.glb: download timed out after 20000 ms" });
    expect((await cache.get("mario")).kind).toBe("glb");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("leaves no timer behind once a model has loaded", async () => {
    vi.useFakeTimers();
    const cache = createModelCache(source(), () => {});
    await cache.get("mario");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("the model index the pipeline writes", () => {
  // The shape `scripts/models/build.mjs` writes into public/models/index.json: each entry also
  // records the SHA-256 of the skeleton file its glb was built against (null for a spike build).
  // The values are synthetic; no real index or glb is read.
  const pipelineIndex = {
    schema: 1,
    models: {
      donkeyKong: { file: "donkeyKong.8a8fcec5.glb", bytes: 322152, sha256: "8".repeat(64), skeleton: "6".repeat(64) },
      mario: { file: "mario.ce77996e.glb", bytes: 150280, sha256: "c".repeat(64), skeleton: null },
    },
  };

  it("accepts it, extra fields and all", () => {
    const index = parseModelIndex(pipelineIndex);
    expect(index?.models.donkeyKong).toMatchObject({ file: "donkeyKong.8a8fcec5.glb", bytes: 322152 });
    expect(Object.keys(index?.models ?? {})).toEqual(["donkeyKong", "mario"]);
  });

  it("accepts only <id>.<8 lowercase hex>.glb", () => {
    const named = (file: string) => parseModelIndex({ schema: 1, models: { a: { file, bytes: 1, sha256: "" } } });
    expect(named("mario.ce77996e.glb")).not.toBeNull();
    for (const bad of [
      "mario.glb",
      "mario.ce77996.glb",
      "mario.ce77996ef.glb",
      "mario.CE77996E.glb",
      "mario.ce77996e.gltf",
      "mario.ce77996e.glb.html",
      "mario.zzzzzzzz.glb", // 8 characters, none of them hex
      "mario.ce77996g.glb",
      "mario.ce77996e.glb\n", // `$` must not match before a trailing newline
      "sub/mario.ce77996e.glb",
      "..%2fmario.ce77996e.glb",
      "/mario.ce77996e.glb",
      ".ce77996e.glb",
      "",
    ]) {
      expect(named(bad), bad).toBeNull();
    }
  });

  it("refuses anything that is not an index", () => {
    for (const bad of [null, undefined, 3, "models", [], { schema: 1 }, { schema: 1, models: null }, { models: {} }, { schema: "1", models: {} }]) {
      expect(parseModelIndex(bad), String(JSON.stringify(bad))).toBeNull();
    }
    expect(parseModelIndex({ schema: 1, models: {} })).toEqual({ schema: 1, models: {} });
  });

  it("refuses an entry the loader could not check a download against", () => {
    const entry = (e: unknown) => parseModelIndex({ schema: 1, models: { mario: e } });
    const ok = { file: "mario.ce77996e.glb", bytes: 1, sha256: "x" };
    expect(entry(ok)).not.toBeNull();
    for (const bad of [null, 5, "mario.ce77996e.glb", { ...ok, bytes: "1" }, { ...ok, bytes: -1 }, { ...ok, bytes: 1.5 }, { ...ok, bytes: Number.NaN }, { ...ok, sha256: 7 }, { file: ok.file }]) {
      expect(entry(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("checking a downloaded glb against its index entry", () => {
  const bytes = new TextEncoder().encode("glTF fake body").buffer;
  const entry = { file: "mario.0123abcd.glb", bytes: bytes.byteLength, sha256: createHash("sha256").update(new Uint8Array(bytes)).digest("hex") };

  it("passes the bytes the index names", async () => {
    await expect(verifyModelBytes(bytes, entry)).resolves.toBeUndefined();
  });

  it("refuses a truncated or stale file before the decoder sees it", async () => {
    await expect(verifyModelBytes(bytes.slice(0, 4), entry)).rejects.toThrow(/4 bytes, index says 14/);
    await expect(verifyModelBytes(bytes, { ...entry, sha256: "0".repeat(64) })).rejects.toThrow(/SHA-256 does not match/);
  });

  it("words both refusals exactly", async () => {
    await expect(verifyModelBytes(bytes.slice(0, 4), entry)).rejects.toThrow(new Error("mario.0123abcd.glb: 4 bytes, index says 14"));
    await expect(verifyModelBytes(bytes, { ...entry, sha256: "0".repeat(64) })).rejects.toThrow(
      new Error("mario.0123abcd.glb: SHA-256 does not match the model index"),
    );
  });

  it("refuses same-length different bytes (a stale copy) by hash, and checks length first", async () => {
    const stale = new TextEncoder().encode("glTF fake bodY").buffer;
    expect(stale.byteLength).toBe(entry.bytes);
    await expect(verifyModelBytes(stale, entry)).rejects.toThrow(/SHA-256 does not match/);
    // Wrong length and wrong hash: the cheaper check speaks, and the digest is never needed.
    await expect(verifyModelBytes(stale.slice(0, 3), { ...entry, sha256: "0".repeat(64) })).rejects.toThrow(/3 bytes, index says 14/);
  });

  it("does not read a hash printed in another case as a match", async () => {
    await expect(verifyModelBytes(bytes, { ...entry, sha256: entry.sha256.toUpperCase() })).rejects.toThrow(/SHA-256 does not match/);
  });

  it("fails closed where the page cannot hash (no crypto.subtle outside https or localhost), never on length alone", async () => {
    vi.stubGlobal("crypto", {});
    await expect(verifyModelBytes(bytes, entry)).rejects.toThrow(
      new Error("mario.0123abcd.glb: cannot verify it: SHA-256 needs a secure context (https or localhost)"),
    );
    vi.stubGlobal("crypto", undefined);
    await expect(verifyModelBytes(bytes, entry)).rejects.toThrow(/needs a secure context/);
  });
});

describe("the browser source", () => {
  const body = new TextEncoder().encode("glTF fake body").buffer;
  const entry = { file: "mario.0123abcd.glb", bytes: body.byteLength, sha256: createHash("sha256").update(new Uint8Array(body)).digest("hex") };
  // Workers' `404-page` answers a missing /models/* file with 404 and the site's HTML 404 page.
  const notFoundPage = () => new Response("<!DOCTYPE html><html><body>404: This page could not be found.</body></html>", { status: 404, headers: { "content-type": "text/html" } });
  const fetchOf = (respond: (url: string, init?: RequestInit) => Response | Promise<Response>) =>
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => respond(String(url), init)) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
  const decoderNeverSeen = () => {
    expect(decoder.parseAsync).not.toHaveBeenCalled();
    expect(decoder.evaluated).toEqual({ gltfLoader: 0, meshopt: 0 }); // not even imported
  };

  describe("index()", () => {
    it("fetches /models/index.json without trusting a cached copy, and parses it", async () => {
      const { browserModelSource } = await freshLoader();
      const f = fetchOf(() => Response.json(INDEX));
      const index = await browserModelSource(f).index();
      expect(index?.models.mario.file).toBe("mario.0123abcd.glb");
      expect(f).toHaveBeenCalledWith(MODEL_INDEX_URL, { cache: "no-cache" });
      expect(MODEL_INDEX_URL).toBe("/models/index.json");
    });

    it("answers null for a 404 whose body is an HTML page, without parsing it", async () => {
      const { browserModelSource } = await freshLoader();
      const page = notFoundPage();
      const json = vi.spyOn(page, "json");
      expect(await browserModelSource(fetchOf(() => page)).index()).toBeNull();
      expect(json).not.toHaveBeenCalled();
    });

    it("rejects, naming the cause, for any other failure to read an index", async () => {
      const { browserModelSource } = await freshLoader();
      const src = (r: () => Response | Promise<Response>) => browserModelSource(fetchOf(r));
      await expect(src(() => new Response("Service Unavailable", { status: 503 })).index()).rejects.toThrow(new Error("HTTP 503"));
      await expect(src(() => new Response("<!DOCTYPE html><html></html>", { status: 200 })).index()).rejects.toThrow(SyntaxError);
      await expect(src(() => Response.json({ schema: 2, models: {} })).index()).rejects.toThrow(/not a schema 1 model index/);
      await expect(src(() => Response.json({ schema: 1, models: { a: { file: "../x.glb", bytes: 1, sha256: "" } } })).index()).rejects.toThrow(
        /not a schema 1 model index/,
      );
      await expect(src(() => Promise.reject(new TypeError("Failed to fetch"))).index()).rejects.toThrow(new TypeError("Failed to fetch"));
    });
  });

  describe("why a fighter is a stand-in, as the console says it", () => {
    const why = async (respond: () => Response | Promise<Response>) => {
      const { browserModelSource, createModelCache: cacheOf } = await freshLoader();
      const warn = vi.fn();
      const got = await cacheOf(browserModelSource(fetchOf(respond)), warn).get("mario");
      expect(warn).toHaveBeenCalledOnce();
      return { got, line: warn.mock.calls[0][0] as string };
    };

    it("keeps the run-pnpm-models hint for a missing index only", async () => {
      const { got, line } = await why(notFoundPage);
      expect(got).toEqual({ kind: "standIn", reason: "no model index (run pnpm models)" });
      expect(line).toContain("pnpm models");
    });

    it.each([
      ["a thrown fetch", () => Promise.reject(new TypeError("Failed to fetch")), "model index: Failed to fetch"],
      ["a server error", () => new Response("oops", { status: 503 }), "model index: HTTP 503"],
      ["bad JSON", () => new Response("<!DOCTYPE html><html></html>", { status: 200 }), /^model index: .*JSON/],
      ["a bad schema", () => Response.json({ schema: 2, models: {} }), "model index: not a schema 1 model index (files named <id>.<8 hex>.glb)"],
    ] as const)("says the real cause of %s, without the hint", async (_name, respond, reason) => {
      const { got, line } = await why(respond);
      expect(got.kind).toBe("standIn");
      expect(got.kind === "standIn" && got.reason).toMatch(typeof reason === "string" ? new RegExp(`^${reason.replace(/[.*+?^${}()|[\]\\<>]/g, "\\$&")}$`) : reason);
      expect(line).not.toContain("pnpm models");
      expect(line).toContain("model index: ");
    });
  });

  describe("load()", () => {
    const glb = { scene: new Group() };

    it("fetches /models/<file>, verifies, then decodes with meshopt and the models folder as the base path", async () => {
      const { browserModelSource } = await freshLoader();
      decoder.parseAsync.mockResolvedValue(glb);
      const f = fetchOf(() => new Response(body.slice(0), { status: 200 }));
      const scene = await browserModelSource(f).load(entry);
      expect(scene).toBe(glb.scene);
      expect(f).toHaveBeenCalledWith("/models/mario.0123abcd.glb");
      expect(decoder.evaluated).toEqual({ gltfLoader: 1, meshopt: 1 });
      expect(decoder.setMeshoptDecoder).toHaveBeenCalledWith(decoder.meshopt);
      expect(decoder.parseAsync).toHaveBeenCalledOnce();
      const [decoded, path] = decoder.parseAsync.mock.calls[0] as [ArrayBuffer, string];
      expect(new Uint8Array(decoded)).toEqual(new Uint8Array(body));
      expect(path).toBe("/models/");
    });

    it("treats a 404 with an HTML body as a missing model: no bytes read, nothing decoded", async () => {
      const { browserModelSource } = await freshLoader();
      const page = notFoundPage();
      const read = vi.spyOn(page, "arrayBuffer");
      await expect(browserModelSource(fetchOf(() => page)).load(entry)).rejects.toThrow(new Error("HTTP 404"));
      expect(read).not.toHaveBeenCalled();
      decoderNeverSeen();
    });

    it("refuses an HTML page served with a 200 (a single-page fallback) before the decoder sees it", async () => {
      const { browserModelSource } = await freshLoader();
      const f = fetchOf(() => new Response("<!DOCTYPE html><html><body>app shell</body></html>", { status: 200, headers: { "content-type": "text/html" } }));
      await expect(browserModelSource(f).load(entry)).rejects.toThrow(/bytes, index says 14/);
      decoderNeverSeen();
    });

    it("refuses a truncated download before the decoder sees it", async () => {
      const { browserModelSource } = await freshLoader();
      const f = fetchOf(() => new Response(body.slice(0, 4), { status: 200 }));
      await expect(browserModelSource(f).load(entry)).rejects.toThrow(new Error("mario.0123abcd.glb: 4 bytes, index says 14"));
      decoderNeverSeen();
    });

    it("refuses a stale copy of the right length before the decoder sees it", async () => {
      const { browserModelSource } = await freshLoader();
      const f = fetchOf(() => new Response(new TextEncoder().encode("glTF fake bodY"), { status: 200 }));
      await expect(browserModelSource(f).load(entry)).rejects.toThrow(new Error("mario.0123abcd.glb: SHA-256 does not match the model index"));
      decoderNeverSeen();
    });

    it("refuses a body it cannot hash (an insecure page) before the decoder sees it", async () => {
      const { browserModelSource } = await freshLoader();
      vi.stubGlobal("crypto", {});
      const f = fetchOf(() => new Response(body.slice(0), { status: 200 }));
      await expect(browserModelSource(f).load(entry)).rejects.toThrow(/cannot verify it: SHA-256 needs a secure context/);
      decoderNeverSeen();
    });

    it("lets a fetch that rejects through, and the decoder is never touched", async () => {
      const { browserModelSource } = await freshLoader();
      await expect(browserModelSource(fetchOf(() => Promise.reject(new TypeError("Failed to fetch")))).load(entry)).rejects.toThrow(
        new TypeError("Failed to fetch"),
      );
      decoderNeverSeen();
    });

    it("lets a body that fails mid-stream through, and the decoder is never touched", async () => {
      const { browserModelSource } = await freshLoader();
      const cut = () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(new Uint8Array(body, 0, 4));
              c.error(new TypeError("network error"));
            },
          }),
          { status: 200 },
        );
      await expect(browserModelSource(fetchOf(cut)).load(entry)).rejects.toThrow(/network error/);
      decoderNeverSeen();
    });

    it("stands a fighter in, with the reason, for a fetch or a body that fails", async () => {
      const { browserModelSource, createModelCache: cacheOf } = await freshLoader();
      const listed = Response.json({ schema: 1, models: { mario: entry } });
      const f = fetchOf((url) => (url === MODEL_INDEX_URL ? listed.clone() : Promise.reject(new TypeError("Failed to fetch"))));
      expect(await cacheOf(browserModelSource(f), () => {}).get("mario")).toEqual({ kind: "standIn", reason: "mario.0123abcd.glb: Failed to fetch" });
      decoderNeverSeen();
    });

    it("lets a decoder failure reject, and the cache stands the fighter in with its reason", async () => {
      const { browserModelSource, createModelCache: cacheOf } = await freshLoader();
      decoder.parseAsync.mockRejectedValue(new Error("Unexpected token in glTF JSON"));
      const f = fetchOf((url) => (url === MODEL_INDEX_URL ? Response.json({ schema: 1, models: { mario: entry } }) : new Response(body.slice(0), { status: 200 })));
      const cache = cacheOf(browserModelSource(f), () => {});
      expect(await cache.get("mario")).toEqual({ kind: "standIn", reason: "mario.0123abcd.glb: Unexpected token in glTF JSON" });
    });

    it("end to end: a model the server never shipped is a stand-in with the HTTP status, and a shipped one is drawn", async () => {
      const { browserModelSource, createModelCache: cacheOf } = await freshLoader();
      decoder.parseAsync.mockResolvedValue(glb);
      const f = fetchOf((url) => {
        if (url === MODEL_INDEX_URL) {
          return Response.json({ schema: 1, models: { mario: entry, fox: { file: "fox.89abcdef.glb", bytes: 1, sha256: "y" } } });
        }
        return url === "/models/mario.0123abcd.glb" ? new Response(body.slice(0), { status: 200 }) : notFoundPage();
      });
      const cache = cacheOf(browserModelSource(f), () => {});
      expect(await cache.get("fox")).toEqual({ kind: "standIn", reason: "fox.89abcdef.glb: HTTP 404" });
      expect(await cache.get("mario")).toEqual({ kind: "glb", scene: glb.scene });
      expect(cache.status()).toEqual({ fox: "standIn", mario: "glb" });
    });
  });
});

describe("keeping three.js out of the initial bundle", () => {
  /** The module specifiers a source file pulls in at load time: every import or re-export that is not `import type`/`export type`. */
  const valueImports = (src: string): string[] =>
    [...src.matchAll(/^(?:import|export)\s+(?!type\b)(?:[\w*{}\s,$]+?\s+from\s+)?"([^"]+)"/gm)].map((m) => m[1]);

  it("sees every static form that would load three.js up front", () => {
    expect(valueImports('import { Group } from "three";')).toEqual(["three"]);
    expect(valueImports('import * as THREE from "three";')).toEqual(["three"]);
    expect(valueImports('import THREE, { Group } from "three";')).toEqual(["three"]);
    expect(valueImports('import "three/examples/jsm/loaders/GLTFLoader.js";')).toEqual(["three/examples/jsm/loaders/GLTFLoader.js"]);
    expect(valueImports('export * from "three";')).toEqual(["three"]);
    expect(valueImports('export * as T from "three";')).toEqual(["three"]);
    expect(valueImports('export { Group } from "three";')).toEqual(["three"]);
    expect(valueImports('import {\n  Group,\n  Mesh,\n} from "three";')).toEqual(["three"]);
    expect(valueImports('import type { Object3D } from "three";\nexport type { Group } from "three";')).toEqual([]);
    expect(valueImports('export const a = 1;\nexport function f() { return import("three"); }')).toEqual([]);
  });

  it("imports three for types only and loads the glTF loader and meshopt decoder dynamically", () => {
    const src = readFileSync(join(process.cwd(), "src", "render3d", "models", "loader.ts"), "utf8");
    expect(valueImports(src)).toEqual([]);
    expect(src).toMatch(/^import type \{ Object3D \} from "three";$/m);
    expect(src).toContain('import("three/examples/jsm/loaders/GLTFLoader.js")');
    expect(src).toContain('import("three/examples/jsm/libs/meshopt_decoder.module.js")');
  });
});
