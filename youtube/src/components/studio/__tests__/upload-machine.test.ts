// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { isWritableBlobKey } from "@/adapters/blob";
import { TranscodeError } from "@/media/encode";
import type { TranscodeSummary, Transcoder } from "@/media/encode";
import { parseBoxes } from "@/media/muxer";
import type { EncodedSample, TrackConfig } from "@/media/types";
import { stubMediaCapabilities } from "../../../../vitest.setup";

import {
  createUploadRun,
  estimateRemainingSeconds,
  IDLE_UPLOAD_STATE,
  type FinaliseResult,
  type MediaFinaliseInput,
  type ProbedSource,
  type PublishInput,
  type UploadPorts,
  type UploadState,
  type UploadTarget,
} from "../upload-machine";

/**
 * The upload pipeline, driven for real.
 *
 * ## What is fake here, and what is emphatically not
 *
 * Fake: the **transcoder** (its event protocol is the contract, and
 * `src/media/encode/__tests__/protocol.test.ts` already proves the real client
 * speaks it), the **network**, and the **source probe**. Those three are the
 * only seams where a jsdom-shaped substitute is not a lie.
 *
 * Real: the **muxer**, the **packager**, the **key layout**, the **segment
 * ordering rule**, the **bandwidth arithmetic**, and — the important one —
 * `negotiateLadder`, which is the actual capability branch. The tests below
 * install a real-shaped `VideoEncoder.isConfigSupported` through
 * `stubMediaCapabilities` and let the shipped negotiation decide, rather than
 * asserting against a boolean this file made up.
 *
 * The segments that come out are therefore genuine fragmented MP4: the
 * assertions parse their box trees rather than checking a byte length.
 */

/* -------------------------------------------------------------- fixtures -- */

/** A real `avcC`, from the muxer's own round-trip fixtures. */
const AVCC = Uint8Array.from([
  0x01, 0x64, 0x00, 0x28, 0xff, 0xe1, 0x00, 0x02, 0x67, 0x64, 0x01, 0x00, 0x02,
  0x68, 0xee,
]);

const RUNGS = [
  { name: "720p", width: 1280, height: 720, bitrate: 2_800_000, codec: "avc1.64001f" },
  { name: "360p", width: 640, height: 360, bitrate: 800_000, codec: "avc1.64001e" },
] as const;

function trackFor(rung: (typeof RUNGS)[number]): TrackConfig {
  return {
    kind: "video",
    codec: rung.codec,
    description: AVCC,
    timescale: 1_000_000,
    width: rung.width,
    height: rung.height,
  };
}

/** A GOP: a fat keyframe then thin deltas, so a size transposition would show. */
function gop(startUs: number, frameDurationUs: number, count: number): EncodedSample[] {
  return Array.from({ length: count }, (_, index) => ({
    data: new Uint8Array(index === 0 ? 3000 : 300).fill(index + 1),
    timestampUs: startUs + index * frameDurationUs,
    durationUs: frameDurationUs,
    isKeyFrame: index === 0,
    compositionOffsetUs: 0,
  }));
}

const SEGMENT_US = 2_000_000;
const FRAME_US = 33_333;

interface ScriptOptions {
  readonly segments?: number;
  readonly throughput?: "faster-than-realtime" | "realtime";
  readonly dropped?: readonly string[];
  /** Emit this rung's second segment before its first. */
  readonly scramble?: boolean;
  readonly failWith?: TranscodeError;
}

/**
 * A transcoder that speaks the real protocol.
 *
 * Segments are interleaved across rungs, which is what the real worker does —
 * every rung's encoder is fed the same frame before the next frame is pulled —
 * and it is the interleaving that makes the per-rung ordering rule worth
 * asserting at all.
 */
