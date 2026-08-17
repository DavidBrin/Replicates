/**
 * `pnpm seed:demo` — real Creative Commons footage, for screenshots.
 *
 * Strictly optional, and every part of that word is load-bearing:
 *
 *  - **It is the only thing in this repository that touches the network.**
 *    `pnpm seed` makes zero requests and works on a plane; this one fetches
 *    tens of megabytes and does not. Keeping them as two commands is what lets
 *    that promise be absolute rather than conditional.
 *  - **Nothing depends on it.** No test runs it, no build step calls it, and a
 *    corpus without it is complete. It adds videos to an existing library; it
 *    does not replace one.
 *  - **It writes to gitignored directories only** — the fetched sources are
 *    cached in `public/demo-media/` and served out of `.data/blobs`, both of
 *    which `.gitignore` already covers.
 *
 * ## Attribution is the point, not a footnote
 *
 * CC-BY is not "free to use". It is "free to use **if you credit**", and a
 * replica that stored a Blender film without the credit would be committing
 * exactly the infringement its own Content ID slice exists to detect. So the
 * attribution is written into the database beside the video, in the form the
 * licensor asks for, and rendered wherever the description is rendered.
 *
 * **Repository gap, reported rather than worked around:** `videos` has no
 * attribution column and no repository method to set one, so the credit lives
 * in a delimited block at the end of `videos.description` and in the video's
 * tags. A real implementation wants `videos.attribution` and
 * `videos.licence_url` as columns, because a description is editable by the
 * uploader and a licence condition is not.
 *
 * ## Why these are progressive uploads
 *
 * A fetched film is a container this repository cannot open: research/01 §9.2
 * is explicit that WebCodecs does not demux and that a demuxer is a dependency
 * this project does not carry. So there is no way to re-encode a downloaded
 * file into a ladder, and no way to pull a real frame out of it for a
 * thumbnail. Both consequences are honest rather than hidden: the videos are
 * stored whole and served over HTTP `Range` on the `progressive` pipeline —
 * which is a real path this corpus otherwise exercises exactly once — and their
 * posters are generated title cards that say so.
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import * as nodeModule from "node:module";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

/* ====================================================== module loading == */

/**
 * The same bootstrap `scripts/seed.ts` opens with, and it has to be duplicated.
 *
 * Sharing it would mean importing it, and an import is the one thing that
 * cannot happen before the hooks exist: `./seed` is extensionless, so Node
 * cannot resolve it, and `./seed.ts` is a specifier `tsconfig.json` rejects
 * without `allowImportingTsExtensions`. Two entry points, each responsible for
 * making itself loadable. The long explanation of *why* any of this is needed
 * is at the top of `scripts/seed.ts`; it is not repeated here.
 */
const PROJECT_ROOT = new URL("../", import.meta.url);
const SRC_ROOT = new URL("src/", PROJECT_ROOT);
const SERVER_ONLY_STUB = new URL("test-support/empty-module.ts", SRC_ROOT).href;

interface Hooks {
  resolve?(
    specifier: string,
    context: { parentURL?: string },
    next: (s: string, c?: { parentURL?: string }) => { url: string; shortCircuit?: boolean },
  ): { url: string; shortCircuit?: boolean };
  load?(
    url: string,
    context: { format?: string | null },
    next: (u: string, c?: { format?: string | null }) => { format: string; source?: unknown },
  ): { format: string; source?: unknown; shortCircuit?: boolean };
}

