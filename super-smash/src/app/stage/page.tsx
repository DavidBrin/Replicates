import type { Metadata } from "next";

import { StageSelect } from "@/components/menu/StageSelect";

export const metadata: Metadata = { title: "Stage Select · Super Smash" };

export default function Page() {
  return <StageSelect />;
}
