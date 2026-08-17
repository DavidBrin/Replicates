"use client";

import clsx from "clsx";

import { describeDuration, formatDuration } from "@/domain/format";

import { estimateRemainingSeconds, type UploadState } from "./upload-machine";

/** Three states, because "not negotiated yet" is not the same as either regime. */
type ThroughputRegimeLabel = "faster-than-realtime" | "realtime" | "unknown";

/**
 * The encode and the upload, reported as two things — because they are two
 * things, running at once.
 *
 * The brief's rule is "a progress bar that jumps to 90% and sits there is the
 * thing to avoid", and there are three separate ways to produce one here. Each
 * is refused explicitly:
 *
 *  1. **A single combined percentage.** Encoding and uploading overlap and are
 *     not the same work; averaging them produces a number that means nothing
 *     and stalls whenever one of the two is between milestones. Two bars.
 *  2. **A fabricated denominator for the upload.** The total object count is
 *     unknown until the encode finishes — segments are produced as they are
 *     encoded. So the upload is reported as a count *so far*, never as a
 *     percentage of a total that does not exist yet. The one exception is the
 *     progressive path, where the total is the file's size and is known before
 *     the first byte moves.
 *  3. **A determinate bar with an indeterminate fraction.** `TranscodeProgress
 *     .fraction` is `undefined` when neither a duration nor a frame count was
 *     declared, and its own header says the UI must render that as
 *     indeterminate: "a made-up fraction that jumps to 100% and sits there is
 *     worse than no bar". `Bar` below drops `aria-valuenow` entirely in that
 *     case, which is what makes a screen reader say "busy" rather than a lie.
 *
 * ## The throughput regime is the headline
 *
 * `src/media/encode/decode-source.ts` puts it plainly: the difference between
 * the demuxer path and the `MediaStreamTrack` path "is not an implementation
 * detail the UI can discover later — it is the difference between 'encoding,
 * about 40 seconds' and 'encoding, this will take about as long as your
 * video'". The worker reports it in its first message and this is where it
 * lands, above both bars, in words.
 */

export interface UploadProgressViewProps {
  readonly state: UploadState;
  readonly className?: string;
}

