/**
 * The camera adapter: `getUserMedia` behind the `CameraSource` port.
 *
 * Everything hostile about camera access on the mobile web is quarantined here
 * (research/web-platform-constraints.md §5):
 *
 *   - a standalone home-screen PWA has repeatedly shipped iOS point releases
 *     where `getUserMedia` never even prompts, so *every* failure has to
 *     produce a specific, explainable error rather than a black screen;
 *   - `facingMode` is a hint, not a guarantee — Safari may quietly hand back
 *     the wrong camera, so nothing here asserts which camera it got;
 *   - permission is not reliably persisted across launches in standalone mode,
 *     so the UI must be able to re-prompt from a fresh user gesture at any
 *     time, which means `start()` has to be safe to call repeatedly.
 *
 * The bug this file exists to prevent: a stranded live camera track. A leaked
 * track leaves the phone's camera indicator lit after the user has left the
 * screen — in an app whose entire premise is "you are safe and in control",
 * that is the worst possible failure. Every path below either owns the stream
 * or stops it.
 */

import { classifyCameraError, type CameraFailureCode } from "@/domain/live-session";
import type { CameraFacing, CameraSource } from "@/ports";

/**
 * The error every rejection from this adapter carries.
 *
 * `code` is a plain string from a union declared in `domain/`, not a class the
 * UI has to import — a component may never import an adapter (SPEC §3.1), so
 * the contract between the two is the string, read structurally by
 * `readCameraFailure`.
 */
export class CameraError extends Error {
  readonly code: CameraFailureCode;

  constructor(code: CameraFailureCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CameraError";
    this.code = code;
  }
}

/** Resolution hints, `ideal` rather than `exact` on purpose: an `exact`
 * constraint that the device cannot satisfy throws `OverconstrainedError` and
 * we get no camera at all, which is a far worse outcome than a 480p selfie. */
const VIDEO_HINTS = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
} as const;

export function createCameraSource(): CameraSource {
  let stream: MediaStream | null = null;
  let facing: CameraFacing = "user";
  /**
   * Bumped by every `start`, `flip` and `stop`.
   *
   * This is the leak guard. `getUserMedia` is asynchronous and the user can
   * leave the screen — or tap the flip button again — while the OS permission
   * sheet is still up. When the stream finally arrives we compare the token we
   * started with against the current one; if they differ, the request has been
   * superseded and we stop the tracks we just acquired *immediately* rather
   * than handing back a stream nobody is going to render or ever stop.
   */
  let generation = 0;

  function stopTracks(target: MediaStream | null): void {
    if (!target) return;
    for (const track of target.getTracks()) {
      try {
        track.stop();
      } catch {
        // A track that is already ended throws on some engines. There is
        // nothing left to clean up, and throwing out of `stop()` would leave
        // the *other* tracks running.
      }
    }
  }

  function stop(): void {
    // Idempotent: repeated calls (unmount + `pagehide` + a tab hide all firing
    // together is the normal case, not an edge case) find a null stream and do
    // nothing. The generation bump still happens so an in-flight `start()`
    // knows to discard whatever it is about to receive.
    generation += 1;
    const current = stream;
    stream = null;
    stopTracks(current);
  }

  function isSupported(): boolean {
    // Must not throw during server rendering, where none of these globals
    // exist — `container.ts` constructs this adapter on the client only, but
    // `isSupported()` is the one method a shared code path might reach first.
    if (typeof navigator === "undefined") return false;
    return typeof navigator.mediaDevices?.getUserMedia === "function";
  }

  function assertUsable(): void {
    if (typeof window !== "undefined" && window.isSecureContext === false) {
      // `getUserMedia` is undefined on plain http (other than localhost). The
      // user needs to be told to use https, not that their camera is broken.
      throw new CameraError(
        "insecure_context",
        "The camera is only available over a secure (https) connection.",
      );
    }
    if (!isSupported()) {
      throw new CameraError("unsupported", "This browser has no camera API.");
    }
  }

  async function acquire(next: CameraFacing): Promise<MediaStream> {
    assertUsable();

    // Release the previous stream before asking for another. iOS will not hand
    // out the second camera while the first is still open, and holding both
    // would double the leak surface for no benefit.
    stop();
    const token = generation;

    let acquired: MediaStream;
    try {
      acquired = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: next, ...VIDEO_HINTS },
        // Audio is false, always, and this is not a performance choice.
        // fake-phone never records anything: no audio track means there is
        // nothing to record even by accident, which keeps the app clear of the
        // two-party-consent recording statutes in the 13 US states listed in
        // research/competitive-teardown.md §7. It also avoids a second
        // permission prompt (microphone), and a second prompt is a second
        // chance for the user to say no at the exact moment they need this to
        // work.
        audio: false,
      });
    } catch (error) {
      throw new CameraError(classifyCameraError(error), cameraMessage(error), {
        cause: error,
      });
    }

    if (token !== generation) {
      // Superseded while the permission sheet was up. Nobody is holding this
      // stream, so nobody else can ever stop it — stop it here.
      stopTracks(acquired);
      throw new CameraError("aborted", "The camera request was superseded.");
    }

    stream = acquired;
    facing = next;
    return acquired;
  }

  return {
    isSupported,

    start(next: CameraFacing): Promise<MediaStream> {
      return acquire(next);
    },

    stop,

    async flip(): Promise<MediaStream> {
      assertUsable();
      const target: CameraFacing = facing === "user" ? "environment" : "user";

      // Check for a second camera *before* touching the running stream. A
      // laptop or a single-camera phone must keep the picture it already has —
      // a flip button that blacks out the stream is worse than one that does
      // nothing.
      if (!(await hasMultipleCameras())) {
        throw new CameraError("single_camera", "This device only has one camera.");
      }

      // A rejection from here means exactly one thing: no camera is running.
      //
      // `acquire` releases the old stream before asking for the new one (iOS
      // will not hand out both), and on failure it either never opened a device
      // or stopped what it opened — so there is nothing left to clean up, and
      // nothing left running. This used to re-acquire `facing` on the way out
      // and then rethrow, which was the worst of both worlds: the caller was
      // told the flip had failed while a live track kept the phone's camera
      // indicator lit behind an error screen. It could not have done better
      // with what it was given, either — `flip()` resolves with a `MediaStream`
      // and nothing else, so a caller cannot tell a real switch from a silent
      // restore and would go on believing it was showing the other camera.
      // Recovery therefore belongs to the caller, which knows which way the
      // camera was facing; see `useLiveCamera.flip`.
      return acquire(target);
    },
  };
}

async function hasMultipleCameras(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    // No way to know. Assume there is a second camera and let `getUserMedia`
    // be the judge — an optimistic flip that fails is recoverable, a flip
    // button permanently disabled on a device that could flip is not.
    return true;
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === "videoinput").length > 1;
  } catch {
    return true;
  }
}

/** Human-readable text per failure, kept next to the classification so the two
 * cannot drift apart. The UI still owns the on-screen copy; this is what ends
 * up in a console or a thrown error's message. */
function cameraMessage(error: unknown): string {
  switch (classifyCameraError(error)) {
    case "denied":
      return "Camera access was blocked.";
    case "no_device":
      return "No camera matched the request.";
    case "in_use":
      return "The camera is already in use by another app.";
    case "aborted":
      return "The camera request was cancelled.";
    default:
      return "The camera could not be started.";
  }
}
