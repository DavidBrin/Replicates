/**
 * Fighter models: fetched lazily, cached per page, and never fatal.
 *
 * The glbs are built locally by `pnpm models` into the git-ignored
 * `public/models/` (spec §3.1), indexed by `public/models/index.json`. A
 * checkout that never ran `pnpm models`, a glb that 404s, a truncated download
 * or a decoder failure all end the same way: that fighter is drawn as a
 * stand-in made of its own hurtbox capsules (`standIn.ts`) and the match plays
 * on. A renderer that throws takes the match with it (D29); a capsule does not.
 * A stand-in is for this match only: the next match asks again, so one network
 * blip does not cost a fighter their model for the rest of the session.
 *
 * Every glb is checked against its index entry (length and SHA-256) before the
 * decoder sees it: the index is the build's record of what it shipped.
 */

import type { Object3D } from "three";

export const MODEL_INDEX_URL = "/models/index.json";
export const MODEL_INDEX_SCHEMA = 1;

export interface ModelIndexEntry {
  /** File name under /models/, content-hashed: `mario.3f9c2a1b.glb`. */
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface ModelIndex {
  readonly schema: typeof MODEL_INDEX_SCHEMA;
  readonly models: Readonly<Record<string, ModelIndexEntry>>;
}

/**
 * The index `scripts/models/build.mjs` writes, or null if `json` is not one.
 * Fields the loader does not read pass through untouched (the build also
 * records each glb's `skeleton` SHA-256, for `pnpm models:check`).
 */
export function parseModelIndex(json: unknown): ModelIndex | null {
  const o = json as Partial<ModelIndex> | null;
  if (o === null || typeof o !== "object" || o.schema !== MODEL_INDEX_SCHEMA || typeof o.models !== "object" || o.models === null) {
    return null;
  }
  for (const e of Object.values(o.models)) {
    if (typeof e?.file !== "string" || !/^[a-zA-Z0-9]+\.[0-9a-f]{8}\.glb$/.test(e.file)) return null;
    // What a download is checked against: a length and a hash, or there is nothing to check it with.
    if (!Number.isSafeInteger(e.bytes) || e.bytes < 0 || typeof e.sha256 !== "string") return null;
  }
  return o as ModelIndex;
}

/** Where models come from: the network in the browser, a fake in tests. */
export interface ModelSource {
  /** The index; null when there is none (a 404: the checkout never ran `pnpm models`); rejects, saying why, when it could not be read. */
  index(): Promise<ModelIndex | null>;
  /** The glb's scene, ready to clone; rejects if the bytes are not the entry's. */
  load(entry: ModelIndexEntry): Promise<Object3D>;
}

/** Resolves when `bytes` are exactly what `entry` lists; rejects naming what differs. */
export async function verifyModelBytes(bytes: ArrayBuffer, entry: ModelIndexEntry): Promise<void> {
  if (bytes.byteLength !== entry.bytes) throw new Error(`${entry.file}: ${bytes.byteLength} bytes, index says ${entry.bytes}`);
  // `crypto.subtle` exists only on https and localhost. Without it a length-only pass would let a stale or
  // tampered file through, so refuse: this page can not vouch for the bytes.
  const subtle = globalThis.crypto?.subtle as SubtleCrypto | undefined;
  if (subtle === undefined) throw new Error(`${entry.file}: cannot verify it: SHA-256 needs a secure context (https or localhost)`);
  const digest = new Uint8Array(await subtle.digest("SHA-256", bytes));
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
  if (hex !== entry.sha256) throw new Error(`${entry.file}: SHA-256 does not match the model index`);
}

export type LoadedModel =
  | { readonly kind: "glb"; readonly scene: Object3D }
  | { readonly kind: "standIn"; readonly reason: string };

export interface ModelCache {
  get(fighterId: string): Promise<LoadedModel>;
  /** Start loading these fighters now (the online lobby, once picks are known); resolves when each has settled. */
  preload(fighterIds: readonly string[]): Promise<void>;
  /** What each requested fighter resolved to so far, for `__smashRender.info()`. */
  status(): Readonly<Record<string, "loading" | "glb" | "standIn">>;
}

/** How long a model may take before the match starts with its stand-in. */
export const MODEL_TIMEOUT_MS = 20_000;

const reasonOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function timeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e: unknown) => (clearTimeout(t), reject(e)),
    );
  });
}

