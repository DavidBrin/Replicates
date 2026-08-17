// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";

import { stubMediaCapabilities } from "../../../../vitest.setup";
import {
  CODEC_PREFERENCE,
  CodecNegotiationError,
  encoderConfigFor,
  isCodecNegotiationError,
  negotiateLadder,
} from "../capabilities";
import type { LadderShape } from "../ladder";
import { selectLadder } from "../ladder";

/**
 * What these tests can and cannot prove.
 *
 * They prove the *negotiation*: which candidates are offered, in what order,
 * what is asked of `isConfigSupported`, and what happens to the ladder when an
 * answer comes back false. That is all pure decision-making and it is where the
 * bugs that matter live — a probe that asks for `prefer-hardware` silently
 * fails every headless run (research/01 §4.3), and a probe that never asks for
 * `avc: { format: "avc" }` gets an Annex-B bitstream the muxer cannot use.
 *
 * They prove nothing about whether the negotiated codec actually encodes. A
 * `VideoEncoder` faked to the point where it produces bytes would be testing
 * the fake. Real encode belongs in Playwright against real Chromium.
 */

const ladder1080 = selectLadder({ width: 1920, height: 1080 });

interface Probe {
  readonly configs: VideoEncoderConfig[];
  readonly encoder: unknown;
}

/** A `VideoEncoder` stand-in that answers `isConfigSupported` from a predicate. */
function probe(accept: (config: VideoEncoderConfig) => boolean): Probe {
  const configs: VideoEncoderConfig[] = [];
  return {
    configs,
    encoder: {
      isConfigSupported(config: VideoEncoderConfig) {
        configs.push(config);
        return Promise.resolve({ supported: accept(config), config });
      },
    },
  };
}

let restore: (() => void) | undefined;

function install(accept: (config: VideoEncoderConfig) => boolean): Probe {
  const p = probe(accept);
  restore = stubMediaCapabilities({ videoEncoder: p.encoder });
  return p;
}

afterEach(() => {
  restore?.();
  restore = undefined;
});

const acceptAll = () => true;
const startsWith = (prefix: string) => (c: VideoEncoderConfig) =>
  c.codec.startsWith(prefix);

describe("CODEC_PREFERENCE", () => {
  it("is AVC, then AV1, then VP9", () => {
    // The order is a compatibility argument, not a quality one. Both AVC and
    // AV1 are on Apple's native-HLS codec list; VP9 is not (research/02 §7), so
    // a VP9 ladder can only ever be played by an MSE player in a browser.
    expect(CODEC_PREFERENCE).toEqual(["avc", "av1", "vp9"]);
  });
});

