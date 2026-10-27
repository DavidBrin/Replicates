import type { Metadata } from "next";

import { ControlsPanel } from "@/components/menu/ControlsPanel";
import { pageTitle } from "@/lib/brand";

export const metadata: Metadata = { title: pageTitle("Controls") };

export default function Page() {
  return <ControlsPanel />;
}
