import type { Metadata } from "next";

import { RulesPanel } from "@/components/menu/RulesPanel";
import { pageTitle } from "@/lib/brand";

export const metadata: Metadata = { title: pageTitle("Rules") };

export default function Page() {
  return <RulesPanel />;
}
