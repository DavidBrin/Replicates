import type { Metadata } from "next";

import { OnlineLobby } from "@/components/online/OnlineLobby";
import { pageTitle } from "@/lib/brand";

export const metadata: Metadata = { title: pageTitle("Online") };

export default function Page() {
  return <OnlineLobby />;
}
