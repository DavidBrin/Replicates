/**
 * `pnpm seed` — a populated library that `pnpm dev` boots into, with no network.
 *
 * ## What this does
 *
 * Builds the deterministic corpus in `scripts/seed/corpus.ts`, encodes every
 * clip in it by driving the project's **real** WebCodecs pipeline in headless
 * Chromium, muxes the result with the project's **real** fMP4 muxer, packages
 * it with the project's **real** HLS packager, and writes the rows through the
 * repositories in `src/adapters/repositories`. Nothing here reimplements a
 * pipeline stage and nothing fabricates its output — which is the point. A
 * fixture layer that produced plausible bytes would let `src/media` rot with
 * every test still green, because nothing but this script exercises the encode
 * path end to end.
 *
 * Not one network request. The only socket opened is a loopback HTTP server on
 * `127.0.0.1`, and that exists because WebCodecs needs a secure-context origin
 * (research/01 §4.1) — not to fetch anything.
 *
 * ## Why this file starts with a module loader
 *
 * `package.json` runs it as `node --experimental-strip-types scripts/seed.ts`,
 * and that command cannot load this project's `src/` on its own, for three
 * independent reasons:
 *
 *  1. **Path aliases.** `@/adapters/db` is a `tsconfig.json` `paths` entry.
 *     Node does not read `tsconfig.json`.
 *  2. **Extensionless relative imports.** `./shared` is how every module here
 *     is written, because `moduleResolution: "bundler"` expects it. Node's ESM
 *     resolver requires the extension.
 *  3. **`server-only`.** Every repository imports it, and it is a package whose
 *     entry point *throws* unless resolved under the `react-server` condition.
 *     `vitest.config.mts` aliases it to an empty module for exactly this
 *     reason; a script cannot add a condition to a process that has started.
 *
 * And Node 26's type stripping is strip-*only* — `--experimental-transform-types`
 * no longer exists — so it rejects `constructor(readonly entity: string)`, which
 * `repositories/shared.ts` and `ports/blob-store.ts` both use. Measured, not
 * assumed: `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, from `node --experimental-strip-types`
 * on `repositories/videos.ts`.
 *
 * So the first thing this file does is install a synchronous
 * `module.registerHooks` pair that resolves those three specifier shapes and
 * transpiles `.ts` with the `typescript` compiler — a devDependency this project
 * already has, doing transpile-only work that `pnpm exec tsc --noEmit` has
 * already type-checked. Every import below the hook installation is therefore
 * **dynamic**: a static `import` is hoisted above the registration and would be
 * resolved by the plain Node resolver, which is the failure this exists to
 * avoid. That is the only reason this file's imports look the way they do.
 *
 * ## What the repositories could not express
 *
 * Four columns that make the difference between a believable corpus and an
 * obviously synthetic one have no repository setter. They are written by
 * {@link stampCorpusFacts}, which is the one place in this script that issues
 * SQL, is named so it can be found, and lists the missing method for each. See
 * that function.
 */

