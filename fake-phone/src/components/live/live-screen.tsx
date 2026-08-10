"use client";

/**
 * Live mode: the real front camera under broadcast chrome.
 *
 * The product claim (SPEC §2.3) is the same deterrent as the staged call —
 * "people are watching this right now" — and the research (§0 of
 * `instagram-live-ui.md`) is clear about what carries that at a glance: the red
 * badge and viewer count, motion in the lower third, and rising hearts. Those
 * three get the attention; the bottom icon row deliberately does not.
 *
 * What this component owns is only composition and z-order. The simulation is
 * pure domain code, the camera is a port, and the failure copy is its own
 * component — so the interesting parts are all testable without a browser.
 *
 * Layering, per research §5.4 / SPEC §5.4:
 *   video (z0) → scrims (z10) → top bar (z20) → comments (z30) → hearts (z40)
 *   → bottom bar (z50) → permission primer (z60, when not live).
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { useSettings } from "@/components/app-shell/settings-provider";
import { visibleComments, type LiveSessionConfig } from "@/domain/live-session";

import { CameraPrimer } from "./camera-primer";
import { CommentStream } from "./comment-stream";
import { FloatingHearts } from "./floating-hearts";
import { LiveBottomBar, LiveTopBar } from "./live-chrome";
import { useLiveCamera } from "./use-live-camera";
import { useLiveSession } from "./use-live-session";

export function LiveScreen(): React.ReactElement {
  const router = useRouter();
  const { settings } = useSettings();
  const camera = useLiveCamera();

  const config = useMemo<LiveSessionConfig>(
    () => ({
      startingViewers: settings.live.viewers,
      commentsPerMinute: settings.live.commentsPerMinute,
      username: settings.live.username,
    }),
    [settings.live.viewers, settings.live.commentsPerMinute, settings.live.username],
  );

  const isLive = camera.phase === "live";
  const session = useLiveSession(config, isLive);
  const comments = visibleComments(session);

  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    try {
      video.srcObject = camera.stream;
    } catch {
      // Environments with no media pipeline (jsdom under test) have no usable
      // `srcObject`. Everything else on this screen still renders.
    }
    if (camera.stream) {
      // Autoplay of a muted, inline stream is allowed, but Safari still returns
      // a rejected promise in enough situations (a stream that arrived while
      // the tab was hidden, mainly) that an unhandled rejection here would be
      // routine. The picture recovers on the next visibility change.
      void video.play?.().catch(() => {});
    }
    return () => {
      try {
        video.srcObject = null;
      } catch {
        /* see above */
      }
    };
  }, [camera.stream]);

  const leave = useCallback(() => {
    // Stop first, navigate second. Route changes unmount this tree and the
    // unmount also stops the camera, but relying on that ordering would make a
    // stranded track a routing detail — and a stranded track leaves the phone's
    // camera indicator lit after the user thinks they have left.
    camera.stop();
    router.push("/home");
  }, [camera, router]);

  return (
    <div
      data-testid="live-screen"
      data-live-phase={camera.phase}
      className="relative h-[100dvh] w-full overflow-hidden bg-black text-white"
    >

      <video
        ref={videoRef}
        // `playsInline` is not optional: without it iOS takes the video
        // fullscreen into the native player the moment it starts, replacing
        // this entire screen with Apple's chrome. `muted` is likewise required
        // for inline autoplay to be permitted at all
        // (research/web-platform-constraints.md §5).
        autoPlay
        muted
        playsInline
        disablePictureInPicture
        className="absolute inset-0 z-0 h-full w-full object-cover"
        style={{
          // A selfie view is mirrored — that is what every camera app and every
          // mirror does, and an unmirrored self-view reads as wrong even to
          // someone who cannot say why. The rear camera is not mirrored,
          // because that is a view of the world, not of you.
          transform: camera.facing === "user" ? "scaleX(-1)" : undefined,
        }}
      />

      {/* Scrims. research §5: a soft top band and a deeper bottom band so white
          chrome stays legible over bright video, smooth enough never to read as
          a flat overlay. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-36 bg-gradient-to-b from-black/45 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-72 bg-gradient-to-t from-black/55 to-transparent" />

      {isLive ? (
        <>
          <LiveTopBar
            username={settings.live.username}
            avatar={settings.live.avatar}
            viewers={session.viewers}
            onClose={leave}
          />
          <CommentStream comments={comments} elapsedMs={session.elapsedMs} />
          <FloatingHearts />
          <LiveBottomBar onFlip={camera.flip} />
          {camera.notice ? (
            <p
              role="status"
              className="absolute inset-x-0 bottom-24 z-50 text-center text-[13px] text-white/80"
            >
              {camera.notice}
            </p>
          ) : null}
        </>
      ) : (
        <CameraPrimer
          phase={camera.phase}
          failure={camera.failure}
          supported={camera.supported}
          onStart={camera.start}
          onClose={leave}
        />
      )}
    </div>
  );
}