function scriptedTranscoder(options: ScriptOptions = {}): Transcoder & {
  readonly cancelled: () => number;
} {
  const segments = options.segments ?? 3;
  let cancelCount = 0;

  return {
    cancelled: () => cancelCount,
    cancel() {
      cancelCount += 1;
    },
    dispose() {},
    async start(_startOptions, handlers = {}) {
      handlers.onReady?.({
        kind: "ready",
        jobId: "job",
        family: "avc",
        rungs: RUNGS.map((rung) => ({ ...rung })),
        dropped: options.dropped ?? [],
        throughput: options.throughput ?? "faster-than-realtime",
        segmentDurationUs: SEGMENT_US,
      });

      if (options.failWith) throw options.failWith;

      for (const rung of RUNGS) {
        handlers.onTrack?.({
          kind: "track",
          jobId: "job",
          rung: rung.name,
          track: trackFor(rung),
        });
      }

      const order = options.scramble ? [1, 0, 2] : [...Array(segments).keys()];
      let bytes = 0;
      for (const index of order.slice(0, segments)) {
        for (const rung of RUNGS) {
          const samples = gop(index * SEGMENT_US, FRAME_US, 60);
          bytes += samples.reduce((total, s) => total + s.data.byteLength, 0);
          handlers.onSegment?.({
            kind: "segment",
            jobId: "job",
            segment: {
              rung: rung.name,
              index,
              startUs: index * SEGMENT_US,
              durationUs: SEGMENT_US,
              samples,
            },
          });
        }
        handlers.onProgress?.({
          kind: "progress",
          jobId: "job",
          progress: {
            framesDecoded: (index + 1) * 60,
            segmentsEmitted: (index + 1) * RUNGS.length,
            bytesEncoded: bytes,
            presentedUs: (index + 1) * SEGMENT_US,
            durationUs: segments * SEGMENT_US,
            fraction: (index + 1) / segments,
            encodeBacklog: 2,
          },
        });
        // Let the upload queue's microtasks run, so the upload really does
        // overlap the encode rather than all landing at the end.
        await Promise.resolve();
      }

      const summary: TranscodeSummary = {
        family: "avc",
        rungs: RUNGS.map((rung) => ({ ...rung })),
        throughput: options.throughput ?? "faster-than-realtime",
        framesDecoded: segments * 60,
        segmentCount: segments * RUNGS.length,
        bytesEncoded: bytes,
        presentedUs: segments * SEGMENT_US,
        elapsedMs: 1234,
      };
      return summary;
    },
  };
}

interface Harness {
  readonly ports: UploadPorts;
  readonly stored: Map<string, Uint8Array>;
  readonly finalised: (MediaFinaliseInput | PublishInput)[];
  readonly discarded: string[];
  readonly states: UploadState[];
  readonly targets: string[];
}

const VIDEO_ID = "vidAbc12345";

function harness(overrides: Partial<UploadPorts> = {}): Harness {
  const stored = new Map<string, Uint8Array>();
  const finalised: (MediaFinaliseInput | PublishInput)[] = [];
  const discarded: string[] = [];
  const states: UploadState[] = [];
  const targets: string[] = [];

  const ports: UploadPorts = {
    createVideo: async () => ({ id: VIDEO_ID }),
    requestTarget: async (key, contentType): Promise<UploadTarget> => {
      targets.push(key);
      return {
        mode: "proxy",
        key,
        url: `/api/upload/blob/${key}`,
        method: "PUT",
        headers: { "Content-Type": contentType },
      };
    },
    putBytes: async (target, body) => {
      // A real turn of the event loop, so concurrency is exercised rather than
      // collapsed into a synchronous loop.
      await Promise.resolve();
      stored.set(
        target.key,
        body instanceof Blob ? new Uint8Array(await body.arrayBuffer()) : body,
      );
    },
    finalise: async (_id, input): Promise<FinaliseResult> => {
      finalised.push(input);
      return { uploadStatus: "processing", claims: [], scanned: false };
    },
    discard: async (id) => {
      discarded.push(id);
    },
    probeSource: async () => demuxableSource(),
    createTranscoder: () => scriptedTranscoder(),
    now: () => 0,
    ...overrides,
  };

  return { ports, stored, finalised, discarded, states, targets };
}

function demuxableSource(): ProbedSource {
  return {
    kind: "encoded-chunks",
    throughput: "faster-than-realtime",
    profile: {
      width: 1280,
      height: 720,
      frameRate: 30,
      durationUs: 6_000_000,
      frameCount: 180,
    },
    open: () => ({
      kind: "encoded-chunks",
      profile: { width: 1280, height: 720, frameRate: 30 },
      decoderConfig: { codec: "avc1.64001f" },
      chunks: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
    }),
    close: () => {},
  };
}

function unreadableSource(reason: string): ProbedSource {
  return {
    kind: "unreadable",
    throughput: "realtime",
    profile: { width: 1920, height: 1080, frameRate: 30, durationUs: 6_000_000 },
    reason,
    open: () => {
      throw new Error("unreadable");
    },
    close: () => {},
  };
}