function installLoaderHooks(): void {
  const register = (nodeModule as unknown as { registerHooks?: (hooks: Hooks) => unknown })
    .registerHooks;
  if (typeof register !== "function") {
    throw new Error("This Node build has no module.registerHooks (added in 22.15).");
  }

  register({
    resolve(specifier, context, next) {
      if (specifier === "server-only") return { url: SERVER_ONLY_STUB, shortCircuit: true };

      const ours =
        context.parentURL !== undefined &&
        context.parentURL.startsWith(PROJECT_ROOT.href) &&
        !context.parentURL.includes("/node_modules/");

      let base: URL | undefined;
      if (specifier.startsWith("@/")) base = new URL(specifier.slice(2), SRC_ROOT);
      else if (specifier.startsWith(".") && ours) base = new URL(specifier, context.parentURL!);

      if (base !== undefined) {
        for (const suffix of [".ts", ".tsx", "/index.ts"]) {
          const candidate = new URL(base.href + suffix);
          if (existsSync(fileURLToPath(candidate))) {
            return { url: candidate.href, shortCircuit: true };
          }
        }
      }
      return next(specifier, context);
    },

    load(url, context, next) {
      if (!url.startsWith("file:") || !/\.tsx?$/.test(url)) return next(url, context);
      const path = fileURLToPath(url);
      const output = ts.transpileModule(readFileSync(path, "utf8"), {
        fileName: path,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          useDefineForClassFields: true,
          inlineSourceMap: true,
          inlineSources: true,
        },
      });
      return { format: "module", source: output.outputText, shortCircuit: true };
    },
  });
}

installLoaderHooks();

/* ============================================================ manifest == */

interface DemoAsset {
  /** Stable key. Seeds the video id, so the same asset keeps its URL. */
  readonly key: string;
  readonly title: string;
  readonly synopsis: string;
  /** Exactly the credit line the licensor asks for. Not paraphrased. */
  readonly attribution: string;
  readonly licence: string;
  readonly licenceUrl: string;
  readonly sourcePage: string;
  readonly tags: readonly string[];
  readonly category: string;
  readonly palette: readonly [string, string, string];
  /**
   * Candidate URLs, tried in order.
   *
   * More than one because the canonical host is not always reachable: measured
   * from this machine, `download.blender.org` answers a Cloudflare challenge
   * (HTTP 403) to a plain client, while the Wikimedia Commons mirror of the
   * same film serves fine. Listing the canonical source first keeps the
   * provenance honest; listing the mirror second keeps the script useful.
   */
  readonly urls: readonly string[];
  readonly extension: string;
  /** Declared by the source, not measured here — see `probeGeometry`. */
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  /** Approximate download size, for the budget below. */
  readonly megabytes: number;
  /**
   * Where this lands on the home grid, as a view count. Defaults to 0.
   *
   * The home feed's fallback is ordered `view_count desc, published_at desc,
   * id desc`, so a video with no views sits below every seeded one — which is
   * correct for a demo asset and wrong for the case this field exists for:
   * putting *your own* video at the top of the page in a portfolio. See
   * `ADDING-VIDEOS.md`.
   *
   * `videos.view_count` has no repository setter — `updateVideo`'s column map
   * deliberately omits it so that `{ view_count: 1e9 }` from a request body
   * cannot reach it — so this is stamped with SQL here, exactly as
   * `stampCorpusFacts` in `scripts/seed.ts` does for the synthetic corpus, and
   * for the same reason.
   */
  readonly viewCount?: number;
}

/**
 * The catalogue.
 *
 * Blender's open movies are the anchor: they are genuinely CC-BY, the credit
 * line is published, and they are the films every video-platform demo has used
 * for fifteen years. NASA's material is public domain, so the credit below is
 * courtesy rather than obligation, and it says so.
 *
 * **Xiph's `media.xiph.org` collection is deliberately absent.** It is the
 * right *source* — uncompressed reference clips, freely licensed — and it is
 * the wrong *shape*: the derf collection is raw Y4M, hundreds of megabytes for
 * a few seconds, and no browser plays it. Turning it into something playable
 * means transcoding, transcoding means demuxing, and research/01 §9.2 is why
 * this script stores files rather than re-encoding them. Recorded so nobody
 * has to rediscover it.
 */
