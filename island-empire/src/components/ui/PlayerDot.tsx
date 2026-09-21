import type { PlayerColour } from "@/engine/types";

/** CSS variable per seat colour (tokens in `globals.css`, values from SPEC §8). */
export const PLAYER_COLOUR_VAR: Record<PlayerColour, string> = {
  blue: "var(--ie-p-blue, #337DF8)",
  red: "var(--ie-p-red, #C6293B)",
  green: "var(--ie-p-green, #52C73F)",
  yellow: "var(--ie-p-yellow, #F2C531)",
  purple: "var(--ie-p-purple, #8E44AD)",
  pink: "var(--ie-p-pink, #DE26D3)",
  orange: "var(--ie-p-orange, #F07C2A)",
  grey: "var(--ie-p-grey, #595959)",
};

/** Literal hex per seat colour, for SVG/canvas contexts that cannot read CSS variables. */
export const PLAYER_COLOUR_HEX: Record<PlayerColour, string> = {
  blue: "#337DF8",
  red: "#C6293B",
  green: "#52C73F",
  yellow: "#F2C531",
  purple: "#8E44AD",
  pink: "#DE26D3",
  orange: "#F07C2A",
  grey: "#595959",
};

/** A small outlined square swatch in a seat's colour. */
export function PlayerDot({ colour, size = 14, title }: { colour: PlayerColour; size?: number; title?: string }) {
  return (
    <span
      title={title ?? colour}
      aria-label={title ?? colour}
      role="img"
      className="inline-block shrink-0 rounded-sm"
      style={{
        width: size,
        height: size,
        background: PLAYER_COLOUR_VAR[colour],
        border: "2px solid var(--ie-ink, #1A1010)",
        boxShadow: "inset 2px 2px 0 rgba(255,255,255,0.35)",
      }}
    />
  );
}

export default PlayerDot;