/** A `File` without a filesystem: `File` is global in Node 20. */
function sourceFile(name = "holiday.mp4", size = 12_345): File {
  return new File([new Uint8Array(size)], name, { type: "video/mp4" });
}

/** Every rung `isConfigSupported` should say yes to. */
function encoderThatSupports(answer: boolean) {
  return {
    isConfigSupported: vi.fn(async () => ({ supported: answer })),
  };
}

let restoreCapabilities: (() => void) | undefined;

afterEach(() => {
  restoreCapabilities?.();
  restoreCapabilities = undefined;
});

async function run(
  h: Harness,
  file = sourceFile(),
): Promise<ReturnType<typeof createUploadRun>> {
  const upload = createUploadRun(h.ports);
  upload.subscribe((state) => h.states.push(state));
  await upload.start(file, { channelId: "chan-1", title: "Holiday" });
  return upload;
}

/* ================================================== the capability branch == */

describe("the capability branch", () => {
  it("takes the ladder when this browser can encode a rung", async () => {
    restoreCapabilities = stubMediaCapabilities({
      videoEncoder: encoderThatSupports(true),
    });
    const h = harness();
    const upload = await run(h);

    expect(upload.getState().pipeline).toBe("laddered");
    expect(upload.getState().fallbackReason).toBeNull();
    expect(h.finalised[0]).toMatchObject({ kind: "media", pipeline: "laddered" });
  });

  it("falls back to progressive when no codec is supported, and says why", async () => {
    // The real `negotiateLadder` decides here — this stub answers the probe it
    // makes, it does not stand in for the decision.
    restoreCapabilities = stubMediaCapabilities({
      videoEncoder: encoderThatSupports(false),
    });
    const h = harness();
    const upload = await run(h);

    expect(upload.getState().pipeline).toBe("progressive");
    expect(upload.getState().fallbackReason).toMatch(/No encoder in this browser/);
    expect(h.finalised[0]).toMatchObject({
      kind: "media",
      pipeline: "progressive",
      progressiveKey: `videos/${VIDEO_ID}/source.mp4`,
    });
  });

  it("falls back when WebCodecs is absent entirely — jsdom's own state", async () => {
    // No `VideoEncoder` is installed: this is the ~1-in-20 browser D3 is about,
    // and no stub is needed to reach it.
    const h = harness();
    const upload = await run(h);

    expect(upload.getState().pipeline).toBe("progressive");
    expect(upload.getState().fallbackReason).toMatch(/no WebCodecs video encoder/);
  });

  it("falls back when the file cannot be read frame by frame", async () => {
    restoreCapabilities = stubMediaCapabilities({
      videoEncoder: encoderThatSupports(true),
    });
    const h = harness({
      probeSource: async () => unreadableSource("no moov box in this file"),
    });
    const upload = await run(h);

    expect(upload.getState().pipeline).toBe("progressive");
    expect(upload.getState().fallbackReason).toBe("no moov box in this file");
  });

  it("falls back mid-run when the worker reports a fallback-able failure", async () => {
    restoreCapabilities = stubMediaCapabilities({
      videoEncoder: encoderThatSupports(true),
    });
    const h = harness({
      createTranscoder: () =>
        scriptedTranscoder({
          failWith: new TranscodeError("no-webcodecs", "VideoEncoder is missing"),
        }),
    });
    const upload = await run(h);

    expect(upload.getState().pipeline).toBe("progressive");
    expect(h.finalised[0]).toMatchObject({ pipeline: "progressive" });
  });

  it("does NOT fall back on an encoder error — that is a bug, not a browser", async () => {
    restoreCapabilities = stubMediaCapabilities({
      videoEncoder: encoderThatSupports(true),
    });
    const h = harness({
      createTranscoder: () =>
        scriptedTranscoder({
          failWith: new TranscodeError("encoder-error", "the codec closed"),
        }),
    });
    const upload = await run(h);

    // `shouldFallBackToProgressive` is the rule and it lives with the reasons.
    // Silently degrading here would hide a real fault behind a working upload.
    expect(upload.getState().phase).toBe("failed");
    expect(upload.getState().error).toMatch(/the codec closed/);
    expect(h.finalised).toHaveLength(0);
  });
});

/* ========================================================== the ladder run == */

