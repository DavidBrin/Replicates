import Link from "next/link";
import { notFound } from "next/navigation";

import { MapThumbnail } from "@/components/editor/MapThumbnail";
import { PixelText, WoodPanel } from "@/components/editor/ui";
import { resolveMap } from "@/lib/resolveMap";

import { ShareActions } from "./ShareActions";

export const dynamic = "force-dynamic";

/**
 * The custom-map share page (SPEC §5, §7): a server component that reads
 * the row through the repository — no HTTP hop — and hands the definition
 * to a client island for Play / copy / edit.
 */
export default async function MapSharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id || id.length > 64) notFound();
  const map = await resolveMap(id);
  if (!map) notFound();

  const humans = map.players.filter((p) => p.kind === "human").length;
  const biomeLabel = map.biome === "grass" ? "Grass" : map.biome === "desert" ? "Desert" : "Snow";

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 p-4" data-testid="map-share">
      <header className="flex items-center gap-3">
        <Link href="/" className="text-white underline-offset-2 hover:underline">
          <PixelText>&lt; Menu</PixelText>
        </Link>
        <PixelText as="h1" className="text-2xl md:text-3xl">
          Custom Map
        </PixelText>
      </header>

      <WoodPanel className="flex flex-col gap-4 md:flex-row md:items-start">
        <div className="shrink-0 rounded border-4 border-[#E3C798] bg-[#F1E2B2] p-1">
          <MapThumbnail map={map} size={240} testId="map-thumbnail" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <PixelText as="h2" className="truncate text-2xl">
            {map.name}
          </PixelText>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-[#F1E2B2]">Creator:</dt>
            <dd className="font-bold text-white" data-testid="map-author">
              {map.author}
            </dd>
            <dt className="text-[#F1E2B2]">ID:</dt>
            <dd className="font-bold text-white" data-testid="map-id">
              {map.id}
            </dd>
            <dt className="text-[#F1E2B2]">Size:</dt>
            <dd className="font-bold text-white">
              {map.width}×{map.height}
            </dd>
            <dt className="text-[#F1E2B2]">Players:</dt>
            <dd className="font-bold text-white">
              {map.players.length} ({humans} human, {map.players.length - humans} AI)
            </dd>
            <dt className="text-[#F1E2B2]">Biome:</dt>
            <dd className="font-bold text-white">{biomeLabel}</dd>
          </dl>
          <div className="mt-2">
            <ShareActions map={map} />
          </div>
        </div>
      </WoodPanel>
    </main>
  );
}
