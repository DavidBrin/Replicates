import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Bar, UploadProgressView, formatBytes } from "../upload-progress";
import { IDLE_UPLOAD_STATE, type UploadState } from "../upload-machine";

/**
 * The progress surface.
 *
 * Every assertion here is one of the three ways to produce the bar the brief
 * rules out — the one that jumps to 90% and sits there.
 */

function state(patch: Partial<UploadState> = {}): UploadState {
  return {
    ...IDLE_UPLOAD_STATE,
    fileName: "clip.mp4",
    fileSize: 4_200_000,
    durationSeconds: 90,
    throughput: "faster-than-realtime",
    ladder: [
      { name: "720p", width: 1280, height: 720, bitrate: 2_800_000, codec: "avc1.64001f" },
    ],
    phase: "transcoding",
    ...patch,
  };
}

describe("the bar refuses to invent a number", () => {
  it("drops aria-valuenow entirely when the fraction is unknown", () => {
    // `TranscodeProgress.fraction` is `undefined` when the container declared
    // neither duration nor frame count. ARIA reads a `progressbar` with no
    // `aria-valuenow` as indeterminate, which is the only way to say "working,
    // and I do not know how far" without making a percentage up.
    render(<Bar fraction={undefined} label="Encoding" />);
    const bar = screen.getByRole("progressbar", { name: "Encoding" });
    expect(bar).not.toHaveAttribute("aria-valuenow");
  });

  it("carries a real value when there is one", () => {
    render(<Bar fraction={0.42} label="Encoding" />);
    expect(screen.getByRole("progressbar", { name: "Encoding" })).toHaveAttribute(
      "aria-valuenow",
      "42",
    );
  });
});

describe("the two bars are two bars", () => {
  it("reports encode and upload separately", () => {
    render(<UploadProgressView state={state({ encode: { ...IDLE_UPLOAD_STATE.encode, fraction: 0.5 } })} />);
    expect(screen.getByRole("progressbar", { name: "Encoding" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Uploading" })).toBeInTheDocument();
  });

  it("counts uploads against what exists so far, never against a guessed total", () => {
    render(
      <UploadProgressView
        state={state({
          upload: { objectsDone: 3, objectsSeen: 8, bytesSent: 1_000_000, bytesSeen: 3_000_000, inFlight: 2 },
        })}
      />,
    );
    // "so far" is load-bearing copy: the denominator grows for as long as the
    // encode runs, and a percentage of it would fall as segments arrive.
    expect(screen.getByText("3 of 8 so far")).toBeInTheDocument();
    expect(screen.getByText(/2 in flight/)).toBeInTheDocument();
  });

  it("shows frames rather than a percentage while the encode is indeterminate", () => {
    render(
      <UploadProgressView
        state={state({
          encode: { ...IDLE_UPLOAD_STATE.encode, fraction: undefined, framesDecoded: 1234 },
        })}
      />,
    );
    expect(screen.getByText("1,234 frames")).toBeInTheDocument();
  });

  it("does have a real total on the progressive path, and uses it", () => {
    // The one case where a percentage is honest: the file's size is known
    // before the first byte moves.
    render(
      <UploadProgressView
        state={state({
          pipeline: "progressive",
          upload: { objectsDone: 0, objectsSeen: 1, bytesSent: 1_000_000, bytesSeen: 4_000_000, inFlight: 1 },
        })}
      />,
    );
    expect(screen.getByRole("progressbar", { name: "Uploading" })).toHaveAttribute(
      "aria-valuenow",
      "25",
    );
    expect(screen.queryByRole("progressbar", { name: "Encoding" })).not.toBeInTheDocument();
  });
});

describe("the ladder", () => {
  it("names rungs this machine could not encode", () => {
    // A degraded ladder should be visible rather than inferred from a short
    // quality menu — the worker's `ready` event carries `dropped` for this.
    render(<UploadProgressView state={state({ droppedRungs: ["1080p", "720p"] })} />);
    expect(screen.getByText(/could not encode 1080p, 720p/)).toBeInTheDocument();
  });
});

describe("formatBytes", () => {
  it("uses SI powers of 1000, as every download UI and every invoice does", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1000)).toBe("1.0 kB");
    expect(formatBytes(190_000_000)).toBe("190 MB");
  });
});