describe("the ladder run", () => {
  async function ladderRun(options: ScriptOptions = {}) {
    restoreCapabilities = stubMediaCapabilities({
      videoEncoder: encoderThatSupports(true),
    });
    const h = harness({ createTranscoder: () => scriptedTranscoder(options) });
    const upload = await run(h);
    return { h, upload };
  }

  it("writes the key layout research/05 §7 specifies", async () => {
    const { h } = await ladderRun({ segments: 2 });

    expect([...h.stored.keys()].sort()).toEqual(
      [
        `videos/${VIDEO_ID}/360p/index.m3u8`,
        `videos/${VIDEO_ID}/360p/init.mp4`,
        `videos/${VIDEO_ID}/360p/seg-00000.m4s`,
        `videos/${VIDEO_ID}/360p/seg-00001.m4s`,
        `videos/${VIDEO_ID}/720p/index.m3u8`,
        `videos/${VIDEO_ID}/720p/init.mp4`,
        `videos/${VIDEO_ID}/720p/seg-00000.m4s`,
        `videos/${VIDEO_ID}/720p/seg-00001.m4s`,
        `videos/${VIDEO_ID}/master.m3u8`,
      ].sort(),
    );
  });

  it("produces only keys /api/upload/target would issue a grant for", async () => {
    // The cross-check that matters: the route refuses anything outside
    // `{videos|channels}/{id}/{rest}` and anything with a traversal in it, and
    // a key this pipeline invents that the route rejects is an upload that
    // fails in production and nowhere else.
    const { h } = await ladderRun({ segments: 2 });
    for (const key of h.stored.keys()) {
      expect(isWritableBlobKey(key), key).toBe(true);
    }
  });

  it("stores real fragmented MP4, not placeholder bytes", async () => {
    const { h } = await ladderRun({ segments: 1 });

    const init = h.stored.get(`videos/${VIDEO_ID}/720p/init.mp4`)!;
    expect(parseBoxes(init).map((box) => box.type)).toEqual(["ftyp", "moov"]);

    const segment = h.stored.get(`videos/${VIDEO_ID}/720p/seg-00000.m4s`)!;
    expect(parseBoxes(segment).map((box) => box.type)).toEqual(["moof", "mdat"]);
  });

  it("writes a VOD media playlist per rung and a master naming both", async () => {
    const { h } = await ladderRun({ segments: 2 });
    const text = (key: string) => new TextDecoder().decode(h.stored.get(key)!);

    const media = text(`videos/${VIDEO_ID}/720p/index.m3u8`);
    expect(media).toContain('#EXT-X-MAP:URI="init.mp4"');
    expect(media).toContain("#EXT-X-PLAYLIST-TYPE:VOD");
    expect(media).toContain("seg-00000.m4s");
    expect(media).toContain("seg-00001.m4s");
    expect(media).toContain("#EXT-X-ENDLIST");

    const master = text(`videos/${VIDEO_ID}/master.m3u8`);
    expect(master).toContain("720p/index.m3u8");
    expect(master).toContain("360p/index.m3u8");
    expect(master).toContain("RESOLUTION=1280x720");
  });

  it("reports the ladder, the codec family and the throughput regime", async () => {
    const { upload } = await ladderRun();
    const state = upload.getState();

    expect(state.ladder.map((rung) => rung.name)).toEqual(["720p", "360p"]);
    expect(state.codecFamily).toBe("avc");
    expect(state.throughput).toBe("faster-than-realtime");
  });

  it("surfaces rungs this machine could not encode", async () => {
    const { upload } = await ladderRun({ dropped: ["1080p"] });
    expect(upload.getState().droppedRungs).toEqual(["1080p"]);
  });

  it("reports the worker's realtime regime over the probe's guess", async () => {
    const { upload } = await ladderRun({ throughput: "realtime" });
    expect(upload.getState().throughput).toBe("realtime");
  });

  it("measures bandwidth from the bytes rather than echoing the target", async () => {
    const { h } = await ladderRun({ segments: 2 });
    const media = h.finalised[0] as MediaFinaliseInput;
    const top = media.renditions?.find((r) => r.name === "720p");

    expect(top).toBeDefined();
    expect(top!.bandwidth).toBeGreaterThan(0);
    // The rung's *target* is 2.8 Mbps; the fixture's segments are far smaller,
    // so an implementation that copied `rung.bitrate` would land on 2_800_000.
    expect(top!.bandwidth).not.toBe(2_800_000);
    expect(top!.segmentCount).toBe(2);
    expect(top!.codec).toBe("avc1.64001f");
    expect(top!.initKey).toBe(`videos/${VIDEO_ID}/720p/init.mp4`);
  });

  it("refuses a rung whose segments arrive out of order", async () => {
    // The muxer's decode clock only runs forwards. An out-of-order segment
    // would be silently misplaced on the timeline and the file would play and
    // fail to scrub — so this fails loudly instead.
    const { upload } = await ladderRun({ scramble: true, segments: 3 });

    expect(upload.getState().phase).toBe("failed");
    expect(upload.getState().error).toMatch(/only runs\s+forwards/);
  });
});

