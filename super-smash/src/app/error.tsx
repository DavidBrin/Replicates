"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { SkewButton } from "@/components/ui/SkewPanel";
import { StopScreen } from "@/components/menu/StopScreen";

/**
 * What the player sees when something throws.
 *
 * The App Router had no error boundary at all, which means an exception
 * anywhere under the root layout unmounted the tree and left a blank page —
 * in development behind the dev overlay, in production behind nothing. A
 * sixty-frame simulation has a lot of surface to throw from, and "the screen
 * went white" is the one bug report that carries no information whatsoever.
 *
 * `reset()` re-renders the segment that failed without a full page load, so a
 * transient failure costs the player a click rather than the match. It is
 * offered first because it is the cheaper of the two exits; the menu is there
 * for when retrying has plainly stopped helping.
 *
 * `error.digest` is the only identifying detail React gives on a production
 * build — the message itself is stripped, and the digest is what matches this
 * crash to a server log. Showing it is the difference between a report that can
 * be traced and one that cannot.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    // The overlay shows this in development and swallows it in production, so
    // log it here to keep one consistent place for it to have been recorded.
    console.error("Match stopped:", error);
  }, [error]);

  return (
    <StopScreen
      heading="No contest"
      message="Something in the match threw and the screen stopped. Try again, or go back to the menu."
      detail={error.digest ? `Digest ${error.digest}` : error.message || undefined}
      action={
        <>
          <SkewButton
            onClick={reset}
            className="border-[4px] border-panel-ink bg-smash-yellow px-10 py-3 text-panel-ink shadow-[0_8px_0_rgb(0_0_0/0.45)] transition-transform hover:-translate-y-1"
            innerClassName="font-display text-xl tracking-[0.18em] uppercase"
          >
            Try Again
          </SkewButton>

          <SkewButton
            onClick={() => router.push("/menu")}
            className="border-[3px] border-panel-ink bg-[#2a2d33] px-6 py-3 text-white/80 transition-colors hover:bg-[#383c44]"
            innerClassName="font-display text-base tracking-[0.16em] uppercase"
          >
            Main Menu
          </SkewButton>
        </>
      }
    />
  );
}
