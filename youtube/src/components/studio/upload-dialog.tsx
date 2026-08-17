"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { CloseIcon, PlusIcon } from "@/components/icons";
import { Button } from "@/components/primitives";
import type { Visibility } from "@/domain/types";

import { Claims } from "./claims";
import {
  DetailsForm,
  EMPTY_DETAILS,
  detailsAreValid,
  parseTags,
  type VideoDetails,
} from "./details-form";
import { UploadProgressView } from "./upload-progress";
import {
  IDLE_UPLOAD_STATE,
  browserUploadPorts,
  createUploadRun,
  type UploadPorts,
  type UploadRun,
  type UploadState,
} from "./upload-machine";

/**
 * The upload dialog: file picker, then Details → Video elements → Checks →
 * Visibility.
 *
 * ## What is measured and what is not
 *
 * The **picker** is measured (R9 §12.5): a 960 × 731 dialog on #212121 with a
 * 24px radius, a 136px circle at 50% radius on `rgba(255,255,255,0.1)`, the
 * label at 16/22 w400 with a 23px top margin, and a 101 × 36 filled-mono
 * "Select files" button. Those numbers are used verbatim below.
 *
 * The **stepper is not measured, and cannot be from outside**. R9 §13.1 records
 * why: `ytcp-stepper`, `#stepper` and `.step` all return zero nodes until a
 * file has actually been selected, so reaching them needs a real upload to a
 * real channel. What §12.6 *did* capture is the video details editor — the same
 * `ytcp-video-metadata-editor` the Details step mounts — and that is what
 * `details-form.tsx` is built from. Everything about the step rail itself
 * (its height, its connectors, its numbering) is this project's, and is marked
 * as such rather than presented as fidelity.
 *
 * ## Resumability: abandonment is clean, and it is not resumable
 *
 * **The decision, and why.** A ladder encode is minutes long and a tab can
 * close. Resuming one would need three things to survive the tab, and none of
 * them does:
 *
 *  - the **source file**. A `File` from an `<input>` is gone on reload. The
 *    only way back to the same bytes without a fresh picker is a
 *    `FileSystemFileHandle` from the File System Access API, which is
 *    Chromium-only and needs a user gesture — so on Safari and Firefox
 *    "resume" would mean "pick the file again and hope it is the same one".
 *  - the **encoder state**. `VideoEncoder` has no serialisable state, so a
 *    resume restarts from the last segment boundary at best.
 *  - the **decode clock**. `TrackMuxer` owns a running `baseMediaDecodeTime`
 *    whose header explains that reconstructing it as `index × nominal` is
 *    correct right up until the first non-nominal segment, after which audio
 *    walks away from video. Rebuilding it from stored segments means parsing
 *    back every `tfdt` we wrote.
 *
 * So this flow does **not** resume, and it does not pretend to. What it does
 * instead is make abandonment clean and visible:
 *
 *  - the row stays `upload_status = 'uploading'` — never silently deleted,
 *    because a failure is more often a dropped network than a lost intent;
 *  - Studio's content table lists it as **Upload incomplete** with the reason
 *    and a **Delete** button (`video-table.tsx`), so there is no orphaned row
 *    with no affordance;
 *  - `beforeunload` is armed while an encode is running, so closing the tab is
 *    a deliberate act rather than an accident;
 *  - the dialog's own Cancel aborts the transcode *and* deletes the row, which
 *    is the one path that leaves nothing behind at all.
 *
 * The uploaded segments of an abandoned run are orphaned objects, not garbage
 * in the database: nothing references them once the row is deleted, and
 * research/05 §7.1 gives the sweep (one `ListObjectsV2` by prefix, one
 * `DeleteObjects`). That reaper is named and not built.
 */

export const UPLOAD_STEPS = ["details", "elements", "checks", "visibility"] as const;
export type UploadStep = (typeof UPLOAD_STEPS)[number];

export const STEP_LABELS: Readonly<Record<UploadStep, string>> = {
  details: "Details",
  elements: "Video elements",
  checks: "Checks",
  visibility: "Visibility",
};

/**
 * Which steps may be left, as a pure function.
 *
 * Only Details gates anything, and it gates on the same `validateDetails` the
 * form's inline errors use — one rule, one implementation, asserted in the
 * suite. Checks does *not* gate: a claim is information, and D12 is explicit
 * that "a match creates a claim, not a takedown". Blocking the stepper on one
 * would be this project inventing an enforcement the design rejects.
 */
export function canLeaveStep(step: UploadStep, details: VideoDetails): boolean {
  return step === "details" ? detailsAreValid(details) : true;
}

