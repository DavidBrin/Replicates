"use client";

import { create } from "zustand";

import type { Biome, MapDefinition, PlayerSlotDefinition, Terrain } from "@/engine/types";

import {
  clearMap,
  defaultDraft,
  fillMap,
  paintTile,
  resizeMap,
  setBiome,
  setPlayerCount,
  setPlayerKind,
  setStartGold,
  type Tool,
} from "./editorModel";

/**
 * The editor's state: a draft `MapDefinition`, an undo/redo history of
 * drafts, and the current tool. Editor-local — nothing here reaches the
 * session store until Play or Save.
 *
 * History granularity is one **stroke**: `beginStroke` snapshots the draft,
 * then every `paintAt` during the drag mutates the working draft without
 * snapshotting again, so one drag across twenty tiles is one undo.
 */

const HISTORY_LIMIT = 100;

export interface EditorState {
  draft: MapDefinition;
  past: MapDefinition[];
  future: MapDefinition[];
  tool: Tool;
  /** The owner brush's seat; also who gets a city/unit dropped on neutral land. */
  activeOwner: number;
  /** Set once a draft has been loaded from `?from=` so the page can say so. */
  loadedFrom: string | null;

  setTool: (tool: Tool) => void;
  setActiveOwner: (owner: number) => void;
  beginStroke: () => void;
  paintAt: (index: number) => void;
  /** One-shot: snapshot + paint, for a click that is not a drag. */
  paintOnce: (index: number) => void;

  resize: (width: number, height: number) => void;
  setPlayers: (count: number) => void;
  setPlayerKind: (index: number, kind: PlayerSlotDefinition["kind"]) => void;
  setStartGold: (index: number, gold: number) => void;
  setBiome: (biome: Biome) => void;
  setName: (name: string) => void;
  setAuthor: (author: string) => void;
  fill: (terrain: Terrain) => void;
  clear: () => void;
  load: (map: MapDefinition, from?: string | null) => void;
  reset: () => void;

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export const useEditorStore = create<EditorState>()((set, get) => {
  /** Replace the draft, recording the previous one. No-op when unchanged. */
  const commit = (next: MapDefinition): void => {
    const { draft, past } = get();
    if (next === draft) return;
    set({ draft: next, past: [...past, draft].slice(-HISTORY_LIMIT), future: [] });
  };

  return {
    draft: defaultDraft(),
    past: [],
    future: [],
    tool: { kind: "terrain", terrain: "grass" },
    activeOwner: 0,
    loadedFrom: null,

    setTool: (tool) =>
      set(tool.kind === "owner" && tool.owner !== null ? { tool, activeOwner: tool.owner } : { tool }),
    setActiveOwner: (owner) => set({ activeOwner: owner }),

    beginStroke: () => {
      const { draft, past } = get();
      set({ past: [...past, draft].slice(-HISTORY_LIMIT), future: [] });
    },
    paintAt: (index) => {
      const { draft, tool, activeOwner } = get();
      const next = paintTile(draft, index, tool, activeOwner);
      if (next !== draft) set({ draft: next });
    },
    paintOnce: (index) => {
      const { draft, tool, activeOwner } = get();
      commit(paintTile(draft, index, tool, activeOwner));
    },

    resize: (width, height) => commit(resizeMap(get().draft, width, height)),
    setPlayers: (count) => {
      commit(setPlayerCount(get().draft, count));
      const max = get().draft.players.length - 1;
      if (get().activeOwner > max) set({ activeOwner: max });
    },
    setPlayerKind: (index, kind) => commit(setPlayerKind(get().draft, index, kind)),
    setStartGold: (index, gold) => commit(setStartGold(get().draft, index, gold)),
    setBiome: (biome) => commit(setBiome(get().draft, biome)),
    setName: (name) => commit({ ...get().draft, name }),
    setAuthor: (author) => commit({ ...get().draft, author }),
    fill: (terrain) => commit(fillMap(get().draft, terrain)),
    clear: () => commit(clearMap(get().draft)),
    load: (map, from = null) => set({ draft: map, past: [], future: [], loadedFrom: from, activeOwner: 0 }),
    reset: () => set({ draft: defaultDraft(), past: [], future: [], loadedFrom: null, activeOwner: 0 }),

    undo: () => {
      const { draft, past, future } = get();
      const previous = past[past.length - 1];
      if (!previous) return;
      set({ draft: previous, past: past.slice(0, -1), future: [draft, ...future] });
    },
    redo: () => {
      const { draft, past, future } = get();
      const [next, ...rest] = future;
      if (!next) return;
      set({ draft: next, past: [...past, draft], future: rest });
    },
    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,
  };
});
