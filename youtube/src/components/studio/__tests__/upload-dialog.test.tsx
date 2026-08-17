import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { TranscodeSummary, Transcoder } from "@/media/encode";
import type { EncodedSample, TrackConfig } from "@/media/types";
import { stubMediaCapabilities } from "../../../../vitest.setup";

import { UploadDialog, canLeaveStep, defaultTitleFor } from "../upload-dialog";
import { EMPTY_DETAILS } from "../details-form";
import type {
  ClaimView,
  FinaliseResult,
  MediaFinaliseInput,
  ProbedSource,
  PublishInput,
  UploadPorts,
} from "../upload-machine";

/**
 * The stepper.
 *
 * R9 §13.1 is the reason this suite exists in the shape it does: the four-step
 * rail **could not be measured** — `ytcp-stepper`, `#stepper` and `.step` all
 * return zero nodes until a file has been selected, which needs a real upload
 * to a real channel. So there is no geometry to assert against. What there is
 * instead is a state machine with rules, and rules are testable: which
 * transitions are allowed, which are refused, and what the user is told when
 * one is refused.
 *
 * The transcoder and the network are injected. What is *not* injected is the
 * capability negotiation — `stubMediaCapabilities` answers the probe and the
 * shipped `negotiateLadder` makes the decision, so the branch under test is the
 * real one.
 */

const AVCC = Uint8Array.from([
  0x01, 0x64, 0x00, 0x28, 0xff, 0xe1, 0x00, 0x02, 0x67, 0x64, 0x01, 0x00, 0x02,
  0x68, 0xee,
]);

const RUNG = {
  name: "360p",
  width: 640,
  height: 360,
  bitrate: 800_000,
  codec: "avc1.64001e",
} as const;

const TRACK: TrackConfig = {
  kind: "video",
  codec: RUNG.codec,
  description: AVCC,
  timescale: 1_000_000,
  width: RUNG.width,
  height: RUNG.height,
};

function gop(startUs: number): EncodedSample[] {
  return Array.from({ length: 10 }, (_, index) => ({
    data: new Uint8Array(index === 0 ? 500 : 60).fill(1),
    timestampUs: startUs + index * 33_333,
    durationUs: 33_333,
    isKeyFrame: index === 0,
    compositionOffsetUs: 0,
  }));
}

function transcoder(
  throughput: "faster-than-realtime" | "realtime" = "faster-than-realtime",
): Transcoder {
  return {
    cancel() {},
    dispose() {},
    async start(_options, handlers = {}) {
      handlers.onReady?.({
        kind: "ready",
        jobId: "job",
        family: "avc",
        rungs: [{ ...RUNG }],
        dropped: [],
        throughput,
        segmentDurationUs: 2_000_000,
      });
      handlers.onTrack?.({ kind: "track", jobId: "job", rung: RUNG.name, track: TRACK });
      handlers.onSegment?.({
        kind: "segment",
        jobId: "job",
        segment: {
          rung: RUNG.name,
          index: 0,
          startUs: 0,
          durationUs: 2_000_000,
          samples: gop(0),
        },
      });
      handlers.onProgress?.({
        kind: "progress",
        jobId: "job",
        progress: {
          framesDecoded: 10,
          segmentsEmitted: 1,
          bytesEncoded: 1040,
          presentedUs: 2_000_000,
          durationUs: 2_000_000,
          fraction: 1,
          encodeBacklog: 0,
        },
      });
      const summary: TranscodeSummary = {
        family: "avc",
        rungs: [{ ...RUNG }],
        throughput,
        framesDecoded: 10,
        segmentCount: 1,
        bytesEncoded: 1040,
        presentedUs: 2_000_000,
        elapsedMs: 10,
      };
      return summary;
    },
  };
}

function probed(kind: "encoded-chunks" | "unreadable" = "encoded-chunks"): ProbedSource {
  return {
    kind,
    throughput: kind === "unreadable" ? "realtime" : "faster-than-realtime",
    profile: { width: 640, height: 360, frameRate: 30, durationUs: 2_000_000 },
    ...(kind === "unreadable" ? { reason: "This file has no moov box." } : {}),
    open: () => ({
      kind: "encoded-chunks",
      profile: { width: 640, height: 360, frameRate: 30 },
      decoderConfig: { codec: RUNG.codec },
      chunks: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
    }),
    close: () => {},
  };
}

interface Harness {
  readonly ports: UploadPorts;
  readonly finalised: (MediaFinaliseInput | PublishInput)[];
}

