import type { Metadata } from "next";

import { StageSelect } from "@/components/menu/StageSelect";
import { pageTitle } from "@/lib/brand";

export const metadata: Metadata = { title: pageTitle("Stage Select") };

export default function Page() {
  return <StageSelect />;
}
