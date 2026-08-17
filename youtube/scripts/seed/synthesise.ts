/**
 * Painting and sounding a clip, from a {@link ClipSpec}.
 *
 * This module runs in **two places**, which is the constraint that shapes it.
 * Headless Chromium loads it to draw frames and encode audio; Node loads it for
 * {@link clipPcm} alone, to render the same audio at the fingerprinter's rate.
 * So every browser API below is touched inside a function body and never at
 * module scope — a top-level `new OffscreenCanvas(…)` would make the module
 * unloadable in Node and the Content ID half of the seed would have to
 * re-implement the audio, which is exactly the duplication that lets a claim
 * quietly stop matching.
 *
 * ## Why the clips are drawn rather than fetched
 *
 * D18 in `DECISIONS.md`: nothing in this repository is a YouTube asset, and the
 * same rule that keeps fighter art out of the sibling project keeps stock
 * footage out of this one. That is the constraint. The *requirement* is
 * different and stronger: a grid of twenty-four thumbnails that all look the
 * same reads as a broken page, not as a fixture. So the six visual kinds below
 * differ in composition as well as in hue — a gradient sweep, an oscilloscope,
 * drifting geometry, a counter, a bar meter and an orbit diagram — and each
 * clip carries its channel's palette and its own motion phase.
 *
 * ## Why the audio is real
 *
 * Content ID needs something to fingerprint. `research/06` §1.2 picks spectral
 * peaks from local maxima, so silence and white noise are both useless — one
 * has no peaks and the other has nothing but. Tones with onsets give a
 * constellation with real time structure, which is what `hash.ts` pairs.
 */

import type { FrameSource, SourceProfile } from "@/media/encode/decode-source";
import { SEGMENT_DURATION_US, segmentIndexAt } from "@/media/encode/ladder";
import type { EncodedSample, TrackConfig } from "@/media/types";

import {
  type AudioSpec,
  type ClipSpec,
  type Palette,
  audioSampleAt,
  renderAudioChannel,
} from "./corpus";

/* ============================================================== audio == */

/**
 * The rate the clips are encoded at.
 *
 * 48 kHz because that is what `AudioEncoder` is happiest with and what the
 * `mp4a` sample entry's 16.16 sample-rate field can hold (`boxes.ts` refuses
 * anything above 65535). Unrelated to the 11 025 Hz the fingerprinter analyses
 * at — {@link clipPcm} renders the same spec at that rate instead of resampling
 * this one, because resampling would introduce a filter the reference and the
 * query would then have to agree about.
 */
export const AUDIO_SAMPLE_RATE = 48_000;
export const AUDIO_CHANNELS = 2;
export const AUDIO_BITRATE = 128_000;

/** AAC-LC. Verified present in headless Chromium — see `generate-clips.ts`. */
export const AUDIO_CODEC = "mp4a.40.2";

/** One `AudioData` per AAC frame, which is what the encoder consumes anyway. */
const AUDIO_FRAME_SAMPLES = 1024;

/**
 * The clip's audio at the fingerprinter's own rate, mono.
 *
 * `research/06` §3 fixes analysis at 11 025 Hz, and `domain/fingerprint`
 * documents that decoding, downmixing and resampling are deliberately not its
 * job. Here there is nothing to decode: the spec is a function of time, so the
 * "downmix" is evaluating channel 0 and the "resample" is evaluating at a
 * different step. That is why this is a two-line function and not a resampler.
 */
export function clipPcm(spec: AudioSpec, durationSeconds: number, sampleRate: number): Float32Array {
  return renderAudioChannel(spec, sampleRate, durationSeconds, 0);
}

/**
 * Encode the clip's audio to AAC, grouped into the same 2-second segments the
 * video rungs use.
 *
 * Grouped on `segmentIndexAt(timestamp)` — the same pure function `transcode.ts`
 * cuts video on — rather than on a running count of frames. An AAC frame is
 * 1024 samples, which is 21.3 ms at 48 kHz and does not divide 2 s, so a
 * frame-counted boundary would drift against the video's by up to a frame per
 * segment and the audio playlist's `EXTINF` values would slowly stop describing
 * the same spans as the video's.
 *
 * **Not measured:** AAC encoders carry a priming delay of a couple of frames,
 * and nothing here compensates for it — the first segment's audio may lead or
 * lag the video by ~20 ms. Fixing it properly needs an edit list in `elst`,
 * which the muxer does not write. Recorded rather than silently accepted.
 */
