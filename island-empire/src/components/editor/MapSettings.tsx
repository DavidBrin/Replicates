"use client";

import type { Biome } from "@/engine/types";
import { MAP_MAX_SIZE, MAP_MIN_SIZE, MAX_PLAYERS, MIN_PLAYERS } from "@/lib/mapSchema";

import { useEditorStore } from "./editorStore";
import { BIOME_BASE, PLAYER_HEX } from "./palette";
import { Field, PixelButton, PixelText, inputClass } from "./ui";

/** Name, author, size, biome, player count and per-seat start gold. */
export function MapSettings() {
  const draft = useEditorStore((s) => s.draft);
  const setName = useEditorStore((s) => s.setName);
  const setAuthor = useEditorStore((s) => s.setAuthor);
  const resize = useEditorStore((s) => s.resize);
  const setBiome = useEditorStore((s) => s.setBiome);
  const setPlayers = useEditorStore((s) => s.setPlayers);
  const setStartGold = useEditorStore((s) => s.setStartGold);
  const setPlayerKind = useEditorStore((s) => s.setPlayerKind);
  const fill = useEditorStore((s) => s.fill);
  const clear = useEditorStore((s) => s.clear);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);

  return (
    <div className="flex flex-col gap-3" data-testid="editor-settings">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Name" htmlFor="editor-name">
          <input
            id="editor-name"
            data-testid="editor-name"
            className={inputClass}
            value={draft.name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Author" htmlFor="editor-author">
          <input
            id="editor-author"
            data-testid="editor-author"
            className={inputClass}
            value={draft.author}
            maxLength={40}
            onChange={(e) => setAuthor(e.target.value)}
          />
        </Field>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Field label="Width" htmlFor="editor-width">
          <input
            id="editor-width"
            data-testid="editor-width"
            type="number"
            className={inputClass}
            min={MAP_MIN_SIZE}
            max={MAP_MAX_SIZE}
            value={draft.width}
            onChange={(e) => resize(Number(e.target.value), draft.height)}
          />
        </Field>
        <Field label="Height" htmlFor="editor-height">
          <input
            id="editor-height"
            data-testid="editor-height"
            type="number"
            className={inputClass}
            min={MAP_MIN_SIZE}
            max={MAP_MAX_SIZE}
            value={draft.height}
            onChange={(e) => resize(draft.width, Number(e.target.value))}
          />
        </Field>
        <Field label="Biome" htmlFor="editor-biome">
          <select
            id="editor-biome"
            data-testid="editor-biome"
            className={inputClass}
            value={draft.biome}
            onChange={(e) => setBiome(e.target.value as Biome)}
          >
            <option value="grass">Grass</option>
            <option value="desert">Desert</option>
            <option value="snow">Snow</option>
          </select>
        </Field>
      </div>

      <Field label={`Players (${draft.players.length})`} htmlFor="editor-players">
        <input
          id="editor-players"
          data-testid="editor-players"
          type="range"
          min={MIN_PLAYERS}
          max={MAX_PLAYERS}
          value={draft.players.length}
          onChange={(e) => setPlayers(Number(e.target.value))}
        />
      </Field>

      <div className="flex flex-col gap-1">
        {draft.players.map((player) => (
          <div key={player.index} className="flex items-center gap-2 text-xs">
            <span
              className="inline-block h-4 w-4 rounded-sm border-2 border-[#1A1010]"
              style={{ background: PLAYER_HEX[player.colour] }}
              aria-hidden
            />
            <PixelText className="w-8">P{player.index + 1}</PixelText>
            <select
              aria-label={`Player ${player.index + 1} kind`}
              className={`${inputClass} py-0.5 text-xs`}
              value={player.kind}
              onChange={(e) => setPlayerKind(player.index, e.target.value as "human" | "ai" | "empty")}
            >
              <option value="human">Human</option>
              <option value="ai">AI</option>
            </select>
            <label className="flex items-center gap-1">
              <PixelText className="text-[10px] uppercase">Gold</PixelText>
              <input
                aria-label={`Player ${player.index + 1} start gold`}
                type="number"
                min={0}
                max={100000}
                className={`${inputClass} w-20 py-0.5 text-xs`}
                value={player.startGold}
                onChange={(e) => setStartGold(player.index, Number(e.target.value))}
              />
            </label>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <PixelButton onClick={undo} disabled={!canUndo} data-testid="editor-undo" className="text-xs">
          Undo
        </PixelButton>
        <PixelButton onClick={redo} disabled={!canRedo} data-testid="editor-redo" className="text-xs">
          Redo
        </PixelButton>
        <PixelButton onClick={() => fill(BIOME_BASE[draft.biome])} data-testid="editor-fill" className="text-xs">
          Fill ground
        </PixelButton>
        <PixelButton onClick={() => fill("water")} data-testid="editor-fill-water" className="text-xs">
          Fill water
        </PixelButton>
        <PixelButton onClick={clear} tone="red" data-testid="editor-clear" className="text-xs">
          Clear
        </PixelButton>
      </div>
    </div>
  );
}
