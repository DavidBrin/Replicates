import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { MASTER_MIXER_TRACK_ID } from "@/domain/types";
import * as audio from "@/audio";
import { useMeter } from "./useMeter";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A minimal probe that renders the hook's return value into the DOM as text. */
function Probe({ trackId }: { trackId: string }) {
  const { left, right } = useMeter(trackId);
  return <div data-testid="probe">{`${left},${right}`}</div>;
}

describe("useMeter — no engine booted (SPEC §3.1's lazy/gesture-gated boot)", () => {
  it("renders silence without throwing when getMeterTap returns null", () => {
    vi.spyOn(audio, "getMeterTap").mockReturnValue(null);

    // Mounting must not throw even before any animation frame has fired —
    // the initial render already reads a null tap as silence.
    const { getByTestId } = render(<Probe trackId={MASTER_MIXER_TRACK_ID} />);

    expect(getByTestId("probe").textContent).toBe("0,0");
  });

  it("reads AnalyserNode peak data via getFloatTimeDomainData when a tap exists", async () => {
    const fakeTap = {
      fftSize: 4,
      getFloatTimeDomainData: (buffer: Float32Array) => {
        buffer.set([0.1, -0.6, 0.2, 0.05]);
      },
    } as unknown as AnalyserNode;
    vi.spyOn(audio, "getMeterTap").mockReturnValue(fakeTap);
    // Invoke the very first scheduled frame synchronously, then stop — the
    // hook's `tick` re-schedules itself recursively, and a rAF mock that
    // always invokes immediately would recurse forever in this synchronous
    // test environment.
    let calls = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      calls += 1;
      if (calls === 1) cb(0);
      return 0;
    });

    const { getByTestId } = render(<Probe trackId={MASTER_MIXER_TRACK_ID} />);

    const [left, right] = getByTestId("probe").textContent!.split(",").map(Number);
    expect(left).toBeCloseTo(0.6, 5);
    expect(right).toBeCloseTo(0.6, 5);
  });
});
