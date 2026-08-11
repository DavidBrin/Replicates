/**
 * The load-bearing property under test: whatever goes in, the exported PNG
 * measures `bw*3 x bh*3`.
 *
 * jsdom has no 2D context and no image decoding, so both are stubbed — but
 * only those two. The canvas sizing, the fit maths and the `validateTile`
 * check that gates checkout are the real ones, and the stub reports back the
 * dimensions the component actually asked the canvas for rather than the ones
 * the test would like it to have used.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { readPngMeta } from "@/domain/art";
import type { BlockRect } from "@/domain/geometry";
import {
  TileUploader,
  coverSource,
  type DecodedImage,
} from "@/components/buy/TileUploader";

/** A PNG header declaring `width x height`. Enough for `readPngMeta`. */
function fakePng(width: number, height: number): string {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13, false);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/png;base64,${btoa(binary)}`;
}

interface DrawCall {
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly args: readonly number[];
}

const draws: DrawCall[] = [];

beforeEach(() => {
  draws.length = 0;

  // The stub answers from the canvas it was given, so a component that sized
  // the canvas wrongly produces a PNG that fails `validateTile` for real.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    return {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
      drawImage: (_source: unknown, ...args: number[]) => {
        draws.push({ canvasWidth: this.width, canvasHeight: this.height, args });
      },
    } as unknown as CanvasRenderingContext2D;
  });

  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    return fakePng(this.width, this.height);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function decoded(width: number, height: number): DecodedImage {
  return { source: {} as CanvasImageSource, width, height };
}

function file(name = "art.png"): File {
  return new File(["not really an image"], name, { type: "image/png" });
}

describe("coverSource", () => {
  it("takes the full source when the aspect ratios match", () => {
    expect(coverSource(100, 100, 30, 30)).toEqual({ sx: 0, sy: 0, sw: 100, sh: 100 });
  });

  it("crops the long axis of a wide source, centred", () => {
    expect(coverSource(200, 100, 30, 30)).toEqual({ sx: 50, sy: 0, sw: 100, sh: 100 });
  });

  it("crops the long axis of a tall source, centred", () => {
    expect(coverSource(100, 400, 30, 30)).toEqual({ sx: 0, sy: 150, sw: 100, sh: 100 });
  });

  it("refuses to divide by a zero dimension", () => {
    expect(coverSource(0, 0, 30, 30)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0 });
  });
});

describe("TileUploader", () => {
  const rect: BlockRect = { bx: 0, by: 0, bw: 10, bh: 10 };

  it("draws into a canvas that is exactly the purchased pixel size", async () => {
    const onChange = vi.fn();
    render(
      <TileUploader
        rect={rect}
        value={null}
        onChange={onChange}
        decode={() => Promise.resolve(decoded(1920, 1080))}
      />,
    );

    await userEvent.upload(screen.getByLabelText(/tile image/i), file());

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(draws).toHaveLength(1);
    expect(draws[0].canvasWidth).toBe(30);
    expect(draws[0].canvasHeight).toBe(30);

    const tile = onChange.mock.calls[0][0] as string;
    expect(readPngMeta(tile)).toMatchObject({ width: 30, height: 30 });
  });

  it("crops rather than squashing under the default fit", async () => {
    render(
      <TileUploader
        rect={rect}
        value={null}
        onChange={vi.fn()}
        decode={() => Promise.resolve(decoded(400, 100))}
      />,
    );

    await userEvent.upload(screen.getByLabelText(/tile image/i), file());
    await waitFor(() => expect(draws).toHaveLength(1));

    // sx, sy, sw, sh, dx, dy, dw, dh — the source rectangle is the centred square.
    expect(draws[0].args).toEqual([150, 0, 100, 100, 0, 0, 30, 30]);
  });

  it("stretches the whole source when asked to", async () => {
    render(
      <TileUploader
        rect={rect}
        value={null}
        onChange={vi.fn()}
        decode={() => Promise.resolve(decoded(400, 100))}
      />,
    );

    await userEvent.upload(screen.getByLabelText(/tile image/i), file());
    await waitFor(() => expect(draws).toHaveLength(1));

    await userEvent.click(screen.getByLabelText(/stretch to fit/i));
    await waitFor(() => expect(draws).toHaveLength(2));
    expect(draws[1].args).toEqual([0, 0, 400, 100, 0, 0, 30, 30]);
  });

  it("redraws to the new size when the selection changes shape", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <TileUploader
        rect={rect}
        value={null}
        onChange={onChange}
        decode={() => Promise.resolve(decoded(64, 64))}
      />,
    );

    await userEvent.upload(screen.getByLabelText(/tile image/i), file());
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));

    rerender(
      <TileUploader
        rect={{ bx: 0, by: 0, bw: 4, bh: 20 }}
        value={null}
        onChange={onChange}
        decode={() => Promise.resolve(decoded(64, 64))}
      />,
    );

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    const tile = onChange.mock.calls[1][0] as string;
    expect(readPngMeta(tile)).toMatchObject({ width: 12, height: 60 });
  });

  it("says so, readably, when the browser cannot decode the file", async () => {
    const onChange = vi.fn();
    render(
      <TileUploader
        rect={rect}
        value={null}
        onChange={onChange}
        decode={() => Promise.reject(new Error("undecodable image"))}
      />,
    );

    await userEvent.upload(screen.getByLabelText(/tile image/i), file("broken.tif"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not be read as an image/i,
    );
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("surfaces the domain's own message when the exported tile is the wrong size", async () => {
    // A canvas that ignores the size it was given is exactly the failure the
    // server-side check exists for; the panel must not be able to submit it.
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(fakePng(8, 8));
    const onChange = vi.fn();

    render(
      <TileUploader
        rect={rect}
        value={null}
        onChange={onChange}
        decode={() => Promise.resolve(decoded(64, 64))}
      />,
    );

    await userEvent.upload(screen.getByLabelText(/tile image/i), file());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /exactly 30 x 30 pixels/i,
    );
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("magnifies the preview so a tiny tile is visible", () => {
    render(
      <TileUploader rect={rect} value={fakePng(30, 30)} onChange={vi.fn()} />,
    );

    const preview = screen.getByRole("img", { name: /tile preview/i });
    expect(preview).toHaveAttribute("width", "150");
    expect(preview).toHaveAttribute("height", "150");
  });
});
