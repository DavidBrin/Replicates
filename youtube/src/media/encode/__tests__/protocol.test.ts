// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { LadderRung } from "@/media/types";

import type { NegotiatedLadder } from "../capabilities";
import { CodecNegotiationError, negotiateLadder } from "../capabilities";
import type { SourceProfile } from "../decode-source";
import type {
  TranscodeFailureReason,
  TranscodeSegment,
  TranscodeSummary,
  transcode,
} from "../transcode";
import { TranscodeError, shouldFallBackToProgressive } from "../transcode";
import type {
  TranscodeEvent,
  TranscodeEventKind,
  TranscodeRequestKind,
  TranscodeSourceKind,
  TranscodeSourceSpec,
  TranscodeWorkerScope,
} from "../worker";
import {
  TRANSCODE_EVENT_KINDS,
  TRANSCODE_REQUEST_KINDS,
  TRANSCODE_SOURCE_KINDS,
  assertNever,
  frameSourceFor,
  installTranscodeWorker,
  parseTranscodeEvent,
  parseTranscodeRequest,
  transferablesFor,
} from "../worker";

/**
 * What this file proves, and what it deliberately does not.
 *
 * It proves the protocol: that every message kind is listed, that a message the
 * worker does not understand becomes an error on the channel rather than
 * silence, that segment payloads are transferred rather than copied, that a
 * cancel reaches the transcode's `AbortSignal`, and that a failure is mapped to
 * a reason the caller can route on.
 *
 * It does not prove that anything encodes. The transcode function is injected
 * here. Faking `VideoEncoder` convincingly enough to run the real one would
 * produce a test that passes against a fake and says nothing about Chromium —
 * research/01 §4.3 is a standing reminder that the same codec string answers
 * differently in the same browser depending on GPU access, which is exactly the
 * kind of thing a fake cannot model. Real encode belongs in Playwright.
 */

/* ------------------------------------------------------------- fixtures -- */

const profile: SourceProfile = {
  width: 1920,
  height: 1080,
  frameRate: 30,
  durationUs: 10_000_000,
};

const rung: LadderRung = {
  name: "720p",
  width: 1280,
  height: 720,
  bitrate: 2_800_000,
  codec: "avc1.64001f",
};

const ladder: NegotiatedLadder = { family: "avc", rungs: [rung], dropped: ["1080p"] };

function chunkSource(): TranscodeSourceSpec {
  return {
    kind: "encoded-chunks",
    profile,
    decoderConfig: { codec: "avc1.640028" },
    chunks: new ReadableStream({
      start(controller) {
        controller.close();
      },
    }),
  };
}

function sampleSegment(): TranscodeSegment {
  return {
    rung: "720p",
    index: 0,
    startUs: 0,
    durationUs: 2_000_000,
    samples: [
      {
        data: new Uint8Array([1, 2, 3]),
        timestampUs: 0,
        durationUs: 33_333,
        isKeyFrame: true,
      },
      {
        data: new Uint8Array([4, 5]),
        timestampUs: 33_333,
        durationUs: 33_333,
        isKeyFrame: false,
      },
    ],
  };
}

const summary: TranscodeSummary = {
  family: "avc",
  rungs: [rung],
  throughput: "faster-than-realtime",
  framesDecoded: 300,
  segmentCount: 5,
  bytesEncoded: 1234,
  presentedUs: 10_000_000,
  elapsedMs: 4321,
};

interface Harness {
  readonly scope: TranscodeWorkerScope;
  readonly posted: { event: TranscodeEvent; transfer: Transferable[] }[];
  send(data: unknown): void;
}

function harness(): Harness {
  const posted: { event: TranscodeEvent; transfer: Transferable[] }[] = [];
  let listener: ((event: { readonly data: unknown }) => void) | undefined;
  return {
    scope: {
      addEventListener(_type, next) {
        listener = next;
      },
      postMessage(event, transfer) {
        posted.push({ event, transfer });
      },
    },
    posted,
    send(data) {
      listener?.({ data });
    },
  };
}

/** Let the worker's async job make progress. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

const negotiateTo =
  (result: NegotiatedLadder | Error): typeof negotiateLadder =>
  () =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result);

/* ------------------------------------------------------- exhaustiveness -- */

