"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { MapDefinition } from "@/engine/types";
import { useSessionConfig } from "@/game/sessionConfig";
import { hashSeed } from "@/lib/weekly";
import { PixelButton } from "@/components/editor/ui";

/** The share page's client island: Play, copy link, open in editor. */
export function ShareActions({ map }: { map: MapDefinition }) {
  const router = useRouter();
  const setConfig = useSessionConfig((s) => s.setConfig);
  const [copied, setCopied] = useState(false);
  const id = map.id!;

  const play = () => {
    const seed = hashSeed(`${id}:${Date.now()}`);
    setConfig({
      source: { kind: "custom", mapId: id },
      seats: map.players.map((p) => ({
        index: p.index,
        kind: p.kind === "human" ? "human" : "ai",
        aiDifficulty: "normal",
      })),
      difficulty: "normal",
      seed,
    });
    router.push(`/play/custom/${encodeURIComponent(id)}`);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <PixelButton tone="green" onClick={play} data-testid="map-play" className="px-6 py-2 text-lg">
        Play
      </PixelButton>
      <PixelButton onClick={copy} data-testid="map-copy-link">
        {copied ? "Copied!" : "Copy link"}
      </PixelButton>
      <Link href={`/editor?from=${encodeURIComponent(id)}`} data-testid="map-open-editor">
        <PixelButton tone="yellow">Open in editor</PixelButton>
      </Link>
    </div>
  );
}