export function UploadProgressView({ state, className }: UploadProgressViewProps) {
  const progressive = state.pipeline === "progressive";
  const remaining = estimateRemainingSeconds(state);

  return (
    <section
      className={clsx("flex flex-col gap-4", className)}
      aria-label="Upload progress"
      data-phase={state.phase}
      data-pipeline={state.pipeline}
    >
      <header>
        <p className="ytcp-subheading2 m-0 truncate">{state.fileName ?? "No file"}</p>
        <p className="ytcp-caption1 m-0 text-secondary">
          {formatBytes(state.fileSize)}
          {state.durationSeconds > 0
            ? ` · ${formatDuration(state.durationSeconds)}`
            : ""}
        </p>
      </header>

      <RegimeBanner state={state} remainingSeconds={remaining} />

      {progressive ? (
        <ProgressiveBars state={state} />
      ) : (
        <LadderBars state={state} />
      )}

      {state.error ? (
        <p role="alert" className="ytcp-body1 m-0 text-[var(--yt-error-indicator)]">
          {state.error}
        </p>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------- the regime -- */

function RegimeBanner({
  state,
  remainingSeconds,
}: {
  state: UploadState;
  remainingSeconds: number | undefined;
}) {
  if (state.pipeline === "progressive") {
    return (
      <div
        data-regime="progressive"
        className="rounded-compact border border-[var(--yt-icon-warning)] p-3"
      >
        <p className="ytcp-body2 m-0">
          One quality, not a ladder.
        </p>
        <p className="ytcp-caption1 mt-1 mb-0 text-secondary">
          {state.fallbackReason ??
            "This browser cannot encode video in the page, so the file is being " +
              "uploaded exactly as it is."}{" "}
          Viewers will get a single quality with no quality menu and no
          switching, served straight from the original file.
        </p>
      </div>
    );
  }

  const regime: ThroughputRegimeLabel =
    state.throughput === "realtime"
      ? "realtime"
      : state.throughput === "faster-than-realtime"
        ? "faster-than-realtime"
        : "unknown";

  return (
    <div
      data-regime={regime}
      className="rounded-compact border border-outline p-3"
    >
      <p className="ytcp-body2 m-0">
        {regime === "realtime"
          ? "Encoding at playback speed"
          : regime === "faster-than-realtime"
            ? "Encoding faster than real time"
            : "Working out what this browser can encode"}
      </p>
      <p className="ytcp-caption1 mt-1 mb-0 text-secondary">
        {regime === "realtime"
          ? "This browser can only read frames from this file at the speed it " +
            "plays, so the encode will take about as long as the video — " +
            (state.durationSeconds > 0
              ? `roughly ${describeDuration(state.durationSeconds)}. `
              : "") +
            "Leaving this tab open is what keeps it going."
          : regime === "faster-than-realtime"
            ? "Frames are being decoded as fast as the codec allows rather than " +
              "at playback speed, so this finishes well before the video's own " +
              "length."
            : "Nothing is being encoded yet."}
        {remainingSeconds === undefined
          ? ""
          : ` About ${describeDuration(remainingSeconds)} left.`}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------- the bars -- */

function LadderBars({ state }: { state: UploadState }) {
  const { encode, upload, ladder, droppedRungs } = state;

  return (
    <>
      <div>
        <div className="ytcp-caption1 flex items-baseline justify-between text-secondary">
          <span>Encoding {ladder.length > 0 ? `${ladder.length} qualities` : ""}</span>
          <span>
            {encode.fraction === undefined
              ? `${encode.framesDecoded.toLocaleString()} frames`
              : `${Math.round(encode.fraction * 100)}%`}
          </span>
        </div>
        <Bar fraction={encode.fraction} label="Encoding" />
        {ladder.length > 0 ? (
          <ul className="mt-2 flex list-none flex-wrap gap-1 p-0" data-testid="ladder-rungs">
            {ladder.map((rung) => (
              <li
                key={rung.name}
                className="ytcp-caption2 rounded-condensed bg-additive px-2 py-0.5"
              >
                {rung.name}
              </li>
            ))}
          </ul>
        ) : null}
        {droppedRungs.length > 0 ? (
          <p className="ytcp-caption1 mt-2 mb-0 text-secondary">
            {/* A degraded ladder should be visible rather than inferred from a
                short quality menu — the `ready` event carries `dropped` for
                exactly this. */}
            This machine could not encode {droppedRungs.join(", ")}, so those
            qualities will not be available.
          </p>
        ) : null}
      </div>

      <div>
        <div className="ytcp-caption1 flex items-baseline justify-between text-secondary">
          <span>Uploading as segments are produced</span>
          <span>
            {upload.objectsDone} of {upload.objectsSeen} so far
          </span>
        </div>
        {/* Deliberately a *ratio of what exists*, and labelled as such: the
            denominator grows while the encode runs. */}
        <Bar
          fraction={
            upload.objectsSeen === 0 ? 0 : upload.objectsDone / upload.objectsSeen
          }
          label="Uploading"
        />
        <p className="ytcp-caption1 mt-1 mb-0 text-secondary">
          {formatBytes(upload.bytesSent)} stored
          {upload.inFlight > 0 ? ` · ${upload.inFlight} in flight` : ""}
          {encode.encodeBacklog > 0
            ? ` · ${encode.encodeBacklog} frames queued for the encoders`
            : ""}
        </p>
      </div>
    </>
  );
}

function ProgressiveBars({ state }: { state: UploadState }) {
  const { upload } = state;
  const fraction =
    upload.bytesSeen > 0 ? Math.min(1, upload.bytesSent / upload.bytesSeen) : 0;

  return (
    <div>
      <div className="ytcp-caption1 flex items-baseline justify-between text-secondary">
        <span>Uploading the original file</span>
        <span>{Math.round(fraction * 100)}%</span>
      </div>
      <Bar fraction={fraction} label="Uploading" />
      <p className="ytcp-caption1 mt-1 mb-0 text-secondary">
        {formatBytes(upload.bytesSent)} of {formatBytes(upload.bytesSeen)}
      </p>
    </div>
  );
}

/**
 * One bar.
 *
 * `aria-valuenow` is present only when there is a real value. The ARIA spec
 * makes a `progressbar` with no `aria-valuenow` mean "indeterminate", which is
 * exactly the state `TranscodeProgress.fraction === undefined` describes — and
 * it is the only way to say so without inventing a number.
 */
export function Bar({
  fraction,
  label,
}: {
  fraction: number | undefined;
  label: string;
}) {
  const percent = fraction === undefined ? undefined : Math.round(fraction * 100);

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      {...(percent === undefined ? {} : { "aria-valuenow": percent })}
      className="mt-1 h-1 w-full overflow-hidden rounded-min bg-additive"
    >
      <div
        className={clsx(
          "h-full bg-[var(--yt-static-brand-red)]",
          percent === undefined && "animate-pulse",
        )}
        style={{ width: percent === undefined ? "100%" : `${percent}%` }}
      />
    </div>
  );
}

/* ------------------------------------------------------------ formatting -- */

/**
 * Bytes, in the units an uploader recognises.
 *
 * Powers of 1000 with SI names, which is what every browser's download UI and
 * every storage provider's invoice uses — including research/05's own worked
 * example, where a "190 MB" fallback file is 190 × 10⁶ bytes rather than
 * 190 × 2²⁰.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "kB", "MB", "GB", "TB"];
  const exponent = Math.min(
    units.length - 1,
    Math.floor(Math.log10(bytes) / 3),
  );
  const value = bytes / 1000 ** exponent;
  const digits = exponent === 0 ? 0 : value < 10 ? 1 : 0;
  return `${value.toFixed(digits)} ${units[exponent]}`;
}
