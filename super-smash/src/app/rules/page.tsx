import type { Metadata } from "next";

import { RulesPanel } from "@/components/menu/RulesPanel";

export const metadata: Metadata = { title: "Rules · Super Smash" };

export default function Page() {
  return <RulesPanel />;
}
