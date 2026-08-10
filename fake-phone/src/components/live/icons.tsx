/**
 * The live-mode glyph set.
 *
 * Every icon here is drawn from scratch as a plain single-colour stroke or fill
 * — no gradients, no brand marks. That is a hard constraint, not a style
 * preference: research/instagram-live-ui.md §9 names the Instagram camera
 * glyph and its pink→orange→yellow gradient as the single highest trade-dress
 * risk assets in this whole screen. The camera glyph below is a deliberately
 * generic body-plus-lens outline of the kind every camera app in the world
 * ships, and nothing in this file uses more than one colour.
 */

interface IconProps {
  readonly className?: string;
}

/** Viewer-count pill. research/instagram-live-ui.md §1b: an open-eye outline,
 * which is confirmed (HIGH) as the counter's icon across live products. */
export function EyeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function MoreIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <circle cx="5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="19" cy="12" r="1.7" />
    </svg>
  );
}

/** Stands in for the effects/filters control. A four-point sparkle rather than
 * any platform's specific wand mark. */
export function SparkleIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M12 3.5c.6 3.9 1.6 4.9 5.5 5.5-3.9.6-4.9 1.6-5.5 5.5-.6-3.9-1.6-4.9-5.5-5.5 3.9-.6 4.9-1.6 5.5-5.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M18 15c.3 1.9.8 2.4 2.7 2.7-1.9.3-2.4.8-2.7 2.7-.3-1.9-.8-2.4-2.7-2.7 1.9-.3 2.4-.8 2.7-2.7Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Front/rear toggle: two curved arrows around a lens. Generic — this is the
 * industry-standard flip affordance, not a copied mark. */
export function FlipCameraIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M4 9a8 8 0 0 1 13.3-3M20 15A8 8 0 0 1 6.7 18"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M17.5 3v3.2h-3.2M6.5 21v-3.2h3.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function HeartIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12 20.4 3.9 12.6a5 5 0 0 1 7.1-7l1 1 1-1a5 5 0 1 1 7.1 7L12 20.4Z" />
    </svg>
  );
}

/**
 * The primer's camera glyph.
 *
 * A plain outlined body + lens. Explicitly NOT a rounded-square outline with a
 * circle and a dot in the corner — that silhouette is the Instagram mark, and
 * research §9 says to use a generic camera instead.
 */
export function CameraIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M3.5 8.5A2 2 0 0 1 5.5 6.5h2l1.2-2h6.6l1.2 2h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-8Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12.5" r="3.4" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
