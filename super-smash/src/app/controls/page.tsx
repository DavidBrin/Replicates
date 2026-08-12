import type { Metadata } from "next";

import { ControlsPanel } from "@/components/menu/ControlsPanel";

export const metadata: Metadata = { title: "Controls · Super Smash" };

export default function Page() {
  return <ControlsPanel />;
}