export async function encodeClipAudio(
  spec: AudioSpec,
  durationSeconds: number,
): Promise<{ track: TrackConfig; samples: EncodedSample[] } | null> {
  if (typeof AudioEncoder === "undefined") return null;

  const config: AudioEncoderConfig = {
    codec: AUDIO_CODEC,
    sampleRate: AUDIO_SAMPLE_RATE,
    numberOfChannels: AUDIO_CHANNELS,
    bitrate: AUDIO_BITRATE,
  };
  const support = await AudioEncoder.isConfigSupported(config).catch(() => undefined);
  if (support?.supported !== true) return null;

  const samples: EncodedSample[] = [];
  let track: TrackConfig | undefined;
  let failure: unknown;

  const encoder = new AudioEncoder({
    output: (chunk, metadata) => {
      if (!track) {
        const description = metadata?.decoderConfig?.description;
        if (!description) return;
        track = {
          kind: "audio",
          codec: metadata?.decoderConfig?.codec ?? AUDIO_CODEC,
          // The AudioSpecificConfig, verbatim. `boxes.ts` writes it into `esds`
          // unchanged for the same reason it writes `avcC` unchanged: the
          // encoder is the authority on what it just produced.
          description: copyBytes(description),
          timescale: AUDIO_SAMPLE_RATE,
          sampleRate: AUDIO_SAMPLE_RATE,
          channelCount: AUDIO_CHANNELS,
        };
      }
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      samples.push({
        data,
        timestampUs: chunk.timestamp,
        durationUs: chunk.duration ?? Math.round((AUDIO_FRAME_SAMPLES * 1e6) / AUDIO_SAMPLE_RATE),
        // Every AAC frame is independently decodable. Saying so is what lets a
        // player start on any audio segment.
        isKeyFrame: true,
        compositionOffsetUs: 0,
      });
    },
    error: (error) => {
      failure ??= error;
    },
  });

  encoder.configure(config);

  const totalFrames = Math.round(AUDIO_SAMPLE_RATE * durationSeconds);
  for (let start = 0; start < totalFrames; start += AUDIO_FRAME_SAMPLES) {
    if (failure) break;
    const count = Math.min(AUDIO_FRAME_SAMPLES, totalFrames - start);
    const interleaved = new Float32Array(count * AUDIO_CHANNELS);
    for (let n = 0; n < count; n++) {
      const t = (start + n) / AUDIO_SAMPLE_RATE;
      for (let channel = 0; channel < AUDIO_CHANNELS; channel++) {
        interleaved[n * AUDIO_CHANNELS + channel] = audioSampleAt(spec, t, channel);
      }
    }
    encoder.encode(
      new AudioData({
        format: "f32",
        sampleRate: AUDIO_SAMPLE_RATE,
        numberOfFrames: count,
        numberOfChannels: AUDIO_CHANNELS,
        timestamp: Math.round((start * 1e6) / AUDIO_SAMPLE_RATE),
        data: interleaved,
      }),
    );
  }

  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  if (!track || samples.length === 0) return null;
  return { track, samples };
}

/** Cut an encoded audio track into the segments the packager will publish. */
export function groupAudioSegments(
  samples: readonly EncodedSample[],
): { index: number; startUs: number; durationUs: number; samples: EncodedSample[] }[] {
  const byIndex = new Map<number, EncodedSample[]>();
  for (const sample of samples) {
    const index = segmentIndexAt(sample.timestampUs, SEGMENT_DURATION_US);
    const bucket = byIndex.get(index);
    if (bucket) bucket.push(sample);
    else byIndex.set(index, [sample]);
  }

  return [...byIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, group]) => {
      const first = group[0]!;
      const last = group[group.length - 1]!;
      return {
        index,
        startUs: first.timestampUs,
        durationUs: last.timestampUs + last.durationUs - first.timestampUs,
        samples: group,
      };
    });
}

