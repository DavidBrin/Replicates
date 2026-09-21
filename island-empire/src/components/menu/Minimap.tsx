import type { MapDefinition, Terrain } from "@/engine/types";
import { PLAYER_COLOUR_HEX } from "@/components/ui/PlayerDot";

/**
 * A tiny SVG thumbnail of a `MapDefinition` (the weekly-card thumbnails of
 * `play-06.png`): terrain fills, owner tints, cities as squares. One `rect`
 * per tile — 26×26 is 676 rects, fine for a static preview.
 */
const TERRAIN_FILL: Record<Terrain, string> = {
  grass: "#B0D848",
  sand: "#F4BF73",
  snow: "#F2F2F2",
  water: "#2898F0",
  bridge: "#C08A4F",
  grassField: "#99D333",
  grave: "#AFB9D2",
  forestPine: "#209058",
  forestPalm: "#2E9A50",
  forestIcePine: "#9FD3E8",
  mountain: "#A86061",
};

export function Minimap({ map, size = 160, className }: { map: MapDefinition; size?: number; className?: string }) {
  const scale = size / Math.max(map.width, map.height);
  const w = map.width * scale;
  const h = map.height * scale;
  return (
    <svg
      viewBox={`0 0 ${map.width} ${map.height}`}
      width={w}
      height={h}
      shapeRendering="crispEdges"
      className={className}
      role="img"
      aria-label={`${map.name} map preview`}
      data-testid="minimap"
      style={{ border: "3px solid var(--ie-ink)", borderRadius: 4, background: TERRAIN_FILL.water, display: "block" }}
    >
      {map.tiles.map((t, i) => {
        const x = i % map.width;
        const y = (i - x) / map.width;
        const owner = t.owner !== null ? map.players[t.owner] : undefined;
        return (
          <g key={i}>
            <rect x={x} y={y} width={1} height={1} fill={TERRAIN_FILL[t.terrain]} />
            {owner && <rect x={x + 0.08} y={y + 0.08} width={0.84} height={0.84} fill="none" stroke={PLAYER_COLOUR_HEX[owner.colour]} strokeWidth={0.16} />}
            {t.building === "city" && owner && <rect x={x + 0.22} y={y + 0.22} width={0.56} height={0.56} fill={PLAYER_COLOUR_HEX[owner.colour]} stroke="#1A1010" strokeWidth={0.1} />}
            {(t.building === "mine" || t.building === "chest") && <rect x={x + 0.25} y={y + 0.25} width={0.5} height={0.5} fill="#FED942" stroke="#1A1010" strokeWidth={0.1} />}
            {t.unit && <circle cx={x + 0.5} cy={y + 0.5} r={0.22} fill="#1A1010" />}
          </g>
        );
      })}
    </svg>
  );
}

export default Minimap;
