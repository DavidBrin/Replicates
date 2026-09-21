"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { useSessionConfig, type SessionConfig } from "@/game/sessionConfig";
import { parseMapDefinition } from "@/lib/mapSchema";
import { hashSeed } from "@/lib/weekly";

import { EditorCanvas } from "./EditorCanvas";
import { useEditorStore } from "./editorStore";
import { ImportExport } from "./ImportExport";
import { MapSettings } from "./MapSettings";
import { Toolbox } from "./Toolbox";
import { PixelButton, PixelText, WoodPanel } from "./ui";
import { useMapCheck } from "./ValidatePanel";
import { ValidatePanel } from "./ValidatePanel";

/**
 * The map editor screen (SPEC §7). Layout: grid on the left, three wood
 * panels of controls on the right; single column under 768px.
 *
 * `?from=<id>` loads a saved (or `seed:` bundled) map as a fresh draft —
 * saving it again creates a new row, never overwrites (there is no PUT).
 */
export function Editor() {
  const router = useRouter();
  const search = useSearchParams();
  const from = search.get("from");

  const draft = useEditorStore((s) => s.draft);
  const load = useEditorStore((s) => s.load);
  const loadedFrom = useEditorStore((s) => s.loadedFrom);
  const setConfig = useSessionConfig((s) => s.setConfig);
  const check = useMapCheck();

  const [saving, setSaving] = useState(false);
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [loadFailed, setLoadFailed] = useState<string | null>(null);
  // Loading is derived: a `?from=` that is neither loaded nor failed yet.
  const loading = from && from !== loadedFrom && loadFailed !== from ? from : null;

  useEffect(() => {
    if (!from || from === loadedFrom) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/maps/${encodeURIComponent(from)}`);
        if (!response.ok) throw new Error(`map ${from} not found`);
        const parsed = parseMapDefinition(await response.json());
        if (!parsed.ok) throw new Error(parsed.errors[0] ?? "map is malformed");
        if (!cancelled) load({ ...parsed.map, id: null }, from);
      } catch (error) {
        if (cancelled) return;
        setLoadFailed(from);
        setSaveErrors([error instanceof Error ? error.message : String(error)]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [from, loadedFrom, load]);

  const save = async () => {
    setSaving(true);
    setSaveErrors([]);
    try {
      const { id: _id, ...body } = draft;
      void _id;
      const response = await fetch("/api/maps", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as { id?: string; error?: string; errors?: string[] };
      if (response.status === 201 && payload.id) {
        router.push(`/maps/${payload.id}`);
        return;
      }
      setSaveErrors(payload.errors?.length ? payload.errors : [payload.error ?? `save failed (${response.status})`]);
    } catch (error) {
      setSaveErrors([error instanceof Error ? error.message : String(error)]);
    } finally {
      setSaving(false);
    }
  };

  const play = () => {
    const seed = hashSeed(`${draft.name}:${Date.now()}`);
    const config: SessionConfig = {
      source: { kind: "generated", map: draft, seed },
      seats: draft.players.map((p) => ({
        index: p.index,
        kind: p.kind === "human" ? "human" : "ai",
        aiDifficulty: "normal",
      })),
      difficulty: "normal",
      seed,
    };
    setConfig(config);
    router.push("/play/session");
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-3 p-3 md:p-4" data-testid="editor">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-white underline-offset-2 hover:underline">
            <PixelText>&lt; Menu</PixelText>
          </Link>
          <PixelText as="h1" className="text-2xl md:text-3xl">
            Map Editor
          </PixelText>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {loading ? <PixelText className="text-xs">Loading {loading}…</PixelText> : null}
          <PixelButton tone="yellow" onClick={play} data-testid="editor-play" disabled={!check.valid && check.engineReady}>
            Play
          </PixelButton>
          <PixelButton tone="green" onClick={save} data-testid="editor-save" disabled={saving || !check.valid}>
            {saving ? "Saving…" : "Save"}
          </PixelButton>
        </div>
      </header>

      {saveErrors.length > 0 ? (
        <WoodPanel testId="editor-save-errors" className="border-[#DF2607]">
          <PixelText as="h2" className="text-sm uppercase">
            Could not save
          </PixelText>
          <ul className="list-disc px-5 text-xs text-[#FFB4A8]">
            {saveErrors.map((error, i) => (
              <li key={`${i}-${error}`}>{error}</li>
            ))}
          </ul>
        </WoodPanel>
      ) : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_340px]">
        <WoodPanel className="min-w-0">
          <EditorCanvas />
          <p className="mt-2 text-xs text-[#F1E2B2]">
            {draft.width}×{draft.height} · {draft.players.length} players · {draft.biome}. Click or drag to paint; touch works too.
          </p>
        </WoodPanel>
        <div className="flex flex-col gap-3">
          <WoodPanel>
            <MapSettings />
          </WoodPanel>
          <WoodPanel>
            <Toolbox />
          </WoodPanel>
          <WoodPanel>
            <ValidatePanel />
          </WoodPanel>
          <WoodPanel>
            <ImportExport />
          </WoodPanel>
        </div>
      </div>
    </main>
  );
}
