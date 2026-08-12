import { cn } from "@/lib/cn";
import type { MenuFighter, MenuPalette } from "@/lib/matchConfig";

/**
 * A drawn bust, from the fighter's own palette.
 *
 * There is no legitimate way to obtain Nintendo's character art, and a grid of
 * coloured squares would tell the player nothing. So each fighter gets a
 * stylised silhouette built from the same five colours the canvas renderer
 * poses its capsules with — the portrait and the fighter on the stage are
 * recognisably the same character because they are drawn from one source.
 *
 * The silhouette is chosen by matching the fighter's id rather than by an
 * index, because the roster module is authored separately and its ids are the
 * only thing about it this component can rely on. An unrecognised id falls
 * through to a neutral bust rather than to nothing.
 */

type Variant = "mario" | "dk" | "link" | "samus" | "kirby" | "fox" | "pikachu" | "marth" | "generic";

export function bustVariant(id: string): Variant {
  const key = id.toLowerCase().replace(/[^a-z]/g, "");
  if (key.includes("mario")) return "mario";
  if (key.includes("donkey") || key === "dk") return "dk";
  if (key.includes("link")) return "link";
  if (key.includes("samus")) return "samus";
  if (key.includes("kirby")) return "kirby";
  if (key.includes("fox")) return "fox";
  if (key.includes("pikachu")) return "pikachu";
  if (key.includes("marth")) return "marth";
  return "generic";
}

interface FighterBustProps {
  fighter: MenuFighter;
  className?: string;
  /** Dims the art without changing its colours, for an unfocused portrait. */
  dim?: boolean;
}

export function FighterBust({ fighter, className, dim }: FighterBustProps) {
  const p = fighter.palette;
  const variant = bustVariant(fighter.id);

  return (
    <div
      className={cn("relative isolate overflow-hidden", className)}
      style={{
        background: `radial-gradient(circle at 50% 26%, ${p.secondary} 0%, ${p.outline} 78%)`,
      }}
    >
      {/* The pale wedge behind every Ultimate portrait, running the same way
          as the panel shear. */}
      <span
        aria-hidden
        className="absolute inset-y-[-10%] left-[-10%] w-[70%] opacity-25"
        style={{ transform: "skewX(-12deg)", background: `linear-gradient(90deg, ${p.primary}, transparent)` }}
      />
      <svg
        viewBox="0 0 100 100"
        className={cn("relative h-full w-full transition-opacity", dim && "opacity-60")}
        aria-hidden
        focusable="false"
      >
        <Bust variant={variant} p={p} />
      </svg>
    </div>
  );
}

function Bust({ variant, p }: { variant: Variant; p: MenuPalette }) {
  const stroke = { stroke: p.outline, strokeWidth: 2.4, strokeLinejoin: "round" as const };

  if (variant === "kirby") {
    return (
      <g {...stroke}>
        <ellipse cx="30" cy="88" rx="13" ry="8" fill={p.secondary} />
        <ellipse cx="70" cy="88" rx="13" ry="8" fill={p.secondary} />
        <circle cx="50" cy="52" r="33" fill={p.primary} />
        <ellipse cx="20" cy="60" rx="9" ry="7" fill={p.primary} />
        <ellipse cx="80" cy="60" rx="9" ry="7" fill={p.primary} />
        <ellipse cx="41" cy="45" rx="3.6" ry="8.5" fill={p.outline} strokeWidth={0} />
        <ellipse cx="59" cy="45" rx="3.6" ry="8.5" fill={p.outline} strokeWidth={0} />
        <circle cx="32" cy="57" r="5" fill="#f8a2c2" strokeWidth={0} />
        <circle cx="68" cy="57" r="5" fill="#f8a2c2" strokeWidth={0} />
      </g>
    );
  }

  return (
    <g {...stroke}>
      <Shoulders p={p} wide={variant === "dk"} />
      <rect x="42" y="55" width="16" height="18" fill={p.skin} />
      <Head variant={variant} p={p} />
    </g>
  );
}

function Shoulders({ p, wide }: { p: MenuPalette; wide: boolean }) {
  const d = wide
    ? "M6 100 C 8 74, 28 64, 50 64 C 72 64, 92 74, 94 100 Z"
    : "M16 100 C 18 78, 33 69, 50 69 C 67 69, 82 78, 84 100 Z";
  return (
    <>
      <path d={d} fill={p.primary} />
      <path
        d="M50 70 L 50 100"
        fill="none"
        stroke={p.outline}
        strokeOpacity={0.35}
        strokeWidth={1.6}
      />
    </>
  );
}