function copyBytes(source: AllowSharedBufferSource): Uint8Array {
  const view = ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    : new Uint8Array(source);
  return new Uint8Array(view);
}

/* ============================================================ frames == */

export interface SyntheticSourceOptions {
  /** Where in the clip's own timeline to begin. Used for the hover preview. */
  readonly startSeconds?: number;
  /** How much of it to emit. Defaults to the rest of the clip. */
  readonly durationSeconds?: number;
}

/**
 * A {@link FrameSource} that draws its frames instead of decoding them.
 *
 * The port `decode-source.ts` defines has exactly three members, and none of
 * them says anything about a container — which is what makes this legal rather
 * than a bypass. `decodedFrameSource` needs a demuxer this repository does not
 * have and `mediaStreamFrameSource` runs at wall-clock speed; a generator is
 * the third case the interface was written wide enough to admit, and it is
 * `faster-than-realtime` for the same reason the decoder path is: nothing here
 * waits for a clock.
 *
 * Timestamps are computed as `round(index × 1e6 / fps)` rather than accumulated,
 * so they cannot drift, and the segment gate in `ladder.ts` — which derives
 * keyframes from the timestamp precisely to survive drift — gets a clean
 * timeline to work from.
 */
export function syntheticFrameSource(
  spec: ClipSpec,
  options: SyntheticSourceOptions = {},
): FrameSource {
  const startSeconds = options.startSeconds ?? 0;
  const durationSeconds = options.durationSeconds ?? spec.durationSeconds - startSeconds;
  const frameCount = Math.max(1, Math.round(durationSeconds * spec.frameRate));

  const profile: SourceProfile = {
    width: spec.width,
    height: spec.height,
    frameRate: spec.frameRate,
    durationUs: Math.round(durationSeconds * 1e6),
    frameCount,
  };

  return {
    profile,
    throughput: "faster-than-realtime",
    frames: (signal) => generateFrames(spec, startSeconds, frameCount, signal),
  };
}

async function* generateFrames(
  spec: ClipSpec,
  startSeconds: number,
  frameCount: number,
  signal: AbortSignal | undefined,
): AsyncGenerator<VideoFrame, void, void> {
  const canvas = new OffscreenCanvas(spec.width, spec.height);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("No 2D context for the synthesis canvas.");

  const frameDurationUs = Math.round(1e6 / spec.frameRate);
  for (let index = 0; index < frameCount; index++) {
    if (signal?.aborted) return;
    const timestampUs = Math.round((index * 1e6) / spec.frameRate);
    drawClipFrame(context, spec, startSeconds + timestampUs / 1e6);
    // The consumer owns and closes this — `forEachFrame` in `decode-source.ts`
    // guarantees that even when the visitor throws.
    yield new VideoFrame(canvas, { timestamp: timestampUs, duration: frameDurationUs });
  }
}

/* ============================================================ drawing == */

const FONT_STACK = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO_STACK = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

type Ctx = OffscreenCanvasRenderingContext2D;

/**
 * Paint one frame of a clip at time `t`.
 *
 * Split into a background wash, the motion layer, and a chrome layer that is
 * identical across every kind — a caption and a progress bar. The chrome is not
 * decoration: it is what makes a *still* legible. A thumbnail extracted from a
 * pure abstract animation is a coloured rectangle, and twenty-four of those in
 * a grid is indistinguishable from a page that failed to load its images.
 */
export function drawClipFrame(context: Ctx, spec: ClipSpec, t: number): void {
  const { width, height, palette } = spec;
  const progress = Math.min(1, Math.max(0, t / spec.durationSeconds));

  context.save();
  drawBackground(context, spec, t);

  switch (spec.visual) {
    case "gradient":
      drawGradient(context, spec, t);
      break;
    case "waveform":
      drawWaveform(context, spec, t);
      break;
    case "drift":
      drawDrift(context, spec, t);
      break;
    case "counter":
      drawCounter(context, spec, t);
      break;
    case "bars":
      drawBars(context, spec, t);
      break;
    case "orbit":
      drawOrbit(context, spec, t);
      break;
  }

  drawChrome(context, spec, palette, progress, width, height);
  context.restore();
}

