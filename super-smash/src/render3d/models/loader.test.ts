import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { Group } from "three";

import {
  MODEL_INDEX_URL,
  MODEL_TIMEOUT_MS,
  browserModelSource,
  createModelCache,
  parseModelIndex,
  verifyModelBytes,
  type ModelSource,
} from "./loader";

// The decoder is mocked: these tests never decode a glb, and never read one. What they pin is
// that nothing reaches the decoder before the bytes are checked.
const decoder = vi.hoisted(() => ({
  parseAsync: vi.fn(),
  setMeshoptDecoder: vi.fn(),
  meshopt: { synthetic: true },
}));
vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    setMeshoptDecoder(d: unknown) {
      decoder.setMeshoptDecoder(d);
      return this;
    }
    parseAsync(bytes: ArrayBuffer, path: string) {
      return decoder.parseAsync(bytes, path);
    }
  },
}));
vi.mock("three/examples/jsm/libs/meshopt_decoder.module.js", () => ({ MeshoptDecoder: decoder.meshopt }));

const INDEX = { schema: 1, models: { mario: { file: "mario.0123abcd.glb", bytes: 1, sha256: "x" } } } as const;

function source(over: Partial<ModelSource> = {}): ModelSource {
  return { index: async () => parseModelIndex(INDEX), load: async () => new Group(), ...over };
}

