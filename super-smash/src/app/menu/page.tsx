import type { Metadata } from "next";

import { MainMenu } from "@/components/menu/MainMenu";
import { pageTitle } from "@/lib/brand";

export const metadata: Metadata = { title: pageTitle("Main Menu") };

export default function Page() {
  return <MainMenu />;
}