/** Phases during which closing the tab loses work. */
export function isRunActive(state: UploadState): boolean {
  return (
    state.phase === "creating" ||
    state.phase === "probing" ||
    state.phase === "transcoding" ||
    state.phase === "uploading-source" ||
    state.phase === "finalising"
  );
}

/**
 * Module-level so their identity is stable across renders — `useSyncExternalStore`
 * re-subscribes whenever `subscribe` changes, and a fresh closure per render
 * would tear down and rebuild the subscription on every state update.
 */
const NEVER_CHANGES = (): (() => void) => () => {};
const IDLE_SNAPSHOT = (): UploadState => IDLE_UPLOAD_STATE;

export interface UploadDialogProps {
  readonly channelId: string;
  /** Injected by the suite; production wiring is `browserUploadPorts()`. */
  readonly ports?: UploadPorts;
  readonly onClose?: () => void;
  readonly onPublished?: (videoId: string) => void;
}

export function UploadDialog({
  channelId,
  ports,
  onClose,
  onPublished,
}: UploadDialogProps) {
  const router = useRouter();
  const portsRef = useRef<UploadPorts | null>(null);
  portsRef.current ??= ports ?? browserUploadPorts();

  /**
   * Closing goes back to the content list by default.
   *
   * The dialog is a route (see `src/app/studio/upload/page.tsx`), so a Server
   * Component cannot hand it a callback — a function prop would have to cross
   * the client boundary. Defaulting here keeps the X working without making
   * every caller pass a navigation, and a caller that wants different
   * behaviour still overrides it.
   */
  const leave = onClose ?? (() => router.push("/studio"));

  const [run, setRun] = useState<UploadRun | null>(null);
  /**
   * `useSyncExternalStore`, not `useState` + a subscribing effect.
   *
   * The run emits its first transitions *synchronously* inside `start()`, before
   * any effect can attach a listener — and that window is exactly the one in
   * which the dialog would look hung. `useSyncExternalStore` reads the current
   * snapshot on every render instead of replaying past events, so there is
   * nothing to miss. The run's `getState` returns a cached object that only
   * changes when the state does, which is the identity contract this hook needs.
   */
  const state = useSyncExternalStore(
    run ? run.subscribe : NEVER_CHANGES,
    run ? run.getState : IDLE_SNAPSHOT,
    run ? run.getState : IDLE_SNAPSHOT,
  );
  const [step, setStep] = useState<UploadStep>("details");
  const [furthest, setFurthest] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const [details, setDetails] = useState<VideoDetails>(EMPTY_DETAILS);
  const [visibility, setVisibility] = useState<Visibility>("private");

  useEffect(() => {
    return () => run?.dispose();
  }, [run]);

  useEffect(() => {
    if (!isRunActive(state)) return;
    const guard = (event: BeforeUnloadEvent): void => {
      // `preventDefault` is the modern spelling; the legacy `returnValue` is
      // still what Safari reads. Both, deliberately.
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [state]);

  const pick = useCallback(
    (file: File) => {
      const title = defaultTitleFor(file);
      setDetails((current) => ({ ...current, title: current.title || title }));
      const created = createUploadRun(portsRef.current!);
      setRun(created);
      void created.start(file, { channelId, title });
    },
    [channelId],
  );

  const index = UPLOAD_STEPS.indexOf(step);

  const goTo = (next: UploadStep): void => {
    const target = UPLOAD_STEPS.indexOf(next);
    if (target > index && !canLeaveStep(step, details)) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    setStep(next);
    setFurthest((current) => Math.max(current, target));
  };

  const publish = async (): Promise<void> => {
    if (!run) return;
    if (!detailsAreValid(details)) {
      setShowErrors(true);
      setStep("details");
      return;
    }
    const ok = await run.publish({
      title: details.title.trim(),
      description: details.description,
      visibility,
      category: details.category,
      tags: parseTags(details.tagsText),
    });
    if (!ok || !state.videoId) return;
    if (onPublished) onPublished(state.videoId);
    else router.push("/studio");
  };

  const cancel = async (): Promise<void> => {
    if (run && isRunActive(state)) await run.cancel();
    leave();
  };

  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-label="Upload videos"
      className={clsx(
        // §12.5: 960 × 731, #212121, radius 24, margin 24px 40px.
        "mx-10 my-6 w-full max-w-[960px] rounded-hero bg-raised",
      )}
    >
      <header className="flex h-[61px] items-center justify-between px-6">
        <h1 className="ytcp-title m-0">
          {run ? state.fileName ?? "Upload videos" : "Upload videos"}
        </h1>
        <Button
          iconOnly
          variant="text"
          aria-label={isRunActive(state) ? "Cancel upload" : "Close"}
          onClick={() => void cancel()}
        >
          <CloseIcon size={24} />
        </Button>
      </header>

      {run === null ? (
        <FilePicker onPick={pick} />
      ) : (
        <div className="px-6 pb-6">
          <StepRail step={step} furthest={furthest} onSelect={goTo} />

          <div className="mt-6 grid gap-6 md:grid-cols-[1fr_376px]">
            <div>
              {step === "details" ? (
                <DetailsForm
                  value={details}
                  onChange={setDetails}
                  showErrors={showErrors}
                />
              ) : null}

              {step === "elements" ? <VideoElements state={state} /> : null}

              {step === "checks" ? (
                <div>
                  <h2 className="ytcp-card-title m-0">Copyright</h2>
                  <p className="ytcp-caption1 mt-1 mb-4 text-secondary">
                    Your audio is fingerprinted in this browser and matched
                    against registered reference works. A match raises a claim
                    — it never takes the video down.
                  </p>
                  <Claims claims={state.claims} scanned={scannedFor(state)} />
                  {state.claims.length > 0 ? (
                    <p className="ytcp-caption1 mt-4 mb-0 text-secondary">
                      You can dispute a claim from your content list once the
                      video is published.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {step === "visibility" ? (
                <VisibilityStep
                  value={visibility}
                  onChange={setVisibility}
                  state={state}
                />
              ) : null}
            </div>

            <aside>
              <UploadProgressView state={state} />
            </aside>
          </div>

          <footer className="mt-6 flex items-center justify-between gap-4">
            <p className="ytcp-caption1 m-0 text-secondary">
              {footerNote(state)}
            </p>
            <div className="flex gap-2">
              <Button
                variant="text"
                disabled={index === 0}
                onClick={() => goTo(UPLOAD_STEPS[index - 1] ?? "details")}
              >
                Back
              </Button>
              {index < UPLOAD_STEPS.length - 1 ? (
                <Button
                  variant="filled"
                  onClick={() => goTo(UPLOAD_STEPS[index + 1] ?? "visibility")}
                >
                  Next
                </Button>
              ) : (
                <Button
                  variant="filled"
                  disabled={state.phase !== "ready-to-publish"}
                  onClick={() => void publish()}
                >
                  {state.phase === "published" ? "Published" : "Publish"}
                </Button>
              )}
            </div>
          </footer>
        </div>
      )}
    </section>
  );
}

/* --------------------------------------------------------------- picker -- */

function FilePicker({ onPick }: { onPick: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const take = (files: FileList | null): void => {
    const file = files?.[0];
    if (file) onPick(file);
  };

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        take(event.dataTransfer.files);
      }}
      className={clsx(
        "flex flex-col items-center px-6 pb-6 text-center",
        dragging && "bg-additive",
      )}
    >
      {/* §12.5: 136 × 136, radius 50%, rgba(255,255,255,0.1). */}
      <div className="mt-10 flex size-[136px] items-center justify-center rounded-full bg-additive">
        <PlusIcon size={48} className="text-secondary" />
      </div>
      <p className="ytcp-subheading mt-[23px] mb-0">
        Drag and drop video files to upload
      </p>
      <p className="ytcp-caption1 mt-2 mb-0 text-secondary">
        Your video is encoded here, in this tab. Nothing is transcoded on a
        server.
      </p>
      <div className="mt-[26px]">
        <Button variant="filled" onClick={() => inputRef.current?.click()}>
          Select files
        </Button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        aria-label="Select files"
        className="sr-only"
        onChange={(event) => take(event.target.files)}
      />
      <p className="ytcp-caption1 mt-10 mb-0 max-w-[560px] text-secondary">
        By uploading you confirm the video is yours to publish. Audio is
        fingerprinted in your browser and matched against registered reference
        works before you publish.
      </p>
    </div>
  );
}

/* ----------------------------------------------------------------- rail -- */

function StepRail({
  step,
  furthest,
  onSelect,
}: {
  step: UploadStep;
  furthest: number;
  onSelect: (step: UploadStep) => void;
}) {
  return (
    <ol className="m-0 flex list-none gap-2 p-0" aria-label="Upload steps">
      {UPLOAD_STEPS.map((candidate, position) => {
        const current = candidate === step;
        const reachable = position <= furthest;
        return (
          <li key={candidate} className="flex-1">
            <button
              type="button"
              aria-current={current ? "step" : undefined}
              disabled={!reachable && !current}
              onClick={() => onSelect(candidate)}
              className={clsx(
                "ytcp-body2 w-full cursor-pointer border-b-2 pb-2 text-left",
                current
                  ? "border-[var(--yt-text-primary)] text-primary"
                  : reachable
                    ? "border-outline text-secondary"
                    : "border-outline text-disabled",
              )}
            >
              {STEP_LABELS[candidate]}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------ the steps -- */

/**
 * Video elements.
 *
 * In the real product this step is end screens, cards and subtitles. None of
 * the three exists in this build, and the honest surface says which and why
 * rather than rendering three dead buttons — the ladder that *was* produced is
 * shown instead, because it is the one thing about this video's elements that
 * is real and that the uploader has never been shown anywhere else.
 */
function VideoElements({ state }: { state: UploadState }) {
  return (
    <div>
      <h2 className="ytcp-card-title m-0">Video elements</h2>
      <p className="ytcp-caption1 mt-1 mb-4 text-secondary">
        End screens, cards and subtitle tracks are not part of this build.
        What your browser did produce is below.
      </p>
      {state.pipeline === "progressive" ? (
        <p className="ytcp-body1 m-0">
          One rendition, uploaded exactly as it arrived. No quality menu, no
          adaptive switching.
        </p>
      ) : (
        <dl className="ytcp-body1 m-0 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
          <dt className="text-secondary">Qualities</dt>
          <dd className="m-0">
            {state.ladder.length === 0
              ? "Being negotiated…"
              : state.ladder.map((rung) => rung.name).join(", ")}
          </dd>
          <dt className="text-secondary">Codec</dt>
          <dd className="m-0">{state.codecFamily ?? "Being negotiated…"}</dd>
          <dt className="text-secondary">Encoded in</dt>
          <dd className="m-0">your browser</dd>
        </dl>
      )}
    </div>
  );
}

function VisibilityStep({
  value,
  onChange,
  state,
}: {
  value: Visibility;
  onChange: (next: Visibility) => void;
  state: UploadState;
}) {
  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="ytcp-card-title mb-1 p-0">Visibility</legend>
      <p className="ytcp-caption1 mt-0 mb-4 text-secondary">
        Choose who can see your video.
      </p>
      {VISIBILITY_OPTIONS.map((option) => (
        <label
          key={option.value}
          className="mb-3 flex cursor-pointer items-start gap-3"
        >
          <input
            type="radio"
            name="visibility"
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="mt-1"
          />
          <span>
            <span className="ytcp-body2 block">{option.label}</span>
            <span className="ytcp-caption1 block text-secondary">
              {option.detail}
            </span>
          </span>
        </label>
      ))}
      {state.phase !== "ready-to-publish" && state.phase !== "published" ? (
        <p className="ytcp-caption1 mt-4 mb-0 text-secondary">
          Publishing unlocks once every segment has been stored.
        </p>
      ) : null}
    </fieldset>
  );
}

const VISIBILITY_OPTIONS: readonly {
  value: Visibility;
  label: string;
  detail: string;
}[] = [
  {
    value: "private",
    label: "Private",
    detail: "Only you can watch it. Segments are refused to anyone else.",
  },
  {
    value: "unlisted",
    label: "Unlisted",
    detail:
      "Anyone with the link can watch. It stays out of feeds and search — the " +
      "link is the capability.",
  },
  { value: "public", label: "Public", detail: "Everyone can watch and find it." },
];

/* ------------------------------------------------------------- helpers -- */

function scannedFor(state: UploadState): boolean | null {
  return state.phase === "finalising" ? null : state.scanned;
}

function footerNote(state: UploadState): string {
  switch (state.phase) {
    case "published":
      return "Published.";
    case "ready-to-publish":
      return "Everything is stored. You can publish whenever you are ready.";
    case "failed":
      return (
        state.error ??
        "The upload failed. The video is listed in your content as incomplete."
      );
    case "cancelled":
      return "Upload cancelled and the draft deleted.";
    default:
      return "Keep this tab open — the encode runs here.";
  }
}

/**
 * The filename, minus its extension, as the working title.
 *
 * A title is required before the row can be created and the row has to exist
 * before any byte can be stored, so *something* has to be sent up front. Using
 * the filename is what the real product does, and the Details step overwrites
 * it at publish.
 */
export function defaultTitleFor(file: File): string {
  const withoutExtension = file.name.replace(/\.[^.]+$/, "").trim();
  const title = withoutExtension.length > 0 ? withoutExtension : "Untitled";
  return title.slice(0, 100);
}