afterEach(() => {
  vi.useRealTimers();
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

  it("stands a fighter in when the index request itself throws, and asks for the index again next time", async () => {
    const index = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue(parseModelIndex(INDEX));
    const cache = createModelCache(source({ index }), () => {});
    expect(await cache.get("mario")).toEqual({ kind: "standIn", reason: "no model index (run pnpm models)" });
    expect((await cache.get("mario")).kind).toBe("glb");
    expect(index).toHaveBeenCalledTimes(2);
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
    const stood = await first;
    expect(stood.kind).toBe("standIn");
    expect(stood.kind === "standIn" && stood.reason).toMatch(/^mario\.0123abcd\.glb: .*timed out after 20000 ms$/);
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
});

describe("the browser source", () => {
  const body = new TextEncoder().encode("glTF fake body").buffer;
  const entry = { file: "mario.0123abcd.glb", bytes: body.byteLength, sha256: createHash("sha256").update(new Uint8Array(body)).digest("hex") };
  // Workers' `404-page` answers a missing /models/* file with 404 and the site's HTML 404 page.
  const notFoundPage = () => new Response("<!DOCTYPE html><html><body>404: This page could not be found.</body></html>", { status: 404, headers: { "content-type": "text/html" } });
  const fetchOf = (respond: (url: string, init?: RequestInit) => Response) =>
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => respond(String(url), init)) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

  describe("index()", () => {
    it("fetches /models/index.json without trusting a cached copy, and parses it", async () => {
      const f = fetchOf(() => Response.json(INDEX));
      const index = await browserModelSource(f).index();
      expect(index?.models.mario.file).toBe("mario.0123abcd.glb");
      expect(f).toHaveBeenCalledWith(MODEL_INDEX_URL, { cache: "no-cache" });
      expect(MODEL_INDEX_URL).toBe("/models/index.json");
    });

    it("answers null for a 404 whose body is an HTML page, without parsing it", async () => {
      const page = notFoundPage();
      const json = vi.spyOn(page, "json");
      expect(await browserModelSource(fetchOf(() => page)).index()).toBeNull();
      expect(json).not.toHaveBeenCalled();
    });

    it("answers null for an index of another schema or with a bad file name", async () => {
      expect(await browserModelSource(fetchOf(() => Response.json({ schema: 2, models: {} }))).index()).toBeNull();
      expect(await browserModelSource(fetchOf(() => Response.json({ schema: 1, models: { a: { file: "../x.glb", bytes: 1, sha256: "" } } }))).index()).toBeNull();
    });

    it("lets a 200 that is not JSON reject, and the cache turns that into a stand-in", async () => {
      const f = fetchOf(() => new Response("<!DOCTYPE html><html></html>", { status: 200 }));
      const src = browserModelSource(f);
      await expect(src.index()).rejects.toThrow();
      const cache = createModelCache(src, () => {});
      expect(await cache.get("mario")).toEqual({ kind: "standIn", reason: "no model index (run pnpm models)" });
    });
  });

  describe("load()", () => {
    const glb = { scene: new Group() };

    it("fetches /models/<file>, verifies, then decodes with meshopt and the models folder as the base path", async () => {
      decoder.parseAsync.mockResolvedValue(glb);
      const f = fetchOf(() => new Response(body.slice(0), { status: 200 }));
      const scene = await browserModelSource(f).load(entry);
      expect(scene).toBe(glb.scene);
      expect(f).toHaveBeenCalledWith("/models/mario.0123abcd.glb");
      expect(decoder.setMeshoptDecoder).toHaveBeenCalledWith(decoder.meshopt);
      expect(decoder.parseAsync).toHaveBeenCalledOnce();
      const [decoded, path] = decoder.parseAsync.mock.calls[0] as [ArrayBuffer, string];
      expect(new Uint8Array(decoded)).toEqual(new Uint8Array(body));
      expect(path).toBe("/models/");
    });

    it("treats a 404 with an HTML body as a missing model: no bytes read, nothing decoded", async () => {
      const page = notFoundPage();
      const read = vi.spyOn(page, "arrayBuffer");
      await expect(browserModelSource(fetchOf(() => page)).load(entry)).rejects.toThrow(new Error("HTTP 404"));
      expect(read).not.toHaveBeenCalled();
      expect(decoder.parseAsync).not.toHaveBeenCalled();
    });

    it("refuses an HTML page served with a 200 (a single-page fallback) before the decoder sees it", async () => {
      const f = fetchOf(() => new Response("<!DOCTYPE html><html><body>app shell</body></html>", { status: 200, headers: { "content-type": "text/html" } }));
      await expect(browserModelSource(f).load(entry)).rejects.toThrow(/bytes, index says 14/);
      expect(decoder.parseAsync).not.toHaveBeenCalled();
    });

    it("refuses a truncated download before the decoder sees it", async () => {
      const f = fetchOf(() => new Response(body.slice(0, 4), { status: 200 }));
      await expect(browserModelSource(f).load(entry)).rejects.toThrow(new Error("mario.0123abcd.glb: 4 bytes, index says 14"));
      expect(decoder.parseAsync).not.toHaveBeenCalled();
    });

    it("refuses a stale copy of the right length before the decoder sees it", async () => {
      const f = fetchOf(() => new Response(new TextEncoder().encode("glTF fake bodY"), { status: 200 }));
      await expect(browserModelSource(f).load(entry)).rejects.toThrow(new Error("mario.0123abcd.glb: SHA-256 does not match the model index"));
      expect(decoder.parseAsync).not.toHaveBeenCalled();
    });

    it("lets a decoder failure reject, and the cache stands the fighter in with its reason", async () => {
      decoder.parseAsync.mockRejectedValue(new Error("Unexpected token in glTF JSON"));
      const f = fetchOf((url) => (url === MODEL_INDEX_URL ? Response.json({ schema: 1, models: { mario: entry } }) : new Response(body.slice(0), { status: 200 })));
      const cache = createModelCache(browserModelSource(f), () => {});
      expect(await cache.get("mario")).toEqual({ kind: "standIn", reason: "mario.0123abcd.glb: Unexpected token in glTF JSON" });
    });

    it("end to end: a model the server never shipped is a stand-in with the HTTP status, and a shipped one is drawn", async () => {
      decoder.parseAsync.mockResolvedValue(glb);
      const f = fetchOf((url) => {
        if (url === MODEL_INDEX_URL) {
          return Response.json({ schema: 1, models: { mario: entry, fox: { file: "fox.89abcdef.glb", bytes: 1, sha256: "y" } } });
        }
        return url === "/models/mario.0123abcd.glb" ? new Response(body.slice(0), { status: 200 }) : notFoundPage();
      });
      const cache = createModelCache(browserModelSource(f), () => {});
      expect(await cache.get("fox")).toEqual({ kind: "standIn", reason: "fox.89abcdef.glb: HTTP 404" });
      expect(await cache.get("mario")).toEqual({ kind: "glb", scene: glb.scene });
      expect(cache.status()).toEqual({ fox: "standIn", mario: "glb" });
    });
  });
});

describe("keeping three.js out of the initial bundle", () => {
  it("imports three for types only and loads the glTF loader and meshopt decoder dynamically", () => {
    const src = readFileSync(join(process.cwd(), "src", "render3d", "models", "loader.ts"), "utf8");
    const staticImports = [...src.matchAll(/^import\s[^;]*?from\s+"([^"]+)"/gm)];
    for (const m of staticImports) {
      expect(m[0], m[1]).toMatch(/^import type /);
    }
    expect(src).toContain('import("three/examples/jsm/loaders/GLTFLoader.js")');
    expect(src).toContain('import("three/examples/jsm/libs/meshopt_decoder.module.js")');
  });
});
