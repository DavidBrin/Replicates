import type { PropKind } from "@/content/overworld";

/**
 * Code-drawn SVG sprites for the campaign overworld (D18 — no image
 * assets). All drawn in a local 0,0-centred coordinate space at roughly
 * 40 units per sprite, so the Overworld scales them by `scale`.
 */

const INK = "var(--ie-ink, #1A1010)";

export function Pine({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} aria-hidden="true">
      <rect x={-4} y={10} width={8} height={10} fill="var(--ie-trunk, #502820)" stroke={INK} strokeWidth={2} />
      <polygon points="0,-26 -18,12 18,12" fill="var(--ie-pine, #209058)" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      <polygon points="0,-26 4,-14 18,12 8,12" fill="var(--ie-pine-shadow, #1F5847)" />
      <polygon points="0,-18 -10,2 -2,2" fill="var(--ie-pine-light, #60C05F)" opacity={0.7} />
    </g>
  );
}

export function RoundTree({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} aria-hidden="true">
      <rect x={-3} y={6} width={6} height={12} fill="var(--ie-trunk, #502820)" stroke={INK} strokeWidth={2} />
      <circle cx={0} cy={-6} r={16} fill="var(--ie-pine-light, #60C05F)" stroke={INK} strokeWidth={2} />
      <circle cx={5} cy={-2} r={10} fill="var(--ie-pine, #209058)" />
      <circle cx={-6} cy={-10} r={4} fill="#9fe08a" />
    </g>
  );
}

export function Rock({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} aria-hidden="true">
      <polygon points="-14,10 -10,-8 0,-14 12,-6 14,10" fill="var(--ie-mountain, #A86061)" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      <polygon points="-10,-8 0,-14 2,-4 -6,0" fill="var(--ie-mountain-light, #BF806F)" />
      <polygon points="2,-4 12,-6 14,10 4,10" fill="var(--ie-mountain-dark, #784049)" />
    </g>
  );
}

export function Flower({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} aria-hidden="true">
      <rect x={-1.5} y={0} width={3} height={10} fill="var(--ie-pine, #209058)" />
      <circle cx={0} cy={-2} r={5} fill="#fff" stroke={INK} strokeWidth={1.5} />
      <circle cx={0} cy={-2} r={2} fill="var(--ie-gold, #FED942)" />
      <circle cx={11} cy={4} r={4} fill="var(--ie-p-purple, #8E44AD)" stroke={INK} strokeWidth={1.5} />
    </g>
  );
}

export function Bush({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} aria-hidden="true">
      <ellipse cx={0} cy={0} rx={16} ry={10} fill="var(--ie-field, #99D333)" stroke={INK} strokeWidth={2} />
      <ellipse cx={-5} cy={-3} rx={6} ry={4} fill="#c2ee7a" />
    </g>
  );
}

export function Hut({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} aria-hidden="true">
      <rect x={-14} y={-4} width={28} height={18} fill="var(--ie-card-cream, #F1E2B2)" stroke={INK} strokeWidth={2} />
      <polygon points="-18,-2 0,-22 18,-2" fill="var(--ie-gold, #FED942)" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      <rect x={-4} y={4} width={8} height={10} fill="var(--ie-wood-deep, #7D4F1F)" stroke={INK} strokeWidth={1.5} />
    </g>
  );
}

export function Boat({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} aria-hidden="true">
      <polygon points="-16,0 16,0 10,8 -10,8" fill="var(--ie-wood-light, #C08A4F)" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      <rect x={-1} y={-18} width={2} height={18} fill={INK} />
      <polygon points="1,-17 12,-6 1,-6" fill="#fff" stroke={INK} strokeWidth={1.5} />
    </g>
  );
}

export function Prop({ kind, x, y, scale }: { kind: PropKind; x: number; y: number; scale?: number }) {
  switch (kind) {
    case "pine":
      return <Pine x={x} y={y} scale={scale} />;
    case "tree":
      return <RoundTree x={x} y={y} scale={scale} />;
    case "rock":
      return <Rock x={x} y={y} scale={scale} />;
    case "flower":
      return <Flower x={x} y={y} scale={scale} />;
    case "bush":
      return <Bush x={x} y={y} scale={scale} />;
    case "hut":
      return <Hut x={x} y={y} scale={scale} />;
    case "boat":
      return <Boat x={x} y={y} scale={scale} />;
  }
}

/** The walking avatar: the blue level-1 knight, ~48 units tall, feet at the origin. */
export function Avatar({ x, y, walking, facing }: { x: number; y: number; walking: boolean; facing: 1 | -1 }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${facing} 1)`} aria-hidden="true" data-testid="overworld-avatar">
      <ellipse cx={0} cy={2} rx={14} ry={5} fill="rgba(26,16,16,0.35)" />
      <g className={walking ? "ie-bob" : undefined}>
        {/* legs */}
        <rect x={-8} y={-14} width={6} height={14} fill="var(--ie-wood-deep, #7D4F1F)" stroke={INK} strokeWidth={2} />
        <rect x={2} y={-14} width={6} height={14} fill="var(--ie-wood-deep, #7D4F1F)" stroke={INK} strokeWidth={2} />
        {/* body */}
        <rect x={-10} y={-34} width={20} height={22} fill="var(--ie-p-blue, #337DF8)" stroke={INK} strokeWidth={2} />
        <rect x={-3} y={-30} width={6} height={4} fill="#fff" opacity={0.6} />
        {/* arm + sword */}
        <rect x={8} y={-32} width={6} height={14} fill="#e8b48a" stroke={INK} strokeWidth={2} />
        <rect x={12} y={-52} width={4} height={26} fill="var(--ie-stone-light, #AFB9D2)" stroke={INK} strokeWidth={1.5} />
        {/* head */}
        <rect x={-9} y={-52} width={18} height={18} fill="#e8b48a" stroke={INK} strokeWidth={2} />
        <rect x={-9} y={-54} width={18} height={6} fill="var(--ie-wood-deep, #7D4F1F)" stroke={INK} strokeWidth={2} />
        <rect x={-5} y={-44} width={3} height={3} fill={INK} />
        <rect x={3} y={-44} width={3} height={3} fill={INK} />
      </g>
    </g>
  );
}

/** Small padlock glyph for locked nodes. */
export function Lock({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} aria-hidden="true">
      <rect x={-9} y={-4} width={18} height={14} rx={2} fill="var(--ie-stone, #838A9C)" stroke={INK} strokeWidth={2} />
      <path d="M -5 -4 V -10 A 5 5 0 0 1 5 -10 V -4" fill="none" stroke={INK} strokeWidth={3} />
      <rect x={-2} y={0} width={4} height={6} fill={INK} />
    </g>
  );
}
