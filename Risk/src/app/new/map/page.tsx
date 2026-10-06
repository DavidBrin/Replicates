"use client";

/**
 * The map picker (SPEC §7, `/new/map`).
 *
 * A grid of ~8:7 tiles over a pale-blue radial ray burst fading to `#0E2430`,
 * **no locked tiles — every map is free**, plus a `Random map` tile that
 * writes `{ kind: "random", options, seed }` into the store with
 * territory-count and continent-count steppers for the `VoronoiOptions`.
 *
 * The catalogue comes from `playMapSlugs()`, never `@/content/maps`: S3 has
 * not shipped the real one, so the picker lists S4's development boards until
 * it does.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { MapTile } from "@/components/setup/MapTile";
import { Icon } from "@/components/ui/Icon";
import { Pill } from "@/components/ui/Pill";
import { SETUP_TOKENS } from "@/components/ui/tokens";
import { playMapSlugs } from "@/game/pending";
import { DEFAULT_VORONOI, sessionConfigStore, useSessionConfig, type VoronoiOptions } from "@/game/sessionConfig";

/** `crypto.randomUUID` where it exists; a timestamped fallback where it does not. */
function newSeed(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `seed-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function Stepper({
  name, value, min, max, onChange,
}: {
  readonly name: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (next: number) => void;
}) {
  const button = {
    width: 44, height: 44, borderRadius: 10,
    background: "var(--chrome-900)", border: "2px solid var(--chrome-line)", color: "var(--text)",
  } as const;
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        data-testid={`random-${name}-dec`}
        aria-label={`Fewer ${name}`}
        onClick={() => onChange(Math.max(min, value - 1))}
        className="font-head font-bold outline-none"
        style={button}
      >
        −
      </button>
      <span data-testid={`random-${name}-value`} className="min-w-[2.5ch] text-center font-head font-bold">
        {value}
      </span>
      <button
        type="button"
        data-testid={`random-${name}-inc`}
        aria-label={`More ${name}`}
        onClick={() => onChange(Math.min(max, value + 1))}
        className="font-head font-bold outline-none"
        style={button}
      >
        +
      </button>
    </div>
  );
}

export default function MapPickerPage() {
  const router = useRouter();
  const slugs = useMemo(() => playMapSlugs(), []);
  const source = useSessionConfig((s) => s.source);
  const [options, setOptions] = useState<VoronoiOptions>(DEFAULT_VORONOI);

  const randomSelected = source?.kind === "random";

  function pickRandom(next: VoronoiOptions) {
    setOptions(next);
    sessionConfigStore.getState().setSource({
      kind: "random",
      options: next,
      seed: source?.kind === "random" ? source.seed : newSeed(),
    });
  }

  return (
    <main
      data-testid="map-picker-screen"
      className="relative flex min-h-dvh flex-1 flex-col items-center gap-6 px-4 py-6"
      style={{
        background: `radial-gradient(circle at 50% 40%, #A9D8EC 0%, #2C6C8C 38%, ${SETUP_TOKENS.mapBackdrop} 100%)`,
      }}
    >
      <h1 className="on-board-text text-center" style={{ fontSize: "clamp(26px, 5vw, 48px)" }}>
        Choose a map
      </h1>

      <div className="grid w-full max-w-[1200px] grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-5">
        {slugs.map((slug) => (
          <MapTile
            key={slug}
            slug={slug}
            selected={source?.kind === "slug" && source.slug === slug}
            onSelect={() => sessionConfigStore.getState().setSource({ kind: "slug", slug })}
          />
        ))}

        {/* the Random map tile — ours, and the only tile with its own controls */}
        <div
          data-testid="map-tile-random-wrap"
          className="flex flex-col items-center justify-between gap-2 p-2"
          style={{
            aspectRatio: "8 / 7",
            borderRadius: "var(--r-menu)",
            border: `2px solid ${randomSelected ? "var(--go)" : "transparent"}`,
            background: randomSelected ? "rgba(166,220,95,.10)" : "transparent",
          }}
        >
          <button
            type="button"
            data-testid="map-tile-random"
            aria-pressed={randomSelected}
            data-selected={randomSelected ? "true" : "false"}
            onClick={() => pickRandom(options)}
            className="flex w-full flex-1 cursor-pointer flex-col items-center justify-center gap-2 outline-none focus-visible:ring-4 focus-visible:ring-white/70"
            style={{ minHeight: 44, color: "var(--text)" }}
          >
            <span className="on-board-text" style={{ fontSize: "clamp(18px, 2.6vw, 40px)" }}>
              Random map
            </span>
            <Icon name="dice-cup" size={72} />
          </button>

          <div className="flex w-full flex-wrap items-center justify-center gap-3" style={{ color: "var(--text)" }}>
            <label className="flex items-center gap-2 font-body text-sm">
              Territories
              <Stepper
                name="territories"
                value={options.territories}
                min={19}
                max={104}
                onChange={(territories) => pickRandom({ ...options, territories })}
              />
            </label>
            <label className="flex items-center gap-2 font-body text-sm">
              Continents
              <Stepper
                name="continents"
                value={options.continents}
                min={4}
                max={11}
                onChange={(continents) => pickRandom({ ...options, continents })}
              />
            </label>
          </div>
        </div>
      </div>

      <footer className="flex w-full justify-center pb-2 pt-4">
        <Pill
          label="Next"
          testId="map-next"
          disabled={source === null}
          onClick={() => router.push("/new/rules")}
        />
      </footer>
    </main>
  );
}
