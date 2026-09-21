import type { Metadata } from "next";

import { Overworld } from "@/components/menu/Overworld";

export const metadata: Metadata = { title: "Campaign" };

export default function CampaignPage() {
  return <Overworld />;
}
