"use client";

/**
 * Everything the user sees before the camera is running — including all the
 * ways it can refuse to run.
 *
 * The rule this component exists to enforce: **never a blank black screen.**
 * Camera access on the mobile web fails in at least five distinguishable ways
 * (research/web-platform-constraints.md §5 documents iOS point releases where a
 * standalone PWA silently behaves as though no camera exists), and a user who
 * taps "go live" and gets nothing has no way to tell a denied permission from a
 * broken browser. Each failure below says which one it was and what to do next.
 *
 * It is also the gesture surface. `getUserMedia` only survives inside transient
 * activation (research §1), so the one large button here is the only place the
 * camera is ever started from.
 */

import type { CameraFailureCode } from "@/domain/live-session";

import { CameraIcon } from "./icons";
import type { LiveCameraPhase } from "./use-live-camera";

interface Copy {
  readonly title: string;
  readonly body: string;
  /** Null when retrying cannot possibly help. */
  readonly action: string | null;
}

const IDLE_COPY: Copy = {
  title: "Turn on the camera",
  body: "Live mode puts your own camera behind a broadcast overlay. Nothing is recorded, saved or sent anywhere — no microphone is used and the video never leaves this device.",
  action: "Turn on the camera",
};

const STARTING_COPY: Copy = {
  title: "Starting the camera…",
  body: "Choose Allow when your browser asks for the camera.",
  action: null,
};

const FAILURE_COPY: Record<CameraFailureCode, Copy> = {
  denied: {
    title: "The camera is blocked",
    body: "Your browser is blocking the camera for this site. Open the site settings next to the address bar, allow the camera, then try again.",
    action: "Try again",
  },
  no_device: {
    title: "No camera found",
    body: "This device did not offer a camera we can use. Live mode needs one; the call screen works without it.",
    action: "Try again",
  },
  in_use: {
    title: "The camera is busy",
    body: "Another app or tab is already using the camera. Close it, then try again.",
    action: "Try again",
  },
  insecure_context: {
    title: "This page is not secure",
    body: "Browsers only allow camera access over a secure (https) connection. Open this app over https and try again.",
    action: null,
  },
  unsupported: {
    title: "This browser cannot use the camera",
    body: "No camera API is available here. Opening the app in Safari or Chrome usually fixes it.",
    action: null,
  },
  single_camera: {
    title: "Only one camera",
    body: "This device has a single camera, so there is nothing to switch to.",
    action: "Try again",
  },
  aborted: {
    title: "The camera did not start",
    body: "The request was interrupted before the camera opened.",
    action: "Try again",
  },
  unknown: {
    title: "The camera did not start",
    body: "Something stopped the camera from opening. Trying again often works.",
    action: "Try again",
  },
};

export function CameraPrimer({
  phase,
  failure,
  supported,
  onStart,
  onClose,
}: {
  readonly phase: LiveCameraPhase;
  readonly failure: CameraFailureCode | null;
  readonly supported: boolean;
  readonly onStart: () => void;
  readonly onClose: () => void;
}) {
  const copy = !supported
    ? FAILURE_COPY.unsupported
    : phase === "error" && failure
      ? FAILURE_COPY[failure]
      : phase === "starting"
        ? STARTING_COPY
        : IDLE_COPY;

  return (
    <div
      data-testid="camera-primer"
      data-camera-phase={phase}
      // Our own surface, so it uses fake-phone's calm dark palette rather than
      // any replica chrome (SPEC §5.5) — a bystander should never see the
      // broadcast overlay and an app dialog at the same time.
      className="absolute inset-0 z-[60] flex h-full flex-col items-center justify-between bg-ground px-6 pb-10 pt-16"
    >
      <div className="flex w-full justify-end">
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 px-2 text-[15px] text-text-secondary"
        >
          Back
        </button>
      </div>

      <div className="flex max-w-sm flex-1 flex-col items-center justify-center text-center">
        <CameraIcon className="mb-6 h-12 w-12 text-accent" />
        <h1 className="text-[22px] font-semibold text-text-primary">{copy.title}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-text-secondary">{copy.body}</p>
      </div>

      {/* The primary action is the largest, lowest thing on screen — the
          one-handed-reach rule from SPEC §5.5, and it doubles as the user
          gesture the camera permission needs. */}
      <div className="w-full max-w-sm">
        {copy.action ? (
          <button
            type="button"
            data-testid="camera-start"
            onClick={onStart}
            disabled={phase === "starting"}
            className="min-h-14 w-full rounded-2xl bg-accent text-[17px] font-semibold text-ground disabled:opacity-60"
          >
            {copy.action}
          </button>
        ) : (
          <button
            type="button"
            onClick={onClose}
            className="min-h-14 w-full rounded-2xl bg-surface-2 text-[17px] font-semibold text-text-primary"
          >
            Back
          </button>
        )}
      </div>
    </div>
  );
}