const ASSETS: readonly DemoAsset[] = [
  {
    key: "caminandes-llama-drama",
    title: "Caminandes: Llama Drama",
    synopsis:
      "A llama, a fence, and a great deal of persistence. The first of the Caminandes shorts, made with Blender.",
    attribution: "Blender Foundation | www.blender.org",
    licence: "CC BY 3.0",
    licenceUrl: "https://creativecommons.org/licenses/by/3.0/",
    sourcePage: "https://commons.wikimedia.org/wiki/File:Caminandes-_Llama_Drama_-_Short_Movie.ogv",
    tags: ["animation", "blender", "open movie", "creative commons"],
    category: "Film & Animation",
    palette: ["#0d1408", "#e8f5c8", "#84cc16"],
    urls: [
      "https://download.blender.org/durian/movies/caminandes_1_llama_drama_1080p.mp4",
      "https://upload.wikimedia.org/wikipedia/commons/transcoded/d/d0/Caminandes-_Llama_Drama_-_Short_Movie.ogv/Caminandes-_Llama_Drama_-_Short_Movie.ogv.240p.vp9.webm",
    ],
    extension: "webm",
    width: 426,
    height: 240,
    durationSeconds: 150,
    megabytes: 2.3,
  },
  {
    key: "ingenuity-fourth-flight",
    title: "Perseverance captures the fourth Ingenuity flight",
    synopsis:
      "Video and audio of Ingenuity's fourth flight on Mars, recorded by the Perseverance rover's microphone and Mastcam-Z.",
    // Public domain, so this is a courtesy credit rather than a licence
    // condition — and saying which it is matters more than the line itself.
    attribution: "NASA/JPL-Caltech (public domain — credited by courtesy)",
    licence: "Public domain",
    licenceUrl: "https://www.nasa.gov/nasa-brand-center/images-and-media/",
    sourcePage:
      "https://commons.wikimedia.org/wiki/File:NASA%27s_Perseverance_Captures_Video,_Audio_of_Fourth_Ingenuity_Flight.webm",
    tags: ["nasa", "mars", "ingenuity", "public domain"],
    category: "Science & Technology",
    palette: ["#1a0f08", "#ffd9b3", "#f97316"],
    urls: [
      "https://upload.wikimedia.org/wikipedia/commons/transcoded/b/b1/NASA%27s_Perseverance_Captures_Video%2C_Audio_of_Fourth_Ingenuity_Flight.webm/NASA%27s_Perseverance_Captures_Video%2C_Audio_of_Fourth_Ingenuity_Flight.webm.240p.vp9.webm",
    ],
    extension: "webm",
    width: 426,
    height: 240,
    durationSeconds: 189,
    megabytes: 2.8,
  },
  {
    key: "elephants-dream",
    title: "Elephants Dream",
    synopsis:
      "The first open movie: two characters in a machine that is not what it appears to be. Made entirely with free software.",
    attribution: "Blender Foundation | www.blender.org",
    licence: "CC BY 2.5",
    licenceUrl: "https://creativecommons.org/licenses/by/2.5/",
    sourcePage: "https://commons.wikimedia.org/wiki/File:Elephants_Dream_(2006).webm",
    tags: ["animation", "blender", "open movie", "creative commons"],
    category: "Film & Animation",
    palette: ["#0b0d16", "#cdd5ff", "#7c8cf8"],
    urls: [
      "https://download.blender.org/ED/ED_HD.avi",
      "https://upload.wikimedia.org/wikipedia/commons/transcoded/a/a2/Elephants_Dream_%282006%29.webm/Elephants_Dream_%282006%29.webm.240p.vp9.webm",
    ],
    extension: "webm",
    width: 426,
    height: 240,
    durationSeconds: 654,
    megabytes: 22.6,
  },
  {
    key: "tears-of-steel",
    title: "Tears of Steel",
    synopsis:
      "Live action and visual effects, shot in Amsterdam and composited in Blender. The project that drove Blender's VFX toolset.",
    attribution: "Blender Foundation | www.blender.org",
    licence: "CC BY 3.0",
    licenceUrl: "https://creativecommons.org/licenses/by/3.0/",
    sourcePage: "https://commons.wikimedia.org/wiki/File:Tears_of_Steel_1080p.webm",
    tags: ["vfx", "blender", "open movie", "creative commons"],
    category: "Film & Animation",
    palette: ["#101418", "#dbe6ef", "#38bdf8"],
    urls: [
      "https://download.blender.org/demo/movies/ToS/ToS-4k-1920.mov",
      "https://upload.wikimedia.org/wikipedia/commons/transcoded/c/cb/Tears_of_Steel_1080p.webm/Tears_of_Steel_1080p.webm.240p.vp9.webm",
    ],
    extension: "webm",
    width: 426,
    height: 178,
    durationSeconds: 734,
    megabytes: 33.9,
  },
];