describe("protocol exhaustiveness", () => {
  it("lists every event kind, with nothing stale", () => {
    // The `Record` is the compile-time half: adding a kind to the union without
    // adding it here fails to typecheck. The comparison is the runtime half,
    // which catches the exported array drifting from the union.
    const handled: Record<TranscodeEventKind, true> = {
      ready: true,
      track: true,
      segment: true,
      progress: true,
      failed: true,
      done: true,
    };
    expect([...TRANSCODE_EVENT_KINDS].sort()).toEqual(Object.keys(handled).sort());
  });

  it("lists every request kind", () => {
    const handled: Record<TranscodeRequestKind, true> = { start: true, cancel: true };
    expect([...TRANSCODE_REQUEST_KINDS].sort()).toEqual(Object.keys(handled).sort());
  });

  it("lists every source kind", () => {
    const handled: Record<TranscodeSourceKind, true> = {
      "encoded-chunks": true,
      "media-stream": true,
    };
    expect([...TRANSCODE_SOURCE_KINDS].sort()).toEqual(Object.keys(handled).sort());
  });

  it("throws from assertNever rather than falling through", () => {
    // Reached only when a message arrives from a bundle newer than this one, so
    // the message has to name where it came from.
    expect(() => assertNever("surprise" as never, "transcode event")).toThrow(
      /transcode event: unhandled "surprise"/,
    );
  });

  it("routes exactly the two environment reasons to the progressive fallback", () => {
    const expected: Record<TranscodeFailureReason, boolean> = {
      "no-webcodecs": true,
      "no-supported-codec": true,
      "decoder-error": false,
      "encoder-error": false,
      "reordered-output": false,
      cancelled: false,
      unknown: false,
    };
    for (const [reason, fallback] of Object.entries(expected)) {
      expect(shouldFallBackToProgressive(reason as TranscodeFailureReason)).toBe(
        fallback,
      );
    }
  });
});

/* -------------------------------------------------------------- parsing -- */

describe("parseTranscodeRequest", () => {
  it("accepts a well-formed request", () => {
    const request = { kind: "cancel", jobId: "j1" };
    expect(parseTranscodeRequest(request)).toBe(request);
  });

  it.each([
    ["null", null],
    ["a string", "start"],
    ["no kind", { jobId: "j1" }],
    ["an unknown kind", { kind: "restart", jobId: "j1" }],
    ["no jobId", { kind: "start" }],
    ["an empty jobId", { kind: "start", jobId: "" }],
  ])("rejects %s", (_label, value) => {
    expect(parseTranscodeRequest(value)).toBeUndefined();
  });
});

describe("parseTranscodeEvent", () => {
  it("accepts a well-formed event", () => {
    const event = { kind: "progress", jobId: "j1" };
    expect(parseTranscodeEvent(event)).toBe(event);
  });

  it.each([
    ["null", null],
    ["an unknown kind", { kind: "almost", jobId: "j1" }],
    ["a foreign worker's message", { type: "webpackOk" }],
  ])("rejects %s", (_label, value) => {
    expect(parseTranscodeEvent(value)).toBeUndefined();
  });
});

/* -------------------------------------------------------- transferables -- */

