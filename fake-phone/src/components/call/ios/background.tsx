/**
 * The two backgrounds, which are half of whether this reads as iOS at all.
 *
 * Getting the background model wrong is the second thing replicas most often
 * miss (research/ios-call-ui.md §7.2): the real screen is either a full-bleed
 * poster with a bottom-weighted scrim, or — with no photo — a dark neutral
 * gradient behind a large rounded monogram. It is never a plain black screen
 * with a small grey circle avatar, which is the Android/WhatsApp model.
 */

import clsx from "clsx";

import { initialsFor } from "@/domain/format";

import { IOS_TEST_IDS } from "./ids";

const LAYER = "pointer-events-none absolute inset-0";

/**
 * `ui-rounded` resolves to SF Compact Rounded on Apple devices, which is the
 * face iOS uses for the monogram and the first system surface to use it at all
 * (research/ios-call-ui.md §1.3) — for free, with no font file and so no
 * licensing exposure. Elsewhere it falls through to the normal iOS stack.
 */
const MONOGRAM_FONT = "ui-rounded, var(--font-ios)";

function PhotoLayer({ photo, className }: { photo: string; className?: string }) {
  return (
    <div
      data-testid={IOS_TEST_IDS.photo}
      className={clsx(LAYER, "bg-cover bg-center", className)}
      style={{ backgroundImage: `url("${photo}")` }}
    />
  );
}

/** Incoming call: full-bleed poster, or the fallback gradient + monogram. */
export function IncomingBackground({ photo, callerName }: { photo: string; callerName: string }) {
  if (photo) {
    return (
      <>
        <PhotoLayer photo={photo} />
        {/* Bottom-weighted scrim so the white buttons stay legible over a bright
         * photo — transparent until ~55% down (research/ios-call-ui.md §1.2). */}
        <div
          className={clsx(
            LAYER,
            "bg-[linear-gradient(to_bottom,rgba(0,0,0,0)_55%,rgba(0,0,0,0.55)_100%)]",
          )}
        />
      </>
    );
  }

  return (
    <>
      <div
        className={clsx(
          LAYER,
          "bg-[linear-gradient(180deg,var(--color-ios-fallback-top)_0%,var(--color-ios-fallback-bottom)_100%)]",
        )}
      />
      <div
        data-testid={IOS_TEST_IDS.monogram}
        className={clsx(
          LAYER,
          "flex items-center justify-center text-[clamp(96px,30vw,168px)] leading-none font-light text-white/90",
        )}
        style={{ fontFamily: MONOGRAM_FONT }}
      >
        {initialsFor(callerName)}
      </div>
    </>
  );
}

/**
 * In call: flat dark gradient, or the poster blurred out behind it
 * (research/ios-call-ui.md §2.5). No monogram here — once the call connects the
 * name and timer at the top carry the identity.
 */
export function InCallBackground({ photo }: { photo: string }) {
  return (
    <>
      <div
        className={clsx(LAYER, "bg-[linear-gradient(180deg,var(--color-ios-gray6)_0%,#000_100%)]")}
      />
      {photo ? (
        <>
          <PhotoLayer photo={photo} className="scale-110 blur-[70px] brightness-50" />
          <div className={clsx(LAYER, "bg-black/35")} />
        </>
      ) : null}
    </>
  );
}