function Head({ variant, p }: { variant: Variant; p: MenuPalette }) {
  const eyes = (
    <>
      <ellipse cx="43" cy="43" rx="2.7" ry="4.2" fill={p.outline} strokeWidth={0} />
      <ellipse cx="57" cy="43" rx="2.7" ry="4.2" fill={p.outline} strokeWidth={0} />
    </>
  );

  switch (variant) {
    case "mario":
      return (
        <>
          <ellipse cx="50" cy="44" rx="20" ry="21" fill={p.skin} />
          {eyes}
          <ellipse cx="50" cy="54" rx="11" ry="4" fill={p.outline} strokeWidth={0} />
          <path d="M29 33 C 31 18, 69 18, 71 33 Z" fill={p.primary} />
          <path d="M26 33 H 74 C 74 38, 62 39, 50 39 C 38 39, 26 38, 26 33 Z" fill={p.primary} />
          <circle cx="50" cy="27" r="6" fill="#ffffff" />
          <text
            x="50"
            y="30.5"
            textAnchor="middle"
            fill={p.primary}
            strokeWidth={0}
            style={{ fontFamily: "var(--font-display, sans-serif)", fontSize: "9px" }}
          >
            M
          </text>
        </>
      );

    case "dk":
      return (
        <>
          <circle cx="24" cy="40" r="8" fill={p.skin} />
          <circle cx="76" cy="40" r="8" fill={p.skin} />
          <ellipse cx="50" cy="42" rx="22" ry="22" fill={p.primary} />
          <ellipse cx="50" cy="50" rx="15" ry="12" fill={p.skin} />
          <ellipse cx="44" cy="40" rx="3" ry="4" fill={p.outline} strokeWidth={0} />
          <ellipse cx="56" cy="40" rx="3" ry="4" fill={p.outline} strokeWidth={0} />
          <ellipse cx="50" cy="49" rx="4" ry="2.6" fill={p.outline} strokeWidth={0} />
          <path d="M50 72 l8 7 -8 21 -8 -21 z" fill={p.accent} />
        </>
      );

    case "link":
      return (
        <>
          <path d="M64 24 C 82 20, 94 8, 90 2 C 78 4, 66 16, 60 28 Z" fill={p.primary} />
          <path d="M28 42 l-11 -7 5 15 z" fill={p.skin} />
          <path d="M72 42 l11 -7 -5 15 z" fill={p.skin} />
          <ellipse cx="50" cy="44" rx="19" ry="20" fill={p.skin} />
          {eyes}
          <path d="M31 34 C 33 22, 67 22, 69 34 C 62 28, 38 28, 31 34 Z" fill={p.accent} />
          <path d="M29 32 C 31 16, 69 16, 71 32 Z" fill={p.primary} />
        </>
      );

    case "samus":
      return (
        <>
          <rect x="46" y="14" width="8" height="12" fill={p.secondary} />
          <path d="M28 46 C 28 22, 72 22, 72 46 L 72 54 C 72 63, 28 63, 28 54 Z" fill={p.primary} />
          <path d="M35 42 C 39 32, 61 32, 65 42 L 62 52 C 55 56, 45 56, 38 52 Z" fill={p.accent} />
          <path d="M38 40 C 42 35, 50 34, 54 36" fill="none" stroke="#ffffff" strokeOpacity={0.6} strokeWidth={2} />
        </>
      );

    case "fox":
      return (
        <>
          <path d="M31 30 l-8 -24 20 13 z" fill={p.primary} />
          <path d="M69 30 l8 -24 -20 13 z" fill={p.primary} />
          <ellipse cx="50" cy="44" rx="19" ry="20" fill={p.primary} />
          <ellipse cx="50" cy="52" rx="13" ry="9" fill={p.secondary} />
          <ellipse cx="50" cy="47" rx="3.4" ry="2.4" fill={p.outline} strokeWidth={0} />
          {eyes}
          <rect x="64" y="37" width="10" height="12" rx="4" fill={p.accent} />
        </>
      );

    case "pikachu":
      return (
        <>
          <path d="M33 26 l-12 -24 20 13 z" fill={p.primary} />
          <path d="M67 26 l12 -24 -20 13 z" fill={p.primary} />
          <path d="M25 8 l-4 -6 8 5 z" fill={p.outline} strokeWidth={0} />
          <path d="M75 8 l4 -6 -8 5 z" fill={p.outline} strokeWidth={0} />
          <ellipse cx="50" cy="46" rx="22" ry="20" fill={p.primary} />
          {eyes}
          <circle cx="30" cy="54" r="6" fill={p.accent} />
          <circle cx="70" cy="54" r="6" fill={p.accent} />
          <path d="M45 55 q5 5 10 0" fill="none" stroke={p.outline} strokeWidth={2} />
        </>
      );

    case "marth":
      return (
        <>
          <ellipse cx="50" cy="45" rx="19" ry="20" fill={p.skin} />
          {eyes}
          <path d="M29 44 C 27 18, 73 18, 71 44 C 66 31, 34 31, 29 44 Z" fill={p.primary} />
          <path d="M35 27 l15 -9 15 9 -6 4 -9 -5 -9 5 z" fill={p.accent} />
        </>
      );

    default:
      return (
        <>
          <ellipse cx="50" cy="44" rx="19" ry="20" fill={p.skin} />
          {eyes}
          <path d="M30 40 C 30 20, 70 20, 70 40 C 62 30, 38 30, 30 40 Z" fill={p.secondary} />
        </>
      );
  }
}