/**
 * The default download budget, in megabytes per asset.
 *
 * Small on purpose. `pnpm seed:demo` with no arguments should cost a few
 * seconds and five megabytes, not a coffee break and a hundred — somebody
 * running it to take a screenshot is not asking to mirror the Blender archive.
 * `--all` lifts it.
 */
const DEFAULT_MAX_MEGABYTES = 8;

const CACHE_DIR = fileURLToPath(new URL("public/demo-media/", PROJECT_ROOT));

/* ============================================================== main == */

interface Options {
  readonly all: boolean;
  readonly limit: number;
}

const USAGE = `pnpm seed:demo [--all] [--limit=N]

Fetches Creative Commons video and adds it to the library as progressive
uploads, with the licensor's credit stored beside each video.

  --all       Ignore the ${DEFAULT_MAX_MEGABYTES} MB per-asset download budget.
  --limit=N   Add at most N assets.

This is the only command in the repository that uses the network. Downloads are
cached in public/demo-media/ (gitignored); a second run re-uses them.
`;

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));

  const [corpusModule, generateClips, thumbnails, dbModule, blobModule, blobKeysModule,
    videosRepo, channelsRepo, usersRepo, searchModule] = await Promise.all([
    import("./seed/corpus"),
    import("./seed/generate-clips"),
    import("./seed/thumbnails"),
    import("@/adapters/db"),
    import("@/adapters/blob"),
    import("@/ports/blob-store"),
    import("@/adapters/repositories/videos"),
    import("@/adapters/repositories/channels"),
    import("@/adapters/repositories/users"),
    import("@/adapters/search/postgres"),
  ]);

  const wanted = ASSETS.filter(
    (asset) => options.all || asset.megabytes <= DEFAULT_MAX_MEGABYTES,
  ).slice(0, options.limit);

  if (wanted.length === 0) {
    // Two different reasons, said apart: "nothing survived the budget" and
    // "you asked for none" are not the same message.
    log(
      options.limit === 0
        ? "Nothing to do: --limit=0."
        : `Nothing to do: every asset is above the ${DEFAULT_MAX_MEGABYTES} MB ` +
          "budget. Use --all.",
    );
    return;
  }

  log(`fetching ${wanted.length} asset(s) — this is the one command that uses the network`);
  await mkdir(CACHE_DIR, { recursive: true });

  const fetched: { asset: DemoAsset; bytes: Uint8Array; cachePath: string }[] = [];
  for (const asset of wanted) {
    const cachePath = join(CACHE_DIR, `${asset.key}.${asset.extension}`);
    const bytes = await fetchWithCache(asset, cachePath);
    fetched.push({ asset, bytes, cachePath });
    log(
      `  ${asset.key.padEnd(28)} ${formatBytes(bytes.byteLength).padStart(9)} ` +
        `sha256 ${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}`,
    );
  }

  const db = await dbModule.database();
  const store = await blobModule.blobStore();
  const { blobKeys } = blobKeysModule;

  /* ------------------------------------------------------------ channel -- */

  const users = usersRepo.createUsersRepository(db);
  const channels = channelsRepo.createChannelsRepository(db);

  let channel = await channels.findByHandle(DEMO_CHANNEL.handle);
  if (channel === null) {
    const registered = await users.register({
      email: DEMO_CHANNEL.email,
      password: corpusModule.SEED_PASSWORD,
      displayName: DEMO_CHANNEL.name,
      handle: DEMO_CHANNEL.handle,
    });
    channel = registered.channel;
  }

  const browser = await generateClips.openSeedBrowser();
  try {
    const art = await browser.renderChannelArt({
      name: DEMO_CHANNEL.name,
      monogram: DEMO_CHANNEL.monogram,
      palette: DEMO_CHANNEL.palette,
    });
    const storedArt = await thumbnails.storeChannelArt(store, channel.id, art);
    await channels.update(channel.id, {
      name: DEMO_CHANNEL.name,
      description: DEMO_CHANNEL.description,
      avatarKey: storedArt.avatarKey,
      bannerKey: storedArt.bannerKey,
    });

    /* ---------------------------------------------------------- videos -- */

    let added = 0;
    for (const { asset, bytes } of fetched) {
      const id = demoVideoId(asset.key);
      if ((await videosRepo.getVideo(db, id)) !== null) {
        log(`  ${asset.title} is already in the library (${id})`);
        continue;
      }

      await videosRepo.createVideo(db, {
        id,
        channelId: channel.id,
        title: asset.title,
        description: describe(asset),
        category: asset.category,
        tags: [...asset.tags, asset.licence.toLowerCase()],
        pipeline: "progressive",
        durationSeconds: asset.durationSeconds,
        width: asset.width,
        height: asset.height,
      });

      const key = blobKeys.progressive(id, asset.extension);
      await store.put(key, bytes, {
        contentType: asset.extension === "webm" ? "video/webm" : "video/mp4",
        contentLength: bytes.byteLength,
        immutable: true,
      });

      // A generated card, not a frame: pulling a still out of a fetched
      // container needs a demuxer (research/01 §9.2), and a placeholder that
      // pretended otherwise would be the one dishonest pixel in the corpus.
      const poster = await browser.renderPosterCard({
        spec: titleCardSpec(asset),
        atSeconds: 1.2,
        width: 1280,
        height: 720,
      });
      const thumbnail = await thumbnails.storeThumbnail(store, id, poster);

      await videosRepo.updateVideo(db, id, {
        progressiveKey: key,
        thumbnailKey: thumbnail.key,
      });
      await videosRepo.publishVideo(db, id);

      // Raw SQL, and the only statement this script issues, for the reason
      // `DemoAsset.viewCount` gives: the column has no setter on purpose.
      // Skipped entirely at the default of zero, so a plain `pnpm seed:demo`
      // writes exactly what it used to.
      const viewCount = asset.viewCount ?? 0;
      if (viewCount > 0) {
        await db.execute(`update videos set view_count = $2 where id = $1`, [
          id,
          viewCount,
        ]);
      }

      await new searchModule.PostgresSearchIndex(db).index({
        id,
        kind: "video",
        title: asset.title,
        description: describe(asset),
        channelName: DEMO_CHANNEL.name,
        tags: asset.tags,
        publishedAt: new Date(),
        viewCount,
        likeCount: 0,
        dislikeCount: 0,
        durationSeconds: asset.durationSeconds,
      });

      added += 1;
      log(`  added ${id}  ${asset.title} — ${asset.attribution}`);
    }

    log(`\nadded ${added} Creative Commons video(s) to @${DEMO_CHANNEL.handle}`);
    log(`sources cached in public/demo-media/ (gitignored); re-running re-uses them`);
  } finally {
    await browser.close();
    await db.close();
  }
}