import { existsSync, readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { fileURLToPath } from "node:url";

import ts from "typescript";

/* ------------------------------------------------- module.registerHooks -- */

/**
 * `module.registerHooks` — declared here rather than imported.
 *
 * `@types/node` is pinned at `^20` in this project's `package.json`, and the
 * synchronous, in-thread hook API landed in Node 22.15. So the runtime has it
 * (this runs on Node 26) and the type definitions do not. Writing the three
 * shapes out is honest about that gap; a `// @ts-expect-error` would hide it,
 * and bumping `@types/node` is not this slice's file to touch.
 *
 * Synchronous hooks specifically, not the `register()` + worker-thread form:
 * these apply to the very next `import()` in this same file, which is what lets
 * the bootstrap be "install, then load" rather than "install, then spawn".
 */
interface HookResolveContext {
  readonly parentURL?: string;
  readonly conditions?: readonly string[];
}
interface HookResolveResult {
  readonly url: string;
  readonly format?: string | null;
  readonly shortCircuit?: boolean;
}
interface HookLoadContext {
  readonly format?: string | null;
}
interface HookLoadResult {
  readonly format: string;
  readonly source?: string | ArrayBuffer | Uint8Array;
  readonly shortCircuit?: boolean;
}
interface SynchronousHooks {
  resolve?(
    specifier: string,
    context: HookResolveContext,
    nextResolve: (specifier: string, context?: HookResolveContext) => HookResolveResult,
  ): HookResolveResult;
  load?(
    url: string,
    context: HookLoadContext,
    nextLoad: (url: string, context?: HookLoadContext) => HookLoadResult,
  ): HookLoadResult;
}

function resolveRegisterHooks(): (hooks: SynchronousHooks) => unknown {
  const candidate = (
    nodeModule as unknown as { registerHooks?: (hooks: SynchronousHooks) => unknown }
  ).registerHooks;
  if (typeof candidate !== "function") {
    throw new Error(
      "This Node build has no module.registerHooks (added in 22.15). Without it " +
        "the seed cannot resolve `@/…`, extensionless imports or `server-only`, " +
        "all three of which every repository in src/ depends on.",
    );
  }
  return candidate;
}

/* ====================================================== module loading == */

const PROJECT_ROOT = new URL("../", import.meta.url);
const SRC_ROOT = new URL("src/", PROJECT_ROOT);

/**
 * A module that exports nothing, standing in for `server-only`.
 *
 * `src/test-support/empty-module.ts` already exists for this, and pointing at
 * it rather than at a `data:` URL keeps the two substitutions — the test
 * runner's and this one's — visibly the same substitution.
 */
const SERVER_ONLY_STUB = new URL("test-support/empty-module.ts", SRC_ROOT).href;

/**
 * The extensions `moduleResolution: "bundler"` would have tried, in its order.
 *
 * The bare specifier itself is deliberately **not** in this list. Adding it
 * looks harmless and is not: `require("./dist")` inside a dependency then
 * resolves to a *directory*, which passes `existsSync`, is returned as a module
 * URL, and fails several frames later as `EISDIR: illegal operation on a
 * directory, read` — a message that names neither the specifier nor the package
 * that asked for it. Measured, from the first run of this script.
 */
function firstExisting(base: URL): string | undefined {
  for (const suffix of [".ts", ".tsx", "/index.ts"]) {
    const candidate = new URL(base.href + suffix);
    if (existsSync(fileURLToPath(candidate))) return candidate.href;
  }
  return undefined;
}

/**
 * Whether a relative import should be rewritten at all.
 *
 * These hooks are process-wide and see every `require` and `import` in the
 * program, dependencies included. A dependency's own `./x` must be left to
 * Node: it is already valid, its package has its own resolution rules, and
 * guessing a `.ts` for it is how a working package starts failing.
 */
function isOurs(parentURL: string | undefined): boolean {
  return (
    parentURL !== undefined &&
    parentURL.startsWith(PROJECT_ROOT.href) &&
    !parentURL.includes("/node_modules/")
  );
}

function installLoaderHooks(): void {
  resolveRegisterHooks()({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") {
        return { url: SERVER_ONLY_STUB, shortCircuit: true };
      }

      let base: URL | undefined;
      if (specifier.startsWith("@/")) {
        base = new URL(specifier.slice(2), SRC_ROOT);
      } else if (specifier.startsWith(".") && isOurs(context.parentURL)) {
        base = new URL(specifier, context.parentURL!);
      }

      if (base !== undefined) {
        const found = firstExisting(base);
        // Deliberately no `format` in the answer: naming it "module" would tell
        // Node the file is already JavaScript and skip the load hook's
        // transpile, which fails on the first type annotation.
        if (found !== undefined) return { url: found, shortCircuit: true };
      }

      return nextResolve(specifier, context);
    },

    load(url, context, nextLoad) {
      if (!url.startsWith("file:") || !/\.tsx?$/.test(url)) return nextLoad(url, context);
      const path = fileURLToPath(url);
      const output = ts.transpileModule(readFileSync(path, "utf8"), {
        fileName: path,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          // Mirrors `tsconfig.json`. `useDefineForClassFields` decides whether a
          // declared field and a `#private` field initialise in the order the
          // source wrote them, which `media/encode/transcode.ts` depends on.
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

/* ============================================================== options == */

interface Options {
  readonly seed?: number;
  readonly nowMs?: number;
  /** Encode only the first N videos. A development flag; the default is all. */
  readonly videoLimit?: number;
}

function parseOptions(argv: readonly string[]): Options {
  const options: { seed?: number; nowMs?: number; videoLimit?: number } = {};
  for (const argument of argv) {
    const [name, value] = argument.split("=", 2);
    switch (name) {
      case "--seed":
        options.seed = Number(value);
        break;
      case "--now": {
        const parsed = Date.parse(value ?? "");
        if (Number.isNaN(parsed)) {
          throw new Error(`--now expects an ISO timestamp; got ${String(value)}`);
        }
        options.nowMs = parsed;
        break;
      }
      case "--videos":
        options.videoLimit = Number(value);
        break;
      case "--help":
        process.stdout.write(USAGE);
        process.exit(0);
        break;
      default:
        if (name?.startsWith("--")) {
          throw new Error(`Unknown option ${name}. Run with --help.`);
        }
    }
  }
  return options;
}

const USAGE = `pnpm seed [--seed=N] [--now=ISO] [--videos=N]

  --seed=N    Corpus seed. Changes every id. Default: the constant in
              scripts/seed/corpus.ts.
  --now=ISO   The corpus's "now". Defaults to a fixed instant so that two runs
              agree; pass the real clock for a screenshot run where relative
              timestamps should read as recent.
  --videos=N  Encode only the first N videos. Development flag — the corpus is
              filtered to match, so the result is coherent but smaller.

Re-running is a no-op once the corpus is present. To rebuild, delete .data/
(the database and the blob store both live there, and .gitignore already
describes them as regenerable by this script).
`;

/* ================================================================ main == */

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const startedAt = Date.now();

  /*
   * Everything below is loaded through the hooks installed above. A static
   * import would be hoisted past `installLoaderHooks()` and resolved by the
   * plain Node resolver, which cannot see `@/` or strip a parameter property.
   */
  const [
    corpusModule,
    synthesise,
    generateClips,
    thumbnails,
    dbModule,
    blobModule,
    blobKeysModule,
    muxer,
    packager,
    videosRepo,
    channelsRepo,
    usersRepo,
    commentsRepo,
    reactionsRepo,
    subscriptionsRepo,
    playlistsRepo,
    watchEventsRepo,
    contentIdRepo,
    captionsRepo,
    vttModule,
    fingerprintModule,
    searchModule,
  ] = await Promise.all([
    import("./seed/corpus"),
    import("./seed/synthesise"),
    import("./seed/generate-clips"),
    import("./seed/thumbnails"),
    import("@/adapters/db"),
    import("@/adapters/blob"),
    import("@/ports/blob-store"),
    import("@/media/muxer"),
    import("@/media/packager"),
    import("@/adapters/repositories/videos"),
    import("@/adapters/repositories/channels"),
    import("@/adapters/repositories/users"),
    import("@/adapters/repositories/comments"),
    import("@/adapters/repositories/reactions"),
    import("@/adapters/repositories/subscriptions"),
    import("@/adapters/repositories/playlists"),
    import("@/adapters/repositories/watch-events"),
    import("@/adapters/repositories/content-id"),
    import("@/adapters/repositories/captions"),
    import("@/domain/captions"),
    import("@/domain/fingerprint"),
    import("@/adapters/search/postgres"),
  ]);

  const { blobKeys } = blobKeysModule;
  const corpus = filterCorpus(
    corpusModule.buildCorpus({
      ...(options.seed === undefined ? {} : { seed: options.seed }),
      ...(options.nowMs === undefined ? {} : { nowMs: options.nowMs }),
    }),
    options.videoLimit,
  );

  log(`corpus ${corpusModule.corpusDigest(corpus)} — seed ${corpus.seed}, ` +
    `${corpus.channels.length} channels, ${corpus.videos.length} videos, ` +
    `${corpus.comments.length} comment threads, ${corpus.sessions.length} sessions`);

  const db = await dbModule.database();
  const store = await blobModule.blobStore();

  /* ----------------------------------------------------------- idempotence -- */

  // The corpus's ids are deterministic, so "already seeded" is a lookup rather
  // than a marker table. Counting rather than probing one row matters: a run
  // that crashed halfway leaves *some* of the corpus behind, and a check on the
  // first video would report that as "already seeded" and leave a library
  // missing two thirds of its catalogue with nothing complaining.
  const present = (
    await Promise.all(corpus.videos.map((video) => videosRepo.getVideo(db, video.id)))
  ).filter((video) => video !== null).length;

  if (present === corpus.videos.length && present > 0) {
    log(`already seeded — ${present} videos present. Delete .data/ to rebuild.`);
    await db.close();
    return;
  }
  if (present > 0) {
    await db.close();
    throw new Error(
      `Found ${present} of ${corpus.videos.length} corpus videos already in the ` +
        "database, which means a previous run did not finish. Delete .data/ and " +
        "run again — this script does not resume, because a half-encoded ladder " +
        "is indistinguishable from a finished one at the row level.",
    );
  }

  /* --------------------------------------------------------------- browser -- */

  const browser = await generateClips.openSeedBrowser({
    onConsole: (level, text) => {
      if (level === "error" || level === "pageerror") log(`page ${level}: ${text}`);
    },
  });

  const totals = { segments: 0, bytes: 0, clips: 0, captions: 0, encodeMs: 0 };
  const userIdByKey = new Map<string, string>();
  const channelIdByKey = new Map<string, string>();

  try {
    const capabilities = await browser.capabilities();
    log(
      `headless chromium: secureContext=${String(capabilities.secureContext)} ` +
        `VideoEncoder=${String(capabilities.videoEncoder)} ` +
        `AudioEncoder=${String(capabilities.audioEncoder)} ` +
        `avc-high=${String(capabilities.avcHigh)} on ${process.platform}/${process.arch}`,
    );
    if (capabilities.avcHigh !== true && capabilities.avcBaseline !== true) {
      throw new Error(
        "This browser reports no AVC encoder. research/01 §4.3 measured software " +
          "AVC encode working headless with zero flags on macOS; §4.7 flags Linux " +
          "as never verified. Run the check in §4.6 in this environment before " +
          "assuming the pipeline is at fault.",
      );
    }

    /* ------------------------------------------------------ people, channels -- */

    const users = usersRepo.createUsersRepository(db);
    const channels = channelsRepo.createChannelsRepository(db);

    // Registration hashes a password with scrypt at ~200 ms a time
    // (`lib/auth/password.ts` measured it), and `register` deliberately hashes
    // *outside* its transaction — so three at a time overlaps the derivations
    // without three transactions fighting over PGlite's single connection.
    // Chunked rather than `Promise.all` over all of them because scrypt at
    // N=2^17 holds ~134 MB per derivation.
    for (const chunk of chunked(corpus.people, 3)) {
      const registered = await Promise.all(
        chunk.map((person) =>
          users.register({
            email: person.email,
            password: person.password,
            displayName: person.displayName,
            ...(person.handle === undefined ? {} : { handle: person.handle }),
          }),
        ),
      );
      chunk.forEach((person, index) => {
        const result = registered[index]!;
        userIdByKey.set(person.key, result.user.id);
        if (person.handle !== undefined) channelIdByKey.set(person.key, result.channel.id);
      });
    }
    log(`registered ${userIdByKey.size} accounts`);

    for (const channel of corpus.channels) {
      const channelId = channelIdByKey.get(channel.ownerKey);
      if (channelId === undefined) {
        throw new Error(`Channel ${channel.handle} has no registered owner.`);
      }
      channelIdByKey.set(channel.key, channelId);

      const art = await browser.renderChannelArt({
        name: channel.name,
        monogram: channel.monogram,
        palette: channel.palette,
      });
      const stored = await thumbnails.storeChannelArt(store, channelId, art);
      totals.bytes += stored.bytes;

      // `register` names the channel after the person; a channel is its own
      // brand, so the name, the description and the art are set here.
      await channels.update(channelId, {
        name: channel.name,
        description: channel.description,
        avatarKey: stored.avatarKey,
        bannerKey: stored.bannerKey,
      });
    }
    log(`created ${corpus.channels.length} channels with generated avatars and banners`);

    /* ---------------------------------------------------------------- videos -- */

    for (const [index, video] of corpus.videos.entries()) {
      const channelId = channelIdByKey.get(video.channelKey)!;
      const clipStartedAt = Date.now();

      await videosRepo.createVideo(db, {
        id: video.id,
        channelId,
        title: video.title,
        description: video.description,
        category: video.category,
        tags: video.tags,
        pipeline: video.pipeline,
        durationSeconds: video.clip.durationSeconds,
        width: video.clip.width,
        height: video.clip.height,
      });

      const poster = thumbnails.posterSize(video.clip.width, video.clip.height);
      const encoding = await browser.encodeClip(
        generateClips.clipRequest({
          spec: video.clip,
          ladderRungs: corpusModule.SEED_LADDER_RUNGS,
          posterAtSeconds: video.thumbnailAtSeconds,
          posterWidth: poster.width,
          posterHeight: poster.height,
          previewStartSeconds: video.previewStartSeconds,
          previewSeconds: video.previewSeconds,
        }),
      );
      totals.encodeMs += encoding.elapsedMs;

      const published = await publishMedia({
        video,
        encoding,
        store,
        blobKeys,
        muxer,
        packager,
      });
      totals.segments += published.segmentCount;
      totals.bytes += published.bytes;

      const thumbnail = await thumbnails.storeThumbnail(store, video.id, encoding.posterJpeg);
      const preview = await thumbnails.storePreview(store, video.id, encoding.preview);
      totals.bytes += thumbnail.bytes + preview.bytes;

      if (video.pipeline === "progressive") {
        const source = await thumbnails.storeProgressiveSource(
          store,
          video.id,
          encoding.renditions[0]!,
        );
        totals.bytes += source.bytes;
        await videosRepo.updateVideo(db, video.id, {
          progressiveKey: source.key,
          thumbnailKey: thumbnail.key,
          previewKey: preview.key,
          durationSeconds: published.durationSeconds,
        });
      } else {
        await videosRepo.replaceRenditions(db, video.id, published.renditions);
        await videosRepo.updateVideo(db, video.id, {
          masterPlaylistKey: published.masterKey!,
          thumbnailKey: thumbnail.key,
          previewKey: preview.key,
          durationSeconds: published.durationSeconds,
        });
      }

      /**
       * Caption tracks — the `.vtt` in the store, then the row that names it.
       *
       * In that order, and the order matters for the same reason the segment
       * writes come before `publishVideo`: a row pointing at a key that is not
       * there yet is a 404 inside a `<track>`, which the player reports as a
       * caption failure rather than as a missing file.
       *
       * `serialiseVtt` is `src/domain/captions.ts`'s own writer, so the seed
       * exercises the same code the uploader path would — a hand-rolled
       * template here would be a second WebVTT emitter, and the one thing that
       * file is most careful about (§1.2's two-digit minutes) is exactly what a
       * template gets wrong.
       */
      for (const track of video.captions) {
        const key = blobKeys.captions(video.id, track.language, track.source);
        const vtt = vttModule.serialiseVtt({
          cues: track.cues.map((cue, cueIndex) => ({
            id: String(cueIndex + 1),
            startSeconds: cue.atSeconds,
            endSeconds: cue.atSeconds + cue.seconds,
            settings: {},
            text: cue.text,
          })),
        });
        const bytes = new TextEncoder().encode(vtt);
        await store.put(key, bytes, { contentType: "text/vtt", immutable: true });
        totals.bytes += bytes.byteLength;
        totals.captions += 1;

        const input = {
          videoId: video.id,
          language: track.language,
          label: track.label,
          blobKey: key,
        };
        if (track.source === "uploaded") {
          await captionsRepo.addUploadedCaptionTrack(db, input);
        } else {
          await captionsRepo.addAutomaticCaptionTrack(db, input);
        }
      }

      await videosRepo.publishVideo(db, video.id);
      totals.clips += 1;

      log(
        `[${String(index + 1).padStart(2)}/${corpus.videos.length}] ${video.id} ` +
          `${video.title.slice(0, 44).padEnd(44)} ` +
          `${published.renditions.map((r) => r.name).join("+") || "progressive"} ` +
          `${String(published.segmentCount).padStart(3)} segs ` +
          `${formatBytes(published.bytes)} in ${Date.now() - clipStartedAt} ms`,
      );
    }
  } finally {
    await browser.close();
  }

  /* -------------------------------------------------------------- the social -- */

  for (const subscription of corpus.subscriptions) {
    await subscriptionsRepo.subscribe(
      db,
      userIdByKey.get(subscription.subscriberKey)!,
      channelIdByKey.get(subscription.channelKey)!,
      subscription.notifications,
    );
  }
  log(`wrote ${corpus.subscriptions.length} subscriptions`);

  for (const reaction of corpus.reactions) {
    await reactionsRepo.reactToVideo(
      db,
      userIdByKey.get(reaction.viewerKey)!,
      reaction.videoId,
      reaction.value,
    );
  }
  log(`wrote ${corpus.reactions.length} video reactions (and the liked playlists behind them)`);

  const commentIds: { id: string; createdAtMs: number; likeCount: number }[] = [];
  for (const comment of corpus.comments) {
    const created = await commentsRepo.addComment(db, {
      videoId: comment.videoId,
      authorId: userIdByKey.get(comment.authorKey)!,
      body: comment.body,
    });
    commentIds.push({
      id: created.id,
      createdAtMs: comment.createdAtMs,
      likeCount: comment.likeCount,
    });

    if (comment.pinned) await commentsRepo.pinComment(db, created.id);
    if (comment.hearted) await commentsRepo.setHearted(db, created.id, true);

    for (const reply of comment.replies) {
      const wrote = await commentsRepo.addComment(db, {
        videoId: comment.videoId,
        authorId: userIdByKey.get(reply.authorKey)!,
        parentId: created.id,
        body: reply.body,
      });
      commentIds.push({
        id: wrote.id,
        createdAtMs: reply.createdAtMs,
        likeCount: reply.likeCount,
      });
    }
  }
  log(`wrote ${commentIds.length} comments across ${corpus.comments.length} threads`);

  for (const playlist of corpus.playlists) {
    const created = await playlistsRepo.createPlaylist(db, {
      ownerId: userIdByKey.get(playlist.ownerKey)!,
      title: playlist.title,
      description: playlist.description,
      visibility: playlist.visibility,
    });
    for (const videoId of playlist.videoIds) {
      await playlistsRepo.addVideo(db, created.id, videoId);
    }
    // A couple of viewers with a populated Watch Later, so that surface is not
    // the only empty page in the application.
    if (playlist.ownerKey.startsWith("viewer:")) {
      for (const videoId of playlist.videoIds.slice(0, 3)) {
        await playlistsRepo.addToWatchLater(db, userIdByKey.get(playlist.ownerKey)!, videoId);
      }
    }
  }
  log(`wrote ${corpus.playlists.length} playlists`);

  /* ------------------------------------------------------- the watch history -- */

  let watches = 0;
  for (const session of corpus.sessions) {
    for (const [position, videoId] of session.videoIds.entries()) {
      await watchEventsRepo.recordWatch(
        {
          sessionKey: session.key,
          videoId,
          userId:
            session.viewerKey === null ? null : (userIdByKey.get(session.viewerKey) ?? null),
          watchedSeconds: session.watchedSeconds[position] ?? 0,
          // Spread within the session so the history page's ordering is a real
          // ordering. `recordWatch` requires this rather than defaulting to
          // `now()` precisely so a fixture cannot make itself non-deterministic.
          watchedAt: new Date(session.watchedAtMs + position * 4 * 60_000),
        },
        db,
      );
      watches += 1;
    }
  }
  // The incremental refresh inside `recordWatch` has already maintained
  // `related_videos`; running the full rebuild once afterwards is the
  // definition the incremental version has to match, and a corpus that
  // disagreed with it would be the cheapest possible way to find that out.
  await watchEventsRepo.refreshRelatedVideos(db);
  log(`recorded ${watches} watches across ${corpus.sessions.length} sessions`);

  /* -------------------------------------------------------------- content id -- */

  const work = corpus.referenceWork;
  const registered = await contentIdRepo.registerWork(db, {
    title: work.title,
    rightsHolder: work.rightsHolder,
    policy: work.policy,
    videoId: work.originVideoId,
    durationSeconds: work.durationSeconds,
  });

  const referencePcm = synthesise.clipPcm(
    work.audio,
    work.durationSeconds,
    fingerprintModule.SAMPLE_RATE,
  );
  const referencePrint = fingerprintModule.fingerprint(referencePcm);
  const landmarks = await contentIdRepo.storeFingerprint(db, registered.id, referencePrint);

  let claimed = 0;
  for (const reuse of work.reuse) {
    const video = corpus.videos.find((candidate) => candidate.id === reuse.videoId);
    if (video === undefined) continue;
    const queryPcm = synthesise.clipPcm(
      video.clip.audio,
      video.clip.durationSeconds,
      fingerprintModule.SAMPLE_RATE,
    );
    const claims = await contentIdRepo.scanVideo(
      db,
      video.id,
      // Four sub-hop alignments on the query side. `domain/fingerprint`'s header
      // measures the cost of skipping this: a query cut from an arbitrary sample
      // offset keeps 6% of its matching tokens at the worst displacement and 94%
      // at the best, a factor of sixteen from nothing but where the cut fell.
      fingerprintModule.fingerprint(queryPcm, { shifts: fingerprintModule.QUERY_SHIFTS }),
    );
    claimed += claims.length;
    for (const claim of claims) {
      log(
        `content id: ${claim.policy} claim on ${claim.videoId} — score ${claim.score}, ` +
          `${claim.matchStartMs}–${claim.matchEndMs} ms against reference offset ` +
          `${claim.referenceOffsetMs} ms`,
      );
    }
  }
  log(`registered "${work.title}" (${landmarks} landmarks), raised ${claimed} claims`);
  // Only a *scanned* video that raised nothing is a finding. With `--videos=N`
  // small enough to filter the reusing clip out of the corpus there is nothing
  // to claim against, and warning there would train the reader to ignore this.
  if (claimed === 0 && work.reuse.length > 0) {
    log(
      "WARNING: the shared passage produced no claim. The corpus asserts the two " +
        "clips contain the same audio, so a score below MATCH_SCORE_THRESHOLD " +
        "here is a fingerprinting regression, not a corpus one.",
    );
  }

  /* ----------------------------------------------------------- corpus facts -- */

  await stampCorpusFacts(db, corpus, commentIds);

  /* ----------------------------------------------------------------- search -- */

  const index = new searchModule.PostgresSearchIndex(db);
  const channelNameOf = new Map(corpus.channels.map((channel) => [channel.key, channel.name]));
  await index.indexMany([
    ...corpus.videos.map((video) => ({
      id: video.id,
      kind: "video" as const,
      title: video.title,
      description: video.description,
      channelName: channelNameOf.get(video.channelKey) ?? "",
      tags: video.tags,
      publishedAt: new Date(video.publishedAtMs),
      viewCount: video.viewCount,
      likeCount: video.likeCount,
      dislikeCount: video.dislikeCount,
      durationSeconds: video.clip.durationSeconds,
    })),
    ...corpus.channels.map((channel) => ({
      id: channelIdByKey.get(channel.key)!,
      kind: "channel" as const,
      title: channel.name,
      description: channel.description,
      channelName: channel.name,
      tags: [`@${channel.handle}`],
      // A channel has no publication date; the corpus's own clock stands in, so
      // the recency term in `search/postgres.ts` treats every channel alike
      // instead of sinking them all to the `'epoch'` fallback.
      publishedAt: new Date(corpus.nowMs),
      viewCount: 0,
      likeCount: 0,
      dislikeCount: 0,
      durationSeconds: 0,
    })),
  ]);
  log(`indexed ${corpus.videos.length + corpus.channels.length} search documents`);

  /* ---------------------------------------------------------------- summary -- */

  const elapsed = Date.now() - startedAt;
  log("");
  log(`seeded in ${(elapsed / 1000).toFixed(1)} s`);
  log(
    `  ${totals.clips} clips, ${totals.segments} media segments, ` +
      `${totals.captions} caption tracks, ${formatBytes(totals.bytes)} of blobs`,
  );
  log(`  ${(totals.encodeMs / 1000).toFixed(1)} s of that was in-page encoding`);
  log(`  sign in as ${corpus.people[0]?.email} / ${corpusModule.SEED_PASSWORD}`);

  await db.close();
}

/* ======================================================== media publishing == */

/** Exactly the shape `replaceRenditions` writes into `video_renditions`. */
interface RenditionRow {
  name: string;
  width: number;
  height: number;
  bandwidth: number;
  codec: string;
  frameRate: number;
  initKey: string;
  playlistKey: string;
  segmentCount: number;
  totalBytes: number;
}

interface PublishResult {
  readonly renditions: readonly RenditionRow[];
  readonly masterKey: string | null;
  readonly segmentCount: number;
  readonly bytes: number;
  readonly durationSeconds: number;
}

/**
 * Mux, package and store one video's ladder.
 *
 * Three properties are worth naming because each is invisible when wrong:
 *
 *  - **One `TrackMuxer` per rendition, reused across its segments.** The muxer's
 *    header explains why: the decode clock has to run continuously, and the
 *    tempting `baseMediaDecodeTime = index × nominalDuration` is correct right
 *    up until the final short segment, after which audio walks away from video.
 *  - **`initSegment()` after every `packageSegment()`.** An init segment built
 *    first declares a duration of zero, which is legal and is what a live
 *    stream writes; built last, it declares what the clock accumulated. A VOD
 *    playlist whose init segment says zero plays and cannot be scrubbed.
 *  - **`BANDWIDTH` is measured, not requested.** `schema.sql` is emphatic about
 *    this: the player's ABR compares the number in `EXT-X-STREAM-INF` against
 *    measured throughput, so an aspirational figure makes every switching
 *    decision wrong. It is the peak segment's bits per second here, and
 *    `AVERAGE-BANDWIDTH` is the mean, which is exactly what RFC 8216 defines
 *    them as.
 */
async function publishMedia(input: {
  video: { id: string; pipeline: string; clip: { frameRate: number } };
  encoding: import("./seed/generate-clips").ClipEncoding;
  store: import("@/ports/blob-store").BlobStore;
  blobKeys: typeof import("@/ports/blob-store").blobKeys;
  muxer: typeof import("@/media/muxer");
  packager: typeof import("@/media/packager");
}): Promise<PublishResult> {
  const { video, encoding, store, blobKeys, muxer, packager } = input;

  // The progressive path stores one whole file and nothing else: no ladder, no
  // playlist, no `video_renditions` rows. `videos.pipeline` is load-bearing and
  // the player branches on it, so writing an HLS ladder for a video that will
  // never be asked for one would be an artefact nothing reads and everything
  // has to explain. The duration still has to be real, so it is read off the
  // encode's own timeline rather than off the clip spec.
  if (video.pipeline === "progressive") {
    const top = encoding.renditions[0];
    if (top === undefined) {
      throw new Error(`The progressive video ${video.id} produced no rendition to store.`);
    }
    const spanUs = top.segments.reduce((total, segment) => total + segment.durationUs, 0);
    return {
      renditions: [],
      masterKey: null,
      segmentCount: 0,
      bytes: 0,
      durationSeconds: spanUs / 1e6,
    };
  }

  const renditions: RenditionRow[] = [];
  const variants: {
    rung: { name: string; width: number; height: number; bitrate: number; codec: string };
    uri: string;
    bandwidth: number;
    averageBandwidth: number;
    frameRate: number;
  }[] = [];
  let totalBytes = 0;
  let totalSegments = 0;
  let durationSeconds = 0;

  for (const rendition of encoding.renditions) {
    const stored = await storeRendition({
      videoId: video.id,
      name: rendition.rung.name,
      track: rendition.track,
      segments: rendition.segments,
      store,
      blobKeys,
      muxer,
      packager,
    });

    totalBytes += stored.bytes;
    totalSegments += stored.segmentCount;
    durationSeconds = Math.max(durationSeconds, stored.durationSeconds);

    renditions.push({
      name: rendition.rung.name,
      width: rendition.rung.width,
      height: rendition.rung.height,
      bandwidth: stored.peakBitsPerSecond,
      codec: rendition.track.codec,
      frameRate: video.clip.frameRate,
      initKey: stored.initKey,
      playlistKey: stored.playlistKey,
      segmentCount: stored.segmentCount,
      totalBytes: stored.bytes,
    });

    variants.push({
      rung: rendition.rung,
      uri: `${rendition.rung.name}/index.m3u8`,
      bandwidth: stored.peakBitsPerSecond,
      averageBandwidth: stored.averageBitsPerSecond,
      frameRate: video.clip.frameRate,
    });
  }

  let audioGroup:
    | { groupId: string; name: string; uri: string; codec: string; channels: string; bitrate: number }
    | undefined;

  if (encoding.audio !== null) {
    const stored = await storeRendition({
      videoId: video.id,
      name: "audio",
      track: encoding.audio.track,
      segments: encoding.audio.segments,
      store,
      blobKeys,
      muxer,
      packager,
    });
    totalBytes += stored.bytes;
    totalSegments += stored.segmentCount;
    audioGroup = {
      groupId: "aac",
      name: "English",
      uri: "audio/index.m3u8",
      codec: encoding.audio.track.codec,
      channels: String(encoding.audio.track.channelCount ?? 2),
      bitrate: stored.averageBitsPerSecond,
    };
  }

  const master = packager.buildLadderMaster({
    variants,
    ...(audioGroup === undefined ? {} : { audio: audioGroup }),
  });
  const masterKey = blobKeys.masterPlaylist(video.id);
  const masterBytes = new TextEncoder().encode(master);
  await store.put(masterKey, masterBytes, {
    contentType: "application/vnd.apple.mpegurl",
    contentLength: masterBytes.byteLength,
    immutable: true,
  });
  totalBytes += masterBytes.byteLength;

  return {
    renditions,
    masterKey,
    segmentCount: totalSegments,
    bytes: totalBytes,
    durationSeconds,
  };
}

/** Mux one track's segments, store them, and write its media playlist. */
async function storeRendition(input: {
  videoId: string;
  name: string;
  track: import("@/media/types").TrackConfig;
  segments: readonly import("./seed/generate-clips").EncodedSegment[];
  store: import("@/ports/blob-store").BlobStore;
  blobKeys: typeof import("@/ports/blob-store").blobKeys;
  muxer: typeof import("@/media/muxer");
  packager: typeof import("@/media/packager");
}): Promise<{
  initKey: string;
  playlistKey: string;
  segmentCount: number;
  bytes: number;
  durationSeconds: number;
  peakBitsPerSecond: number;
  averageBitsPerSecond: number;
}> {
  const { videoId, name, track, store, blobKeys, muxer, packager } = input;
  const ordered = [...input.segments].sort((a, b) => a.index - b.index);

  const trackMuxer = new muxer.TrackMuxer({ config: track, trackId: 1 });
  const packaged = ordered.map((segment) => trackMuxer.packageSegment(segment.samples));

  let bytes = 0;
  let peak = 0;
  const playlistSegments: { uri: string; durationSeconds: number }[] = [];

  for (const [index, segment] of packaged.entries()) {
    const key = blobKeys.segment(videoId, name, index);
    await store.put(key, segment.data, {
      contentType: "video/iso.segment",
      contentLength: segment.data.byteLength,
      immutable: true,
    });
    bytes += segment.data.byteLength;
    if (segment.durationSeconds > 0) {
      peak = Math.max(peak, (segment.data.byteLength * 8) / segment.durationSeconds);
    }
    // The URI is relative to the playlist, which lives in the same prefix. An
    // absolute key here would bake the store's layout into the manifest and
    // break the moment R2 fronts it on a different path.
    playlistSegments.push({
      uri: `seg-${String(index).padStart(5, "0")}.m4s`,
      durationSeconds: segment.durationSeconds,
    });
  }

  const initKey = blobKeys.init(videoId, name);
  const init = trackMuxer.initSegment();
  await store.put(initKey, init, {
    contentType: "video/mp4",
    contentLength: init.byteLength,
    immutable: true,
  });
  bytes += init.byteLength;

  const playlist = packager.buildMediaPlaylist({
    segments: playlistSegments,
    initSegmentUri: "init.mp4",
    playlistType: "VOD",
    endList: true,
  });
  const playlistKey = blobKeys.mediaPlaylist(videoId, name);
  const playlistBytes = new TextEncoder().encode(playlist);
  await store.put(playlistKey, playlistBytes, {
    contentType: "application/vnd.apple.mpegurl",
    contentLength: playlistBytes.byteLength,
    immutable: true,
  });
  bytes += playlistBytes.byteLength;

  const durationSeconds = packaged.reduce((total, segment) => total + segment.durationSeconds, 0);
  const mediaBytes = bytes - init.byteLength - playlistBytes.byteLength;

  return {
    initKey,
    playlistKey,
    segmentCount: packaged.length,
    bytes,
    durationSeconds,
    peakBitsPerSecond: Math.max(1, Math.round(peak)),
    averageBitsPerSecond: Math.max(
      1,
      Math.round(durationSeconds > 0 ? (mediaBytes * 8) / durationSeconds : 0),
    ),
  };
}

/* ========================================================== corpus facts == */

/**
 * The columns the repositories cannot set, written in one place.
 *
 * Every other row in this script goes through a repository, which is how it
 * should be — the repositories hold the invariants, and a seed script that
 * inserted around them would be seeding a state the application cannot produce.
 * These four are different: they are not invariants, they are *facts about the
 * past*, and every write path in `src/adapters/repositories` is written for an
 * application that accumulates them one event at a time.
 *
 * Named individually, because each is a gap somebody could close:
 *
 *  - **`videos.published_at`.** `publishVideo` writes `coalesce(published_at,
 *    now())` and `VideoPatch` has no `publishedAt`. Without a backdate every
 *    video in the corpus is published in the same second, `order by published_at
 *    desc` degenerates to the id tiebreak, and every card reads "0 seconds ago".
 *  - **`videos.view_count` / `like_count` / `dislike_count`.** `recordView`
 *    increments by one and `reactToVideo` needs a distinct account per like.
 *    A power-law corpus tops out at ~1.2M views on one video; producing that
 *    through the write path is 1.2M statements.
 *  - **`comments.created_at` / `like_count`.** `addComment` takes no timestamp,
 *    so an entire thread is written in one millisecond and reads as a
 *    conversation that happened instantaneously.
 *  - **`watch_progress`.** `history.ts` is read-only and `watch-events.ts`
 *    writes only the event log. Nothing in `src/` writes the row that draws the
 *    red bar under a thumbnail or fills the "Continue watching" shelf.
 *
 * The alternative — leaving them unset and reporting the gap — was rejected
 * because it makes the corpus fail its own brief: a library whose every upload
 * date is "just now" and whose every view count is a handful is exactly the
 * fixture-shaped result this slice exists not to produce. The gap is reported
 * as well.
 */
async function stampCorpusFacts(
  db: import("@/adapters/db").SqlDatabase,
  corpus: import("./seed/corpus").Corpus,
  comments: readonly { id: string; createdAtMs: number; likeCount: number }[],
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const video of corpus.videos) {
      await tx.execute(
        `update videos
            set published_at  = $2::timestamptz,
                view_count    = $3,
                like_count    = greatest(like_count, $4),
                dislike_count = greatest(dislike_count, $5)
          where id = $1`,
        [
          video.id,
          new Date(video.publishedAtMs).toISOString(),
          video.viewCount,
          // `greatest`, so the real `reactions` rows written through
          // `reactToVideo` are never *lowered* by the display figure. The two
          // counts have to agree in the direction that matters: every like
          // button that is lit corresponds to a row, and the surplus is the
          // anonymous majority who are not in this corpus.
          video.likeCount,
          video.dislikeCount,
        ],
      );
    }

    for (const comment of comments) {
      await tx.execute(`update comments set created_at = $2::timestamptz, like_count = $3 where id = $1`, [
        comment.id,
        new Date(comment.createdAtMs).toISOString(),
        comment.likeCount,
      ]);
    }
  });

  await db.transaction(async (tx) => {
    for (const entry of corpus.progress) {
      const userId = await userIdFor(tx, corpus, entry.viewerKey);
      await tx.execute(
        `insert into watch_progress (user_id, video_id, position_seconds, completed, updated_at)
         values ($1, $2, $3, $4, $5::timestamptz)
         on conflict (user_id, video_id) do update
            set position_seconds = excluded.position_seconds,
                completed        = excluded.completed,
                updated_at       = excluded.updated_at`,
        [
          userId,
          entry.videoId,
          entry.positionSeconds,
          entry.completed,
          new Date(entry.updatedAtMs).toISOString(),
        ],
      );
    }
  });
}

async function userIdFor(
  tx: import("@/adapters/db").SqlExecutor,
  corpus: import("./seed/corpus").Corpus,
  key: string,
): Promise<string> {
  const person = corpus.people.find((candidate) => candidate.key === key);
  if (person === undefined) throw new Error(`No corpus person keyed ${key}.`);
  const rows = await tx.query<{ id: string }>(
    `select id from users where lower(email) = lower($1)`,
    [person.email],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`Account ${person.email} was never registered.`);
  return id;
}

/* =============================================================== helpers == */

/**
 * Narrow the corpus to its first `limit` videos, keeping it internally
 * consistent.
 *
 * A development flag, and the filtering is the whole of it: comments, sessions,
 * playlists and progress all name video ids, and dropping videos without
 * dropping the rows that reference them turns `--videos=3` into a foreign-key
 * violation forty lines later.
 */
function filterCorpus(
  corpus: import("./seed/corpus").Corpus,
  limit: number | undefined,
): import("./seed/corpus").Corpus {
  if (limit === undefined || limit >= corpus.videos.length) return corpus;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`--videos expects a positive integer; got ${String(limit)}`);
  }

  const videos = corpus.videos.slice(0, limit);
  const kept = new Set(videos.map((video) => video.id));
  const keep = (id: string): boolean => kept.has(id);

  const reuse = corpus.referenceWork.reuse.filter((entry) => keep(entry.videoId));
  return {
    ...corpus,
    videos,
    comments: corpus.comments.filter((comment) => keep(comment.videoId)),
    reactions: corpus.reactions.filter((reaction) => keep(reaction.videoId)),
    progress: corpus.progress.filter((entry) => keep(entry.videoId)),
    playlists: corpus.playlists.map((playlist) => ({
      ...playlist,
      videoIds: playlist.videoIds.filter(keep),
    })),
    sessions: corpus.sessions
      .map((session) => {
        const videoIds = session.videoIds.filter(keep);
        return {
          ...session,
          videoIds,
          watchedSeconds: session.videoIds
            .map((id, index) => [id, session.watchedSeconds[index] ?? 0] as const)
            .filter(([id]) => keep(id))
            .map(([, seconds]) => seconds),
        };
      })
      .filter((session) => session.videoIds.length > 0),
    referenceWork: {
      ...corpus.referenceWork,
      reuse: keep(corpus.referenceWork.originVideoId) ? reuse : [],
    },
  };
}

function chunked<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

await main().catch((error: unknown) => {
  process.stderr.write(`\nseed failed: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