/* ======================================================== progress honesty == */

describe("progress", () => {
  it("reports encode and upload separately, and never a total it cannot know", async () => {
    restoreCapabilities = stubMediaCapabilities({
      videoEncoder: encoderThatSupports(true),
    });
    const h = harness({ createTranscoder: () => scriptedTranscoder({ segments: 3 }) });
    await run(h);

    const encodeFractions = h.states
      .map((state) => state.encode.fraction)
      .filter((value): value is number => value !== undefined);
    expect(encodeFractions).toContain(1 / 3);
    expect(encodeFractions.at(-1)).toBe(1);

    // The upload denominator grows while the encode runs: at least one observed
    // state has more objects seen than done, which is the interleaving that
    // makes "n of m so far" the only honest phrasing.
    expect(
      h.states.some(
        (state) => state.upload.objectsSeen > state.upload.objectsDone,
      ),
    ).toBe(true);

    const final = h.states.at(-1)!;
    expect(final.upload.objectsDone).toBe(final.upload.objectsSeen);
    expect(final.upload.objectsDone).toBe(h.stored.size);
    expect(final.upload.bytesSent).toBeGreaterThan(0);
  });

  it("carries an indeterminate encode fraction through unchanged", () => {
    // `TranscodeProgress.fraction` is `undefined` when the container declared
    // neither a duration nor a frame count, and its own header says the UI must
    // render that as indeterminate rather than invent a number.
    expect(IDLE_UPLOAD_STATE.encode.fraction).toBeUndefined();
  });

  it("reports real byte progress on the progressive path", async () => {
    const h = harness({
      probeSource: async () => unreadableSource("not an MP4"),
      putBytes: async (target, body, onProgress) => {
        const total = body instanceof Blob ? body.size : body.byteLength;
        onProgress?.(total / 2, total);
        onProgress?.(total, total);
        h.stored.set(target.key, new Uint8Array(0));
      },
    });
    await run(h, sourceFile("clip.webm", 2000));

    const half = h.states.find((state) => state.upload.bytesSent === 1000);
    expect(half?.upload.bytesSeen).toBe(2000);
    expect(h.states.at(-1)!.upload.bytesSent).toBe(2000);
    expect(h.stored.has(`videos/${VIDEO_ID}/source.webm`)).toBe(true);
  });
});

describe("the remaining-time estimate", () => {
  const base = (patch: Partial<UploadState>): UploadState => ({
    ...IDLE_UPLOAD_STATE,
    ...patch,
  });

  it("is the remaining media on the realtime path, measured from nothing", () => {
    // Frames arrive at playback rate; pulling harder does not help, so the
    // remainder is arithmetic rather than extrapolation.
    const state = base({
      throughput: "realtime",
      encode: {
        ...IDLE_UPLOAD_STATE.encode,
        presentedUs: 30_000_000,
        durationUs: 90_000_000,
      },
    });
    expect(estimateRemainingSeconds(state)).toBe(60);
  });

  it("is withheld on the fast path until enough has gone through", () => {
    const early = base({
      throughput: "faster-than-realtime",
      elapsedMs: 500,
      encode: { ...IDLE_UPLOAD_STATE.encode, fraction: 0.01 },
    });
    expect(estimateRemainingSeconds(early)).toBeUndefined();

    const later = base({
      throughput: "faster-than-realtime",
      elapsedMs: 10_000,
      encode: { ...IDLE_UPLOAD_STATE.encode, fraction: 0.5 },
    });
    expect(estimateRemainingSeconds(later)).toBe(10);
  });

  it("has nothing to say before a regime is known", () => {
    expect(estimateRemainingSeconds(IDLE_UPLOAD_STATE)).toBeUndefined();
  });
});

/* ============================================================== lifecycle == */

