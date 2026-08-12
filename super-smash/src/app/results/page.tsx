import type { Metadata } from "next";

import { Results } from "@/components/menu/Results";

export const metadata: Metadata = { title: "Results · Super Smash" };

export default function Page() {
  return <Results />;
}