function drawBackground(context: Ctx, spec: ClipSpec, t: number): void {
  const [background] = spec.palette;
  context.fillStyle = background;
  context.fillRect(0, 0, spec.width, spec.height);

  // A slow vignette wash, shared by every kind, so a frame never reads as flat
  // fill even in the quiet parts of a clip.
  const wobble = 0.5 + 0.5 * Math.sin(t * 0.6 + spec.phase * Math.PI * 2);
  const radial = context.createRadialGradient(
    spec.width * (0.3 + wobble * 0.4),
    spec.height * 0.35,
    0,
    spec.width * 0.5,
    spec.height * 0.5,
    Math.max(spec.width, spec.height) * 0.85,
  );
  radial.addColorStop(0, withAlpha(spec.palette[2], 0.22));
  radial.addColorStop(1, withAlpha(spec.palette[0], 0));
  context.fillStyle = radial;
  context.fillRect(0, 0, spec.width, spec.height);
}

function drawGradient(context: Ctx, spec: ClipSpec, t: number): void {
  const { width, height } = spec;
  const sweep = (t * 0.22 + spec.phase) % 1;
  const angle = sweep * Math.PI * 2;
  const gradient = context.createLinearGradient(
    width / 2 - (Math.cos(angle) * width) / 2,
    height / 2 - (Math.sin(angle) * height) / 2,
    width / 2 + (Math.cos(angle) * width) / 2,
    height / 2 + (Math.sin(angle) * height) / 2,
  );
  gradient.addColorStop(0, withAlpha(spec.palette[2], 0.85));
  gradient.addColorStop(0.5, withAlpha(spec.palette[1], 0.35));
  gradient.addColorStop(1, withAlpha(spec.palette[2], 0.05));
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  // Three soft blobs on independent Lissajous paths, so the field has a
  // parallax that a single sweep does not.
  for (let i = 0; i < 3; i++) {
    const phase = spec.phase * Math.PI * 2 + i * 2.1;
    const x = width * (0.5 + 0.32 * Math.sin(t * (0.31 + i * 0.11) + phase));
    const y = height * (0.5 + 0.3 * Math.cos(t * (0.24 + i * 0.13) + phase * 1.7));
    const r = Math.min(width, height) * (0.2 + i * 0.06);
    const blob = context.createRadialGradient(x, y, 0, x, y, r);
    blob.addColorStop(0, withAlpha(spec.palette[1], 0.4));
    blob.addColorStop(1, withAlpha(spec.palette[1], 0));
    context.fillStyle = blob;
    context.beginPath();
    context.arc(x, y, r, 0, Math.PI * 2);
    context.fill();
  }
}