const DEMO_CHANNEL = {
  handle: "opencinema",
  name: "Open Cinema",
  monogram: "OC",
  email: "opencinema@seed.invalid",
  description:
    "Freely licensed film, credited as the licence requires. Added by `pnpm seed:demo`; every video here links its source and its licence.",
  palette: ["#0d1408", "#e8f5c8", "#84cc16"] as const,
} as const;

/**
 * The description, with the credit block the licence requires.
 *
 * Delimited by a rule so a renderer that wanted to style it could find it, and
 * written last so it survives truncation of the synopsis above it. This is the
 * workaround for the missing `videos.attribution` column, and it is a
 * workaround — see the module header.
 */
function describe(asset: DemoAsset): string {
  return [
    asset.synopsis,
    "",
    "———",
    `${asset.attribution}`,
    `Licence: ${asset.licence} — ${asset.licenceUrl}`,
    `Source: ${asset.sourcePage}`,
    "",
    "Stored and served unmodified on the progressive pipeline. The poster frame",
    "is generated by this project, not extracted from the film.",
  ].join("\n");
}

/** A title card spec — the same painter the synthetic corpus uses. */
function titleCardSpec(asset: DemoAsset): import("./seed/corpus").ClipSpec {
  return {
    width: 1280,
    height: 720,
    durationSeconds: 4,
    frameRate: 30,
    visual: "gradient",
    palette: asset.palette,
    caption: asset.title,
    // Derived from the key so the card is stable across runs, like everything
    // else in this corpus.
    phase: (hash32(asset.key) % 1000) / 1000,
    audio: { pulseHz: 0, pulseGain: 0, events: [] },
  };
}