describe("transferablesFor", () => {
  it("hands over every distinct sample buffer in a segment", () => {
    const segment = sampleSegment();
    const transfer = transferablesFor({ kind: "segment", jobId: "j1", segment });
    expect(transfer).toEqual([
      segment.samples[0]?.data.buffer,
      segment.samples[1]?.data.buffer,
    ]);
  });

  it("transfers a shared buffer once, not once per sample", () => {
    // Transferring the same ArrayBuffer twice in one call throws and takes the
    // whole message with it.
    const shared = new ArrayBuffer(8);
    const transfer = transferablesFor({
      kind: "segment",
      jobId: "j1",
      segment: {
        rung: "720p",
        index: 0,
        startUs: 0,
        durationUs: 1000,
        samples: [
          {
            data: new Uint8Array(shared, 0, 4),
            timestampUs: 0,
            durationUs: 500,
            isKeyFrame: true,
          },
          {
            data: new Uint8Array(shared, 4, 4),
            timestampUs: 500,
            durationUs: 500,
            isKeyFrame: false,
          },
        ],
      },
    });
    expect(transfer).toEqual([shared]);
  });

  it("hands over the codec description on a track event", () => {
    const description = new Uint8Array([1, 66, 0, 31]);
    const transfer = transferablesFor({
      kind: "track",
      jobId: "j1",
      rung: "720p",
      track: {
        kind: "video",
        codec: "avc1.64001f",
        description,
        timescale: 1_000_000,
        width: 1280,
        height: 720,
      },
    });
    expect(transfer).toEqual([description.buffer]);
  });

  it("transfers nothing for the metadata-only events", () => {
    expect(
      transferablesFor({ kind: "progress", jobId: "j1", progress: {
        framesDecoded: 1,
        segmentsEmitted: 0,
        bytesEncoded: 0,
        presentedUs: 0,
        encodeBacklog: 0,
      } }),
    ).toEqual([]);
    expect(transferablesFor({ kind: "done", jobId: "j1", summary })).toEqual([]);
  });
});

/* ------------------------------------------------------------ the source -- */

describe("frameSourceFor", () => {
  it("reports the decoder path as faster than real time", () => {
    expect(frameSourceFor(chunkSource()).throughput).toBe("faster-than-realtime");
  });

  it("reports the MediaStreamTrack path as real time", () => {
    // The distinction the upload UI shows the user, so it has to survive the
    // trip through the protocol rather than being inferred later.
    const source = frameSourceFor({
      kind: "media-stream",
      profile,
      track: {} as MediaStreamTrack,
    });
    expect(source.throughput).toBe("realtime");
  });
});

/* ------------------------------------------------------------ the worker -- */