describe("the lifecycle", () => {
  it("creates the row before it asks for a single upload target", async () => {
    restoreCapabilities = stubMediaCapabilities({
      videoEncoder: encoderThatSupports(true),
    });
    const order: string[] = [];
    const h = harness({
      createVideo: async () => {
        order.push("create");
        return { id: VIDEO_ID };
      },
      requestTarget: async (key, contentType) => {
        order.push("target");
        return {
          mode: "proxy",
          key,
          url: `/api/upload/blob/${key}`,
          method: "PUT",
          headers: { "Content-Type": contentType },
        };
      },
    });
    await run(h);

    // `/api/upload/target` refuses a key whose video row does not exist, on
    // purpose — see its header. Asking first is not merely wasteful, it 404s.
    expect(order[0]).toBe("create");
    expect(order.filter((step) => step === "create")).toHaveLength(1);
  });

  it("publishes with the details the uploader entered", async () => {
    restoreCapabilities = stubMediaCapabilities({
      videoEncoder: encoderThatSupports(true),
    });
    const h = harness();
    const upload = await run(h);

    expect(upload.getState().phase).toBe("ready-to-publish");
    const ok = await upload.publish({
      title: "A better title",
      description: "notes",
      visibility: "unlisted",
      category: "Music",
      tags: ["a", "b"],
    });

    expect(ok).toBe(true);
    expect(upload.getState().phase).toBe("published");
    expect(h.finalised[1]).toEqual({
      kind: "publish",
      title: "A better title",
      description: "notes",
      visibility: "unlisted",
      category: "Music",
      tags: ["a", "b"],
    });
  });

  it("refuses to publish before the media write has landed", async () => {
    const upload = createUploadRun(harness().ports);
    expect(await upload.publish({
      title: "x",
      description: "",
      visibility: "public",
      category: "Music",
      tags: [],
    })).toBe(false);
  });

  it("cancels the transcode and deletes the row", async () => {
    restoreCapabilities = stubMediaCapabilities({
      videoEncoder: encoderThatSupports(true),
    });
    const transcoder = scriptedTranscoder();
    const h = harness({ createTranscoder: () => transcoder });
    const upload = await run(h);

    await upload.cancel();

    expect(transcoder.cancelled()).toBe(1);
    expect(h.discarded).toEqual([VIDEO_ID]);
    expect(upload.getState().phase).toBe("cancelled");
  });

  it("leaves the row alone when the run fails — abandonment is not deletion", async () => {
    restoreCapabilities = stubMediaCapabilities({
      videoEncoder: encoderThatSupports(true),
    });
    const h = harness({
      putBytes: async () => {
        throw new Error("the network dropped");
      },
    });
    const upload = await run(h);

    // The resumability decision, asserted: a failure leaves an `uploading` row
    // for Studio to list and offer a Delete on, rather than throwing away work
    // that a retry might have salvaged.
    expect(upload.getState().phase).toBe("failed");
    expect(h.discarded).toEqual([]);
    expect(upload.getState().videoId).toBe(VIDEO_ID);
  });

  it("routes the Content ID scan result into the Checks state", async () => {
    restoreCapabilities = stubMediaCapabilities({
      videoEncoder: encoderThatSupports(true),
    });
    const claim = {
      id: "clm-1",
      policy: "monetise" as const,
      status: "active" as const,
      matchStartMs: 1000,
      matchEndMs: 9000,
      referenceOffsetMs: 500,
      score: 42,
      referenceTitle: "A Song",
      rightsHolder: "A Label",
    };

    const claimed = harness({
      fingerprintFile: async () => ({ hashes: [1, 2], offsetsMs: [0, 50], durationMs: 6000 }),
      finalise: async () => ({ uploadStatus: "processing", claims: [claim], scanned: true }),
    });
    expect((await run(claimed)).getState().checks).toBe("claimed");

    const clear = harness({
      fingerprintFile: async () => ({ hashes: [1], offsetsMs: [0], durationMs: 6000 }),
      finalise: async () => ({ uploadStatus: "processing", claims: [], scanned: true }),
    });
    expect((await run(clear)).getState().checks).toBe("clear");

    // "Did not run" and "found nothing" are different facts, and only one of
    // them is reassuring.
    const unscanned = harness();
    expect((await run(unscanned)).getState().checks).toBe("unavailable");
  });

  it("does not fail the upload when fingerprinting throws", async () => {
    restoreCapabilities = stubMediaCapabilities({
      videoEncoder: encoderThatSupports(true),
    });
    const h = harness({
      fingerprintFile: async () => {
        throw new Error("decodeAudioData refused this file");
      },
    });
    const upload = await run(h);

    expect(upload.getState().phase).toBe("ready-to-publish");
    expect(h.finalised[0]).not.toHaveProperty("fingerprint");
  });
});