function drawWaveform(context: Ctx, spec: ClipSpec, t: number): void {
  const { width, height } = spec;
  const midline = height * 0.46;

  context.strokeStyle = withAlpha(spec.palette[1], 0.14);
  context.lineWidth = 1;
  for (let x = 0; x <= width; x += Math.round(width / 24)) {
    context.beginPath();
    context.moveTo(x + 0.5, height * 0.12);
    context.lineTo(x + 0.5, height * 0.8);
    context.stroke();
  }

  // Three traces of the clip's own audio, read a few milliseconds apart, so the
  // oscilloscope is showing the sound the viewer is hearing rather than an
  // unrelated sine.
  const traces = [
    { offset: 0, alpha: 1, scale: 1, colour: spec.palette[1] },
    { offset: 0.004, alpha: 0.55, scale: 0.72, colour: spec.palette[2] },
    { offset: 0.009, alpha: 0.3, scale: 0.48, colour: spec.palette[2] },
  ];
  const step = Math.max(1, Math.round(width / 320));
  for (const trace of traces) {
    context.strokeStyle = withAlpha(trace.colour, trace.alpha);
    context.lineWidth = Math.max(1.5, height / 160);
    context.beginPath();
    for (let x = 0; x <= width; x += step) {
      const local = t + trace.offset + (x / width) * 0.02;
      const value = audioSampleAt(spec.audio, local, 0);
      const y = midline - value * height * 0.3 * trace.scale;
      if (x === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
  }
}

function drawDrift(context: Ctx, spec: ClipSpec, t: number): void {
  const { width, height } = spec;
  const unit = Math.min(width, height);

  for (let i = 0; i < 9; i++) {
    const seedPhase = spec.phase * 7 + i * 0.73;
    const speed = 0.06 + (i % 4) * 0.035;
    // Wrapped rather than bounced, so shapes leave one edge and re-enter the
    // other and the field never settles into a standing pattern.
    const x = (((t * speed + seedPhase) % 1.4) - 0.2) * width;
    const y = height * (0.16 + ((i * 0.37 + spec.phase) % 1) * 0.68);
    const size = unit * (0.07 + ((i * 0.19 + spec.phase) % 1) * 0.14);
    const sides = 3 + (i % 4);

    context.save();
    context.translate(x, y);
    context.rotate(t * (0.5 + (i % 3) * 0.4) + seedPhase);
    context.beginPath();
    for (let corner = 0; corner < sides; corner++) {
      const angle = (corner / sides) * Math.PI * 2;
      const px = Math.cos(angle) * size;
      const py = Math.sin(angle) * size;
      if (corner === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    context.closePath();
    if (i % 3 === 0) {
      context.fillStyle = withAlpha(spec.palette[2], 0.32);
      context.fill();
    }
    context.strokeStyle = withAlpha(spec.palette[1], 0.7);
    context.lineWidth = Math.max(1.5, unit / 220);
    context.stroke();
    context.restore();
  }
}

function drawCounter(context: Ctx, spec: ClipSpec, t: number): void {
  const { width, height } = spec;
  const unit = Math.min(width, height);
  const centreX = width * 0.5;
  const centreY = height * 0.44;
  const radius = unit * 0.3;
  const progress = Math.min(1, t / spec.durationSeconds);

  context.strokeStyle = withAlpha(spec.palette[1], 0.18);
  context.lineWidth = unit * 0.035;
  context.beginPath();
  context.arc(centreX, centreY, radius, 0, Math.PI * 2);
  context.stroke();

  context.strokeStyle = spec.palette[2];
  context.lineCap = "round";
  context.beginPath();
  context.arc(centreX, centreY, radius, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
  context.stroke();
  context.lineCap = "butt";

  // Tick marks, one per second of the clip, so the ring reads as a measure of
  // something rather than as a loading spinner.
  const ticks = Math.max(4, Math.round(spec.durationSeconds));
  for (let i = 0; i < ticks; i++) {
    const angle = -Math.PI / 2 + (i / ticks) * Math.PI * 2;
    const inner = radius * 1.14;
    const outer = radius * (i % 5 === 0 ? 1.26 : 1.2);
    context.strokeStyle = withAlpha(spec.palette[1], i / ticks <= progress ? 0.9 : 0.25);
    context.lineWidth = Math.max(1, unit / 200);
    context.beginPath();
    context.moveTo(centreX + Math.cos(angle) * inner, centreY + Math.sin(angle) * inner);
    context.lineTo(centreX + Math.cos(angle) * outer, centreY + Math.sin(angle) * outer);
    context.stroke();
  }

  const frame = Math.round(t * spec.frameRate);
  context.fillStyle = spec.palette[1];
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `600 ${Math.round(unit * 0.19)}px ${MONO_STACK}`;
  context.fillText(timecode(t), centreX, centreY - unit * 0.03);
  context.font = `400 ${Math.round(unit * 0.07)}px ${MONO_STACK}`;
  context.fillStyle = withAlpha(spec.palette[1], 0.6);
  context.fillText(`frame ${String(frame).padStart(5, "0")}`, centreX, centreY + unit * 0.13);
}

function drawBars(context: Ctx, spec: ClipSpec, t: number): void {
  const { width, height } = spec;
  const count = 28;
  const gap = width / count;
  const barWidth = gap * 0.62;
  const floor = height * 0.78;

  for (let i = 0; i < count; i++) {
    // Each bar samples the audio at its own small time offset, which turns the
    // one-dimensional signal into a travelling wave across the frame — the
    // reading a spectrum display gives you, from a waveform.
    const local = t - (i / count) * 0.09;
    const value = Math.abs(audioSampleAt(spec.audio, local, i % 2));
    const shaped = Math.pow(value, 0.6);
    const barHeight = height * 0.08 + shaped * height * 0.56;
    const x = i * gap + (gap - barWidth) / 2;

    const gradient = context.createLinearGradient(0, floor - barHeight, 0, floor);
    gradient.addColorStop(0, spec.palette[2]);
    gradient.addColorStop(1, withAlpha(spec.palette[1], 0.35));
    context.fillStyle = gradient;
    context.fillRect(x, floor - barHeight, barWidth, barHeight);

    // The cap that lags the bar is what makes a meter read as a meter.
    context.fillStyle = withAlpha(spec.palette[1], 0.9);
    context.fillRect(x, floor - barHeight - height * 0.012, barWidth, height * 0.008);
  }

  context.strokeStyle = withAlpha(spec.palette[1], 0.35);
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, floor + 0.5);
  context.lineTo(width, floor + 0.5);
  context.stroke();
}

function drawOrbit(context: Ctx, spec: ClipSpec, t: number): void {
  const { width, height } = spec;
  const unit = Math.min(width, height);
  const centreX = width * 0.5;
  const centreY = height * 0.45;

  for (let ring = 0; ring < 4; ring++) {
    const a = unit * (0.13 + ring * 0.1);
    const b = a * (0.42 + ring * 0.09);
    const tilt = spec.phase * Math.PI + ring * 0.5;

    context.save();
    context.translate(centreX, centreY);
    context.rotate(tilt);
    context.strokeStyle = withAlpha(spec.palette[1], 0.24);
    context.lineWidth = Math.max(1, unit / 300);
    context.beginPath();
    context.ellipse(0, 0, a, b, 0, 0, Math.PI * 2);
    context.stroke();

    // A short trail behind each body, drawn as fading dots rather than as a
    // stroked path so the fade is per-sample and does not need a second canvas.
    const speed = 0.9 - ring * 0.16;
    for (let trail = 6; trail >= 0; trail--) {
      const angle = (t - trail * 0.045) * speed + ring * 1.9 + spec.phase * 6;
      const x = Math.cos(angle) * a;
      const y = Math.sin(angle) * b;
      const size = unit * (0.022 - trail * 0.0022);
      context.fillStyle = withAlpha(
        trail === 0 ? spec.palette[1] : spec.palette[2],
        trail === 0 ? 1 : 0.42 - trail * 0.055,
      );
      context.beginPath();
      context.arc(x, y, Math.max(0.5, size), 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  context.fillStyle = withAlpha(spec.palette[2], 0.9);
  context.beginPath();
  context.arc(centreX, centreY, unit * 0.035, 0, Math.PI * 2);
  context.fill();
}

/** The caption strip and progress bar every clip carries. See `drawClipFrame`. */
function drawChrome(
  context: Ctx,
  spec: ClipSpec,
  palette: Palette,
  progress: number,
  width: number,
  height: number,
): void {
  const unit = Math.min(width, height);
  const stripHeight = unit * 0.2;

  const scrim = context.createLinearGradient(0, height - stripHeight * 1.7, 0, height);
  scrim.addColorStop(0, withAlpha(palette[0], 0));
  scrim.addColorStop(1, withAlpha(palette[0], 0.92));
  context.fillStyle = scrim;
  context.fillRect(0, height - stripHeight * 1.7, width, stripHeight * 1.7);

  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.fillStyle = palette[1];
  context.font = `600 ${Math.round(unit * 0.072)}px ${FONT_STACK}`;
  const caption = fitText(context, spec.caption, width - unit * 0.16);
  context.fillText(caption, unit * 0.08, height - unit * 0.115);

  context.fillStyle = withAlpha(palette[1], 0.2);
  context.fillRect(unit * 0.08, height - unit * 0.06, width - unit * 0.16, unit * 0.012);
  context.fillStyle = palette[2];
  context.fillRect(
    unit * 0.08,
    height - unit * 0.06,
    (width - unit * 0.16) * progress,
    unit * 0.012,
  );
}

/** Truncate with an ellipsis so a long title cannot run off the frame. */
function fitText(context: Ctx, text: string, maxWidth: number): string {
  if (context.measureText(text).width <= maxWidth) return text;
  let cut = text.length;
  while (cut > 1 && context.measureText(`${text.slice(0, cut)}…`).width > maxWidth) cut--;
  return `${text.slice(0, cut)}…`;
}

function timecode(seconds: number): string {
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/**
 * `#rrggbb` plus an alpha, as `rgba(…)`.
 *
 * Written out rather than using an eight-digit hex because the palettes are
 * six-digit by contract and appending two more characters to a value that might
 * already carry them is the kind of thing that silently produces `#ff8a3d80cc`
 * — a colour the canvas parses as transparent black and draws as nothing.
 */
function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/* ============================================================= stills == */

/**
 * A poster frame, as JPEG bytes.
 *
 * Drawn at the requested output size rather than at the clip's size and scaled:
 * the chrome above is laid out in units of the *short side*, so rendering at
 * 1280×720 and letting the caption size itself gives a legible thumbnail, where
 * upscaling a 640×360 frame would give a soft one with soft text.
 */
export async function renderPoster(
  spec: ClipSpec,
  atSeconds: number,
  width: number,
  height: number,
  quality = 0.82,
): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("No 2D context for the poster canvas.");
  drawClipFrame(context, { ...spec, width, height }, atSeconds);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
  return new Uint8Array(await blob.arrayBuffer());
}

export interface ChannelArtSpec {
  readonly monogram: string;
  readonly name: string;
  readonly palette: Palette;
}

/** The channel avatar: a monogram on the channel's own palette. */
export async function renderAvatar(art: ChannelArtSpec, size = 176): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("No 2D context for the avatar canvas.");

  const gradient = context.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, art.palette[2]);
  gradient.addColorStop(1, art.palette[0]);
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  context.fillStyle = art.palette[1];
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `700 ${Math.round(size * 0.42)}px ${FONT_STACK}`;
  // `+ size * 0.02` because a text baseline centred by metrics sits visually
  // high for uppercase glyphs, which is very obvious in a circular crop.
  context.fillText(art.monogram, size / 2, size / 2 + size * 0.02);

  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * The channel banner, at YouTube's own 6.2:1 header aspect.
 *
 * 2048×328 rather than the 2560×1440 "full" asset: the header crop is what any
 * of these surfaces actually shows, and generating the uncropped version would
 * be four times the bytes for a region nothing renders.
 */
export async function renderBanner(
  art: ChannelArtSpec,
  width = 2048,
  height = 328,
): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("No 2D context for the banner canvas.");

  context.fillStyle = art.palette[0];
  context.fillRect(0, 0, width, height);

  const sweep = context.createLinearGradient(0, 0, width, height);
  sweep.addColorStop(0, withAlpha(art.palette[2], 0.9));
  sweep.addColorStop(0.55, withAlpha(art.palette[0], 0.2));
  sweep.addColorStop(1, withAlpha(art.palette[2], 0.55));
  context.fillStyle = sweep;
  context.fillRect(0, 0, width, height);

  // Diagonal hatching, spaced by the golden ratio so the repeat is not obvious.
  context.strokeStyle = withAlpha(art.palette[1], 0.14);
  context.lineWidth = 2;
  for (let x = -height; x < width; x += Math.round(height * 0.1618)) {
    context.beginPath();
    context.moveTo(x, height);
    context.lineTo(x + height, 0);
    context.stroke();
  }

  context.fillStyle = art.palette[1];
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.font = `700 ${Math.round(height * 0.34)}px ${FONT_STACK}`;
  context.fillText(art.name, width * 0.06, height * 0.5);

  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.86 });
  return new Uint8Array(await blob.arrayBuffer());
}