describe("installTranscodeWorker", () => {
  it("reports an unparseable message instead of ignoring it", async () => {
    const h = harness();
    installTranscodeWorker(h.scope, { negotiate: negotiateTo(ladder) });
    h.send({ kind: "explode" });
    await settle();

    expect(h.posted).toHaveLength(1);
    expect(h.posted[0]?.event).toEqual({
      kind: "failed",
      jobId: "",
      reason: "unknown",
      message: "Unrecognised message: kind explode",
      fallbackToProgressive: false,
    });
  });

  it("emits ready, then the run's events, then done — all tagged with the job", async () => {
    const h = harness();
    const segment = sampleSegment();
    const run: typeof transcode = async (options) => {
      options.sink.track({
        rung,
        track: {
          kind: "video",
          codec: rung.codec,
          timescale: 1_000_000,
          width: rung.width,
          height: rung.height,
        },
      });
      options.sink.segment(segment);
      options.sink.progress({
        framesDecoded: 60,
        segmentsEmitted: 1,
        bytesEncoded: 5,
        presentedUs: 2_000_000,
        durationUs: 10_000_000,
        fraction: 0.2,
        encodeBacklog: 1,
      });
      return summary;
    };

    installTranscodeWorker(h.scope, { negotiate: negotiateTo(ladder), run });
    h.send({ kind: "start", jobId: "job-1", source: chunkSource() });
    await settle();

    expect(h.posted.map((p) => p.event.kind)).toEqual([
      "ready",
      "track",
      "segment",
      "progress",
      "done",
    ]);
    expect(h.posted.every((p) => p.event.jobId === "job-1")).toBe(true);

    expect(h.posted[0]?.event).toEqual({
      kind: "ready",
      jobId: "job-1",
      family: "avc",
      rungs: [rung],
      dropped: ["1080p"],
      throughput: "faster-than-realtime",
      segmentDurationUs: 2_000_000,
    });
    // The segment's payload is handed over, not copied — a 1080p rung is over a
    // megabyte every two seconds.
    expect(h.posted[2]?.transfer).toHaveLength(2);
  });

  it("negotiates against the ladder selected from the source profile", async () => {
    const h = harness();
    let seen: Parameters<typeof negotiateLadder>[0] | undefined;
    const negotiate: typeof negotiateLadder = (request) => {
      seen = request;
      return Promise.resolve(ladder);
    };
    installTranscodeWorker(h.scope, {
      negotiate,
      run: () => Promise.resolve(summary),
    });
    h.send({ kind: "start", jobId: "job-2", source: chunkSource() });
    await settle();

    expect(seen?.frameRate).toBe(30);
    expect(seen?.shapes.map((s) => s.name)).toEqual([
      "1080p",
      "720p",
      "480p",
      "360p",
      "240p",
      "144p",
    ]);
  });

  it("passes a custom segment duration through to the run and to ready", async () => {
    const h = harness();
    let seen: Parameters<typeof transcode>[0] | undefined;
    installTranscodeWorker(h.scope, {
      negotiate: negotiateTo(ladder),
      run: (options) => {
        seen = options;
        return Promise.resolve(summary);
      },
    });
    h.send({
      kind: "start",
      jobId: "job-3",
      source: chunkSource(),
      segmentDurationUs: 6_000_000,
    });
    await settle();

    expect(seen?.segmentDurationUs).toBe(6_000_000);
    const ready = h.posted[0]?.event;
    expect(ready?.kind === "ready" && ready.segmentDurationUs).toBe(6_000_000);
  });

  it("turns a negotiation failure into a routable fallback signal", async () => {
    const h = harness();
    installTranscodeWorker(h.scope, {
      negotiate: negotiateTo(
        new CodecNegotiationError("no-webcodecs", "no VideoEncoder here"),
      ),
    });
    h.send({ kind: "start", jobId: "job-4", source: chunkSource() });
    await settle();

    expect(h.posted).toEqual([
      {
        event: {
          kind: "failed",
          jobId: "job-4",
          reason: "no-webcodecs",
          message: "no VideoEncoder here",
          fallbackToProgressive: true,
        },
        transfer: [],
      },
    ]);
  });

  it("does not route an encoder fault to the fallback", async () => {
    // A broken encoder is a bug or a broken file. Quietly uploading the source
    // instead would hide it behind a working upload.
    const h = harness();
    installTranscodeWorker(h.scope, {
      negotiate: negotiateTo(ladder),
      run: () =>
        Promise.reject(new TranscodeError("encoder-error", "codec closed itself")),
    });
    h.send({ kind: "start", jobId: "job-5", source: chunkSource() });
    await settle();

    const failed = h.posted.at(-1)?.event;
    expect(failed).toMatchObject({
      kind: "failed",
      reason: "encoder-error",
      fallbackToProgressive: false,
    });
  });

  it("reaches the run's AbortSignal when a cancel arrives", async () => {
    const h = harness();
    const run: typeof transcode = (options) =>
      new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => {
          reject(new TranscodeError("cancelled", "The transcode was cancelled."));
        });
      });

    installTranscodeWorker(h.scope, { negotiate: negotiateTo(ladder), run });
    h.send({ kind: "start", jobId: "job-6", source: chunkSource() });
    await settle();
    expect(h.posted.map((p) => p.event.kind)).toEqual(["ready"]);

    h.send({ kind: "cancel", jobId: "job-6" });
    await settle();

    expect(h.posted.at(-1)?.event).toMatchObject({
      kind: "failed",
      jobId: "job-6",
      reason: "cancelled",
      fallbackToProgressive: false,
    });
  });

  it("ignores a cancel for a job it is not running", async () => {
    const h = harness();
    installTranscodeWorker(h.scope, { negotiate: negotiateTo(ladder) });
    h.send({ kind: "cancel", jobId: "never-started" });
    await settle();
    expect(h.posted).toEqual([]);
  });

  it("runs two jobs at once without crossing their event streams", async () => {
    const h = harness();
    const run: typeof transcode = async (options) => {
      options.sink.progress({
        framesDecoded: 1,
        segmentsEmitted: 0,
        bytesEncoded: 0,
        presentedUs: 0,
        encodeBacklog: 0,
      });
      return summary;
    };
    installTranscodeWorker(h.scope, { negotiate: negotiateTo(ladder), run });
    h.send({ kind: "start", jobId: "a", source: chunkSource() });
    h.send({ kind: "start", jobId: "b", source: chunkSource() });
    await settle();

    for (const jobId of ["a", "b"]) {
      expect(
        h.posted.filter((p) => p.event.jobId === jobId).map((p) => p.event.kind),
      ).toEqual(["ready", "progress", "done"]);
    }
  });
});