function harness(overrides: Partial<UploadPorts> = {}): Harness {
  const finalised: (MediaFinaliseInput | PublishInput)[] = [];
  const ports: UploadPorts = {
    createVideo: async () => ({ id: "vidAbc12345" }),
    requestTarget: async (key, contentType) => ({
      mode: "proxy" as const,
      key,
      url: `/api/upload/blob/${key}`,
      method: "PUT" as const,
      headers: { "Content-Type": contentType },
    }),
    putBytes: async () => {},
    finalise: async (_id, input): Promise<FinaliseResult> => {
      finalised.push(input);
      return { uploadStatus: "processing", claims: [], scanned: true };
    },
    discard: async () => {},
    probeSource: async () => probed(),
    createTranscoder: () => transcoder(),
    now: () => 0,
    ...overrides,
  };
  return { ports, finalised };
}

function videoFile(name = "beach day.mp4"): File {
  return new File([new Uint8Array(64)], name, { type: "video/mp4" });
}

let restore: (() => void) | undefined;

afterEach(() => {
  restore?.();
  restore = undefined;
});

function capable(): void {
  restore = stubMediaCapabilities({
    videoEncoder: { isConfigSupported: vi.fn(async () => ({ supported: true })) },
  });
}

/** Pick a file and wait for the run to settle at `ready-to-publish`. */
async function startUpload(ports: UploadPorts, file = videoFile()): Promise<void> {
  render(<UploadDialog channelId="chan-1" ports={ports} />);
  await userEvent.upload(screen.getByLabelText("Select files"), file);
  await screen.findByRole("button", { name: "Next" });
  await waitFor(() =>
    expect(screen.getByLabelText("Upload progress")).toHaveAttribute(
      "data-phase",
      "ready-to-publish",
    ),
  );
}

/* ============================================================= the picker == */

describe("the picker", () => {
  it("shows the measured picker until a file is chosen", () => {
    render(<UploadDialog channelId="chan-1" ports={harness().ports} />);

    expect(
      screen.getByText("Drag and drop video files to upload"),
    ).toBeInTheDocument();
    // R9 §13.1: the stepper does not exist in the DOM before a file is picked.
    // Neither does this one, and that is fidelity rather than laziness.
    expect(screen.queryByLabelText("Upload steps")).not.toBeInTheDocument();
  });

  it("uses the filename as the working title, because the row needs one first", () => {
    // A title is required to create the row, and the row must exist before any
    // upload target can be issued. Something has to be sent up front.
    expect(defaultTitleFor(videoFile("beach day.mp4"))).toBe("beach day");
    expect(defaultTitleFor(videoFile(".mp4"))).toBe("Untitled");
  });
});

/* ============================================================ the stepper == */