/** What asking for the index came to: the index, or why there is none. */
type IndexRead = { readonly found: ModelIndex } | { readonly problem: string };

export function createModelCache(source: ModelSource, warn: (msg: string) => void = console.warn, ms = MODEL_TIMEOUT_MS): ModelCache {
  let index: Promise<IndexRead> | null = null;
  const models = new Map<string, Promise<LoadedModel>>();
  // No prototype: an id like `__proto__` is then a plain key, and shows in `status()`.
  const state: Record<string, "loading" | "glb" | "standIn"> = Object.create(null);
  const standIn = (id: string, reason: string): LoadedModel => {
    warn(`David-Smash: drawing ${id} as a stand-in — ${reason}`);
    state[id] = "standIn";
    // Forget it, so the next match tries again (and the index too, if that was what failed).
    models.delete(id);
    return { kind: "standIn", reason };
  };
  // The request is bounded like a download: a stalled one must not hold every get and preload, and a late
  // answer is discarded. It never rejects; a thrown `index()` (sync or async) is a reason, like a 404 is.
  const readIndex = (): Promise<IndexRead> =>
    timeout(new Promise<ModelIndex | null>((resolve) => resolve(source.index())), ms, "request").then(
      (found): IndexRead => (found === null ? { problem: "no model index (run pnpm models)" } : { found }),
      (e: unknown): IndexRead => ({ problem: `model index: ${reasonOf(e)}` }),
    );
  const get = (id: string): Promise<LoadedModel> => {
    let m = models.get(id);
    if (m === undefined) {
      state[id] = "loading";
      const idx = (index ??= readIndex());
      m = idx.then(async (read) => {
        if (!("found" in read)) {
          if (index === idx) index = null;
          return standIn(id, read.problem);
        }
        // Own properties only: `constructor` or `toString` is not a model.
        if (!Object.hasOwn(read.found.models, id)) return standIn(id, "not in the model index");
        const entry = read.found.models[id];
        try {
          const scene = await timeout(source.load(entry), ms, "download");
          state[id] = "glb";
          return { kind: "glb", scene } as const;
        } catch (e) {
          // The index may be what is out of date (a deploy renamed the glbs): read it again next match.
          if (index === idx) index = null;
          return standIn(id, `${entry.file}: ${reasonOf(e)}`);
        }
      });
      models.set(id, m);
    }
    return m;
  };
  return {
    get,
    async preload(ids) {
      await Promise.all([...new Set(ids)].map(get));
    },
    status: () => ({ ...state }),
  };
}

/** The browser source: `fetch` for the index and the bytes, checked, then `GLTFLoader` + meshopt. */
export function browserModelSource(fetchFn: typeof fetch = (u, init) => fetch(u, init)): ModelSource {
  return {
    async index() {
      const res = await fetchFn(MODEL_INDEX_URL, { cache: "no-cache" });
      // A missing index is a 404 with the site's HTML page as its body (Workers' `404-page`): null, never parsed.
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const index = parseModelIndex(await res.json());
      if (index === null) throw new Error(`not a schema ${MODEL_INDEX_SCHEMA} model index (files named <id>.<8 hex>.glb)`);
      return index;
    },
    async load(entry) {
      const res = await fetchFn(`/models/${entry.file}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = await res.arrayBuffer();
      await verifyModelBytes(bytes, entry);
      const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
        import("three/examples/jsm/loaders/GLTFLoader.js"),
        import("three/examples/jsm/libs/meshopt_decoder.module.js"),
      ]);
      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.parseAsync(bytes, "/models/");
      return gltf.scene;
    },
  };
}
