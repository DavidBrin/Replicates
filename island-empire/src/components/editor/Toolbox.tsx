"use client";

import type { Building, Decoration, Terrain, UnitLevel } from "@/engine/types";

import type { Tool } from "./editorModel";
import { useEditorStore } from "./editorStore";
import { BUILDING_GLYPH, PLAYER_HEX, TERRAIN_FILL } from "./palette";
import { PixelButton, PixelText } from "./ui";

/**
 * Every brush. Each button is a `Tool`; the store keeps the active one and
 * the canvas applies it per tile. Grouped the way the store's reducers are:
 * terrain, overlays, owner, objects.
 */

const TERRAIN_TOOLS: Array<{ terrain: Terrain; label: string }> = [
  { terrain: "grass", label: "Grass" },
  { terrain: "sand", label: "Sand" },
  { terrain: "snow", label: "Snow" },
  { terrain: "water", label: "Water" },
  { terrain: "bridge", label: "Bridge" },
  { terrain: "mountain", label: "Mountain" },
  { terrain: "forestPine", label: "Pine" },
  { terrain: "forestPalm", label: "Palm" },
  { terrain: "forestIcePine", label: "Ice pine" },
  { terrain: "grassField", label: "Field" },
  { terrain: "grave", label: "Grave" },
];

const DECORATION_TOOLS: Array<{ decoration: Decoration | null; label: string }> = [
  { decoration: "rock", label: "Rock" },
  { decoration: "flowerWhite", label: "Flower" },
  { decoration: "flowerPurple", label: "Violet" },
  { decoration: "bush", label: "Bush" },
  { decoration: "tree", label: "Tree" },
  { decoration: null, label: "No deco" },
];

const BUILDING_TOOLS: Building[] = ["city", "farm", "mine", "chest", "woodwall", "stoneTower"];
const BUILDING_LABEL: Record<Building, string> = {
  city: "City",
  farm: "Farm",
  mine: "Mine",
  chest: "Chest",
  woodwall: "Wood wall",
  stoneTower: "Stone tower",
};

function sameTool(a: Tool, b: Tool): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function ToolButton({ tool, label, swatch, testId }: { tool: Tool; label: string; swatch?: string; testId?: string }) {
  const current = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const active = sameTool(current, tool);
  return (
    <PixelButton
      tone="wood"
      active={active}
      aria-pressed={active}
      data-testid={testId}
      onClick={() => setTool(tool)}
      className="flex items-center gap-1.5 text-xs"
    >
      {swatch ? (
        <span className="inline-block h-3 w-3 rounded-sm border border-[#1A1010]" style={{ background: swatch }} />
      ) : null}
      {label}
    </PixelButton>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <PixelText as="h3" className="text-xs uppercase tracking-wider opacity-90">
        {title}
      </PixelText>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

export function Toolbox() {
  const players = useEditorStore((s) => s.draft.players);

  return (
    <div className="flex flex-col gap-3" data-testid="editor-toolbox">
      <Group title="Terrain">
        {TERRAIN_TOOLS.map(({ terrain, label }) => (
          <ToolButton
            key={terrain}
            tool={{ kind: "terrain", terrain }}
            label={label}
            swatch={TERRAIN_FILL[terrain]}
            testId={`tool-terrain-${terrain}`}
          />
        ))}
      </Group>
      <Group title="Overlays">
        <ToolButton tool={{ kind: "road" }} label="Road" swatch="#F0CE70" testId="tool-road" />
        {DECORATION_TOOLS.map(({ decoration, label }) => (
          <ToolButton
            key={label}
            tool={{ kind: "decoration", decoration }}
            label={label}
            testId={`tool-decoration-${decoration ?? "none"}`}
          />
        ))}
      </Group>
      <Group title="Owner">
        <ToolButton tool={{ kind: "owner", owner: null }} label="Neutral" testId="tool-owner-neutral" />
        {players.map((player) => (
          <ToolButton
            key={player.index}
            tool={{ kind: "owner", owner: player.index }}
            label={`P${player.index + 1}`}
            swatch={PLAYER_HEX[player.colour]}
            testId={`tool-owner-${player.index}`}
          />
        ))}
      </Group>
      <Group title="Objects">
        {BUILDING_TOOLS.map((building) => (
          <ToolButton
            key={building}
            tool={{ kind: "building", building }}
            label={`${BUILDING_GLYPH[building]} ${BUILDING_LABEL[building]}`}
            testId={`tool-building-${building}`}
          />
        ))}
        {([1, 2, 3, 4] as UnitLevel[]).map((level) => (
          <ToolButton key={level} tool={{ kind: "unit", level }} label={`Knight ${level}`} testId={`tool-unit-${level}`} />
        ))}
        <ToolButton tool={{ kind: "eraser" }} label="Eraser" testId="tool-eraser" />
      </Group>
    </div>
  );
}