describe("the stepper", () => {
  it("walks forwards through all four steps and back again", async () => {
    capable();
    await startUpload(harness().ports);

    const next = screen.getByRole("button", { name: "Next" });
    expect(screen.getByLabelText(/^Title/)).toBeInTheDocument();

    await userEvent.click(next);
    expect(screen.getByRole("heading", { name: "Video elements" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Copyright" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("group", { name: "Visibility" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();

    // Back, all the way, without losing the run.
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Copyright" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText(/^Title/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
  });

  it("lets a step already reached be clicked, and refuses one that has not", async () => {
    capable();
    await startUpload(harness().ports);

    expect(screen.getByRole("button", { name: "Checks" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByLabelText(/^Title/)).toBeInTheDocument();

    // Video elements has been reached, so it is still clickable from here.
    await userEvent.click(screen.getByRole("button", { name: "Video elements" }));
    expect(screen.getByRole("heading", { name: "Video elements" })).toBeInTheDocument();
  });

  it("refuses to leave Details without a title, and says why", async () => {
    capable();
    await startUpload(harness().ports);

    await userEvent.clear(screen.getByLabelText(/^Title/));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/title is required/i);
    expect(screen.getByLabelText(/^Title/)).toBeInTheDocument();
  });

  it("gates only Details — a claim is information, never a block", () => {
    // D12: a match creates a claim, not a takedown. Gating the stepper on one
    // would invent an enforcement the design explicitly rejects.
    expect(canLeaveStep("details", EMPTY_DETAILS)).toBe(false);
    expect(canLeaveStep("checks", EMPTY_DETAILS)).toBe(true);
    expect(canLeaveStep("elements", EMPTY_DETAILS)).toBe(true);
    expect(canLeaveStep("visibility", EMPTY_DETAILS)).toBe(true);
  });
});

/* ============================================================ publication == */

describe("publishing", () => {
  it("waits for every segment to be stored before it will publish", async () => {
    capable();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = harness({
      putBytes: async () => {
        await gate;
      },
    });

    render(<UploadDialog channelId="chan-1" ports={h.ports} />);
    await userEvent.upload(screen.getByLabelText("Select files"), videoFile());
    await screen.findByRole("button", { name: "Next" });

    for (let step = 0; step < 3; step++) {
      await userEvent.click(screen.getByRole("button", { name: "Next" }));
    }
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
    expect(screen.getByText(/Publishing unlocks once/)).toBeInTheDocument();

    release?.();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled(),
    );
  });

  it("publishes with the details and visibility the uploader chose", async () => {
    capable();
    const h = harness();
    await startUpload(h.ports);

    await userEvent.clear(screen.getByLabelText(/^Title/));
    await userEvent.type(screen.getByLabelText(/^Title/), "A better title");
    await userEvent.type(screen.getByLabelText("Tags"), "surf, sun, surf");

    for (let step = 0; step < 3; step++) {
      await userEvent.click(screen.getByRole("button", { name: "Next" }));
    }
    await userEvent.click(screen.getByRole("radio", { name: /Public/ }));
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(h.finalised).toHaveLength(2));
    expect(h.finalised[1]).toEqual({
      kind: "publish",
      title: "A better title",
      description: "",
      visibility: "public",
      category: "People & Blogs",
      // Deduplicated exactly as `setTags` will store them.
      tags: ["surf", "sun"],
    });
  });

  it("defaults to private, which is what the row was created as", async () => {
    capable();
    await startUpload(harness().ports);
    for (let step = 0; step < 3; step++) {
      await userEvent.click(screen.getByRole("button", { name: "Next" }));
    }
    expect(screen.getByRole("radio", { name: /Private/ })).toBeChecked();
  });
});

/* ======================================================= what it tells you == */

describe("what the dialog tells the user", () => {
  it("names the throughput regime and what it means for the wait", async () => {
    capable();
    await startUpload(harness({ createTranscoder: () => transcoder("realtime") }).ports);

    // The difference between "about 40 seconds" and "about as long as your
    // video" is the whole reason `ThroughputRegime` crosses the worker
    // boundary in the first message.
    expect(screen.getByText("Encoding at playback speed")).toBeInTheDocument();
    expect(screen.getByText(/about as long as the video/)).toBeInTheDocument();
  });

  it("says so when the pipeline ran faster than real time", async () => {
    capable();
    await startUpload(harness().ports);
    expect(screen.getByText("Encoding faster than real time")).toBeInTheDocument();
  });

  it("explains the progressive fallback rather than degrading quietly", async () => {
    // No `VideoEncoder` is stubbed: this is the one-in-twenty browser for real.
    await startUpload(harness().ports);

    expect(screen.getByText("One quality, not a ladder.")).toBeInTheDocument();
    expect(screen.getByText(/no quality menu and no\s+switching/)).toBeInTheDocument();
    expect(screen.getByLabelText("Upload progress")).toHaveAttribute(
      "data-pipeline",
      "progressive",
    );
  });

  it("lists the rungs the browser actually produced", async () => {
    capable();
    await startUpload(harness().ports);
    expect(screen.getByTestId("ladder-rungs")).toHaveTextContent("360p");
  });

  it("shows the Content ID result on the Checks step", async () => {
    capable();
    const claim: ClaimView = {
      id: "clm-1",
      policy: "block",
      status: "active",
      matchStartMs: 0,
      matchEndMs: 2000,
      referenceOffsetMs: 0,
      score: 88,
      referenceTitle: "Night Drive",
      rightsHolder: "Kestrel Records",
    };
    const h = harness({
      finalise: async () => ({ uploadStatus: "processing", claims: [claim], scanned: true }),
    });
    await startUpload(h.ports);

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Night Drive")).toBeInTheDocument();
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    // A claim never blocks the flow — the last step is still reachable.
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("reports a scan that could not run as unchecked, not as clear", async () => {
    capable();
    const h = harness({
      finalise: async () => ({ uploadStatus: "processing", claims: [], scanned: false }),
    });
    await startUpload(h.ports);

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(/did not run/)).toBeInTheDocument();
  });
});