/* ============================================================ fetching == */

/**
 * Fetch an asset, trying each candidate URL, and cache the result.
 *
 * The cache is checked first and trusted on size alone — these files are
 * immutable published releases, and re-hashing 30 MB on every run to catch a
 * corruption that has never happened would cost more than the download it
 * saves. A truncated cache file is caught by the size check; a *corrupted* one
 * of the right length is not, and deleting `public/demo-media/` is the fix.
 */
async function fetchWithCache(asset: DemoAsset, cachePath: string): Promise<Uint8Array> {
  try {
    const info = await stat(cachePath);
    if (info.size > 0) {
      log(`  ${asset.key.padEnd(28)} cached`);
      return new Uint8Array(await readFile(cachePath));
    }
  } catch {
    /* Not cached yet. */
  }

  const failures: string[] = [];
  for (const url of asset.urls) {
    try {
      const response = await fetch(url, {
        // Some mirrors answer a bot challenge to a default client. A real
        // browser's UA is the difference between a 200 and a Cloudflare
        // interstitial; measured against `download.blender.org`, which answers
        // 403 to a plain client from this machine either way.
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
          accept: "video/*,*/*;q=0.8",
        },
      });
      if (!response.ok) {
        failures.push(`${url} → HTTP ${response.status}`);
        continue;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      await mkdir(dirname(cachePath), { recursive: true });
      await writeFile(cachePath, bytes);
      return bytes;
    } catch (error) {
      failures.push(`${url} → ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(
    `Could not fetch "${asset.title}". Tried:\n  ${failures.join("\n  ")}\n` +
      "This command needs the network; `pnpm seed` does not.",
  );
}

/* ============================================================= helpers == */

/**
 * A stable eleven-character video id for a demo asset.
 *
 * Derived from the key rather than generated, so re-running `pnpm seed:demo`
 * finds the video it added last time instead of adding a second copy. Same
 * alphabet and length as `newVideoId` in `repositories/videos.ts`, for the same
 * reason: an id that appears in `/watch?v=` has a shape.
 */
function demoVideoId(key: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  let state = hash32(key);
  let id = "";
  for (let index = 0; index < 11; index++) {
    state = (Math.imul(state ^ (state >>> 15), 0x2545f491) + 0x9e3779b9) >>> 0;
    id += alphabet[state % alphabet.length];
  }
  return id;
}

/** FNV-1a, so the id derivation needs no dependency and no PRNG import. */
function hash32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function parseOptions(argv: readonly string[]): Options {
  let all = false;
  let limit = ASSETS.length;
  for (const argument of argv) {
    const [name, value] = argument.split("=", 2);
    if (name === "--all") all = true;
    else if (name === "--limit") {
      // `--limit=2`, not `--limit 2`. Written as a rejection rather than a
      // coercion because the coercion was silent and wrong in the same breath:
      // `Number(undefined)` is `NaN`, `slice(0, NaN)` is empty, and the run
      // then reported "every asset is above the budget" — a sentence about a
      // filter that had nothing to do with it.
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(
          `--limit needs a whole number written as --limit=N (got ${
            value === undefined ? "no value" : `"${value}"`
          }).`,
        );
      }
      limit = parsed;
    }
    else if (name === "--help") {
      process.stdout.write(USAGE);
      process.exit(0);
    } else if (name?.startsWith("--")) {
      throw new Error(`Unknown option ${name}. Run with --help.`);
    }
  }
  return { all, limit };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

await main().catch((error: unknown) => {
  process.stderr.write(
    `\nseed:demo failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
