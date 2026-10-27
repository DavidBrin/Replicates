import type { Metadata } from "next";

import { Results } from "@/components/menu/Results";
import { pageTitle } from "@/lib/brand";

export const metadata: Metadata = { title: pageTitle("Results") };

export default function Page() {
  return <Results />;
}
