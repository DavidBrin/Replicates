"use client";

/**
 * The camera's lifecycle, as the live screen needs it.
 *
 * Two things live here that are easy to get wrong in a component body:
 *
 *  1. `getUserMedia` must be called from inside a real user gesture. `start()`
 *     is therefore designed to be handed straight to an `onClick` — it calls
 *     the port synchronously and only *then* awaits, so the request is still
 *     inside the transient activation window WebKit grants after a tap
 *     (research/web-platform-constraints.md §1, §5).
 *  2. The stream has to be stopped on every way out of this screen, including
 *     the ones React does not tell you about.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { useContainer, useIsClientContainer } from "@/components/app-shell/container-provider";
import { readCameraFailure, type CameraFailureCode } from "@/domain/live-session";
import type { CameraFacing } from "@/ports";

export type LiveCameraPhase = "idle" | "starting" | "live" | "error";

export interface LiveCameraController {
  readonly phase: LiveCameraPhase;
  readonly failure: CameraFailureCode | null;
  readonly stream: MediaStream | null;
  readonly facing: CameraFacing;
  /** False once we know the platform cannot do this at all. */
  readonly supported: boolean;
  /** Transient message from a rejected flip; clears itself. */
  readonly notice: string | null;
  /** Safe to pass directly to `onClick`. */
  start(): void;
  flip(): void;
  stop(): void;
}

export function useLiveCamera(): LiveCameraController {
  const { camera } = useContainer();

  const [phase, setPhase] = useState<LiveCameraPhase>("idle");
  const [failure, setFailure] = useState<CameraFailureCode | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facing, setFacing] = useState<CameraFacing>("user");
  const [notice, setNotice] = useState<string | null>(null);

  // Optimistic until the real container is in place: for the first render the
  // container is the inert server one, whose camera reports no support, and
  // flashing "your browser can't do this" before the browser adapter arrives
  // would be a lie. `isSupported()` is a cheap synchronous feature check, so it
  // can be read during render once there is something real to ask.
  const clientReady = useIsClientContainer();
  const supported = clientReady ? camera.isSupported() : true;

  const applyStream = useCallback((next: MediaStream, nextFacing: CameraFacing) => {
    setStream(next);
    setFacing(nextFacing);
    setFailure(null);
    setPhase("live");
  }, []);

  const fail = useCallback((error: unknown) => {
    const code = readCameraFailure(error);
    // "aborted" means *we* superseded the request (a second tap, or a teardown
    // while the permission sheet was up). Reporting it would put an error on
    // screen for something the user did on purpose.
    if (code === "aborted") return;
    setStream(null);
    setFailure(code);
    setPhase("error");
  }, []);

  const start = useCallback(() => {
    setPhase("starting");
    setNotice(null);
    // Not awaited: the click handler must return immediately so the gesture is
    // not held open, and the promise's outcome is state, not control flow.
    camera
      .start("user")
      .then((next) => applyStream(next, "user"))
      .catch(fail);
  }, [applyStream, camera, fail]);

  const flip = useCallback(() => {
    const previous = facing;
    const target: CameraFacing = facing === "user" ? "environment" : "user";
    camera
      .flip()
      .then((next) => applyStream(next, target))
      .catch((error: unknown) => {
        const code = readCameraFailure(error);
        if (code === "single_camera") {
          // Refused before the running stream was touched, so this is a note,
          // not a failure state — the picture the user is looking at is still
          // live.
          setNotice("This device only has one camera.");
          return;
        }
        if (code === "aborted") {
          // Superseded by something we did on purpose (a second tap, or a
          // teardown). Whatever superseded it owns the camera now; re-opening
          // one here would fight it — and could resurrect a camera the user has
          // just left the screen to switch off.
          return;
        }
        // Any other rejection means the adapter is holding nothing: it has to
        // release the running camera before it can ask for the other one, so
        // by the time we get here the picture is already gone. Re-open the one
        // we had rather than dropping the user onto the error primer — on this
        // screen the picture is the deterrent, and losing it because a *second*
        // camera would not open is a much worse outcome than a failed flip.
        // This is the layer that can do it: it is the only one that knows which
        // way the surviving camera was facing.
        camera
          .start(previous)
          .then((restored) => {
            applyStream(restored, previous);
            setNotice("Could not switch cameras.");
          })
          // Report what actually went wrong, not the recovery's own failure.
          .catch(() => fail(error));
      });
  }, [applyStream, camera, facing, fail]);

  const stop = useCallback(() => {
    camera.stop();
    setStream(null);
    setPhase("idle");
  }, [camera]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2_500);
    return () => clearTimeout(timer);
  }, [notice]);

  /* ------------------------------------------------------------ teardown -- */

  // Kept in refs so the listeners below can be registered exactly once and
  // still see current state. Re-registering them on every phase change would
  // race with the events they are trying to catch.
  const liveRef = useRef(false);
  const startRef = useRef(start);

  useEffect(() => {
    liveRef.current = phase === "live" || phase === "starting";
  }, [phase]);

  useEffect(() => {
    startRef.current = start;
  }, [start]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const release = () => {
      camera.stop();
      setStream(null);
    };

    const onPageHide = () => {
      // `pagehide` is the only teardown hook iOS reliably fires — it covers
      // navigation, tab close and the app being swapped out into the
      // back/forward cache, none of which run a React unmount.
      if (liveRef.current) release();
    };

    const onVisibilityChange = () => {
      // Deliberately `visibilitychange`, NOT `blur`. A blur fires when a
      // notification banner, the share sheet or the on-screen keyboard takes
      // focus while the app is still fully on screen; killing the camera there
      // would black out the stream in front of whoever it is deterring. Only a
      // genuinely hidden document — backgrounded or screen locked — releases
      // the camera.
      if (document.visibilityState === "hidden") {
        if (liveRef.current) release();
        return;
      }
      // Coming back: re-acquire. The permission grant already exists, so this
      // needs no gesture; if it has been revoked in the meantime the normal
      // error path renders the explanation.
      if (liveRef.current) startRef.current();
    };

    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      // The unmount stop is unconditional. A camera track that outlives its
      // screen leaves the phone's camera indicator lit with nothing on screen
      // explaining why — the worst bug this app could ship.
      camera.stop();
    };
  }, [camera]);

  return {
    phase,
    failure,
    stream,
    facing,
    supported,
    notice,
    start,
    flip,
    stop,
  };
}
