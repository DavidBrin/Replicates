"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { PlayPage } from "@/components/game/PlayPage";
import { useSessionConfig } from "@/game/sessionConfig";
import { UI } from "@/render/palette";
import { pixelText } from "@/components/game/styles";

/**
 * `/play/session` (SPEC §7, D29): random and hot-seat games, whose maps
 * live only in the client `sessionConfig` store. An empty store (cold
 * load) redirects to the title.
 */
export default function SessionPlayPage() {
  const config = useSessionConfig((s) => s.config);
  const router = useRouter();

  useEffect(() => {
    if (!config) router.replace("/");
  }, [config, router]);

  if (!config) {
    return (
      <main className="fixed inset-0 flex items-center justify-center" style={{ background: UI.sky }}>
        <p className="text-xl" style={pixelText}>
          No game configured
        </p>
      </main>
    );
  }
  return <PlayPage config={config} onQuit={() => router.push("/")} />;
}