describe("negotiateLadder — environment", () => {
  it("reports no-webcodecs when VideoEncoder is absent", async () => {
    // Node has no WebCodecs, and vitest.setup deliberately does not fake it.
    await expect(
      negotiateLadder({ shapes: ladder1080, frameRate: 30 }),
    ).rejects.toSatisfy(
      (e: unknown) => isCodecNegotiationError(e) && e.reason === "no-webcodecs",
    );
  });

  it("reports no-webcodecs when VideoEncoder exists without isConfigSupported", async () => {
    // Old Safari technology previews shipped the constructor before the static.
    restore = stubMediaCapabilities({ videoEncoder: function VideoEncoder() {} });
    await expect(
      negotiateLadder({ shapes: ladder1080, frameRate: 30 }),
    ).rejects.toSatisfy(
      (e: unknown) => isCodecNegotiationError(e) && e.reason === "no-webcodecs",
    );
  });

  it("reports no-supported-codec when every candidate is rejected", async () => {
    install(() => false);
    const error = await negotiateLadder({
      shapes: ladder1080,
      frameRate: 30,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CodecNegotiationError);
    expect(isCodecNegotiationError(error) && error.reason).toBe(
      "no-supported-codec",
    );
  });

  it("treats a throwing isConfigSupported as unsupported rather than fatal", async () => {
    // w3c/webcodecs#686: implementations disagree about whether a malformed
    // config throws or resolves false. Either answer must mean "try the next".
    restore = stubMediaCapabilities({
      videoEncoder: {
        isConfigSupported(config: VideoEncoderConfig) {
          if (config.codec.startsWith("avc1")) throw new TypeError("nope");
          return Promise.resolve({ supported: true, config });
        },
      },
    });

    const negotiated = await negotiateLadder({
      shapes: ladder1080,
      frameRate: 30,
    });
    expect(negotiated.family).toBe("av1");
  });
});

describe("negotiateLadder — codec selection", () => {
  it("picks AVC High profile at the level each rung needs", async () => {
    install(acceptAll);
    const negotiated = await negotiateLadder({
      shapes: ladder1080,
      frameRate: 30,
    });
    expect(negotiated.family).toBe("avc");
    expect(negotiated.rungs.map((r) => [r.name, r.codec])).toEqual([
      ["1080p", "avc1.640028"], // High, L4.0
      ["720p", "avc1.64001f"], // High, L3.1
      ["480p", "avc1.64001f"], // High, L3.1
      ["360p", "avc1.64001e"], // High, L3.0
      ["240p", "avc1.640015"], // High, L2.1
      ["144p", "avc1.64000d"], // High, L1.3
    ]);
    expect(negotiated.dropped).toEqual([]);
  });

  it("moves 1080p to level 4.2 above 30fps", async () => {
    install(acceptAll);
    const negotiated = await negotiateLadder({
      shapes: ladder1080,
      frameRate: 60,
    });
    expect(negotiated.rungs[0]?.codec).toBe("avc1.64002a");
    // Only the 1080p rung's level moves; research/01 §6.5 assigns L4.2 for
    // 1080p60 specifically.
    expect(negotiated.rungs[1]?.codec).toBe("avc1.64001f");
  });

  it("falls from High to Main to Baseline within AVC", async () => {
    install((c) => c.codec.startsWith("avc1.4d"));
    const negotiated = await negotiateLadder({
      shapes: ladder1080,
      frameRate: 30,
    });
    expect(negotiated.family).toBe("avc");
    expect(negotiated.rungs[0]?.codec).toBe("avc1.4d0028");

    install((c) => c.codec.startsWith("avc1.42"));
    const baseline = await negotiateLadder({ shapes: ladder1080, frameRate: 30 });
    expect(baseline.rungs[0]?.codec).toBe("avc1.420028");
  });

  it("falls back to AV1 before VP9", async () => {
    install(startsWith("av01"));
    const negotiated = await negotiateLadder({
      shapes: ladder1080,
      frameRate: 30,
    });
    expect(negotiated.family).toBe("av1");
    expect(negotiated.rungs.map((r) => [r.name, r.codec])).toEqual([
      ["1080p", "av01.0.08M.08"],
      ["720p", "av01.0.05M.08"],
      ["480p", "av01.0.04M.08"],
      ["360p", "av01.0.01M.08"],
      ["240p", "av01.0.00M.08"],
      ["144p", "av01.0.00M.08"],
    ]);
  });

  it("falls back to VP9 last", async () => {
    install(startsWith("vp09"));
    const negotiated = await negotiateLadder({
      shapes: ladder1080,
      frameRate: 30,
    });
    expect(negotiated.family).toBe("vp9");
    expect(negotiated.rungs.map((r) => [r.name, r.codec])).toEqual([
      ["1080p", "vp09.00.40.08"],
      ["720p", "vp09.00.31.08"],
      ["480p", "vp09.00.30.08"],
      ["360p", "vp09.00.21.08"],
      ["240p", "vp09.00.20.08"],
      ["144p", "vp09.00.10.08"],
    ]);
  });

  it("honours an explicit preference order", async () => {
    install(acceptAll);
    const negotiated = await negotiateLadder({
      shapes: ladder1080,
      frameRate: 30,
      preference: ["vp9", "avc"],
    });
    expect(negotiated.family).toBe("vp9");
  });

  it("drops the rungs a device cannot reach instead of abandoning the family", async () => {
    // The realistic failure: a level cap, not a codec gap. A machine that
    // cannot do 1080p can still serve everything below it, and switching to
    // VP9 to keep a rung nobody can play would be a worse trade.
    install((c) => c.codec.startsWith("avc1") && c.height < 1080);
    const negotiated = await negotiateLadder({
      shapes: ladder1080,
      frameRate: 30,
    });
    expect(negotiated.family).toBe("avc");
    expect(negotiated.rungs.map((r) => r.name)).toEqual([
      "720p",
      "480p",
      "360p",
      "240p",
      "144p",
    ]);
    expect(negotiated.dropped).toEqual(["1080p"]);
  });

  it("carries each rung's dimensions and bitrate through untouched", async () => {
    install(acceptAll);
    const shapes: LadderShape[] = selectLadder({ width: 1080, height: 1920 });
    const negotiated = await negotiateLadder({ shapes, frameRate: 30 });
    expect(
      negotiated.rungs.map(({ name, width, height, bitrate }) => ({
        name,
        width,
        height,
        bitrate,
      })),
    ).toEqual(shapes);
  });
});

describe("the probe config", () => {
  it("never asks for hardware acceleration", async () => {
    // research/01 §4.3: `prefer-hardware` returns false in default headless
    // Chromium and the subsequent encode throws InvalidStateError, so a probe
    // that asks for it turns the seed script's every run into a failure while
    // a software encoder sits right there.
    const p = install(acceptAll);
    await negotiateLadder({ shapes: ladder1080, frameRate: 30 });
    expect(p.configs.length).toBeGreaterThan(0);
    for (const config of p.configs) {
      expect(config.hardwareAcceleration).toBe("no-preference");
    }
  });

  it("asks AVC for length-prefixed output, not Annex B", async () => {
    // research/01 §2.4: `format: "avc"` is what puts SPS/PPS in
    // decoderConfig.description instead of inline in the bitstream, which is
    // exactly the avcC payload the muxer copies (research/02 §2.1).
    const p = install(startsWith("avc1"));
    await negotiateLadder({ shapes: ladder1080, frameRate: 30 });
    const avcConfigs = p.configs.filter((c) => c.codec.startsWith("avc1"));
    expect(avcConfigs.length).toBeGreaterThan(0);
    for (const config of avcConfigs) {
      expect(config.avc).toEqual({ format: "avc" });
    }
  });

  it("probes the exact dimensions, bitrate and frame rate it will encode at", async () => {
    const p = install(acceptAll);
    await negotiateLadder({ shapes: ladder1080, frameRate: 30 });
    const top = p.configs[0];
    expect(top).toMatchObject({
      width: 1920,
      height: 1080,
      bitrate: 5_000_000,
      framerate: 30,
      bitrateMode: "variable",
      latencyMode: "quality",
    });
  });

  it("configures encoders with the same config it probed", async () => {
    const p = install(acceptAll);
    const negotiated = await negotiateLadder({ shapes: ladder1080, frameRate: 30 });
    const rung = negotiated.rungs[0]!;
    // A probe that validates one config and an encoder that is handed another
    // is the classic way `isConfigSupported: true` still ends in a closed codec.
    expect(encoderConfigFor(rung, 30)).toEqual(p.configs[0]);
  });

  it("omits the avc extension for non-AVC families", async () => {
    install(startsWith("vp09"));
    const negotiated = await negotiateLadder({ shapes: ladder1080, frameRate: 30 });
    expect(encoderConfigFor(negotiated.rungs[0]!, 30).avc).toBeUndefined();
  });
});
