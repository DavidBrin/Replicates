import type { Metadata } from "next";

import { MainMenu } from "@/components/menu/MainMenu";

export const metadata: Metadata = { title: "Main Menu · Super Smash" };

export default function Page() {
  return <MainMenu />;
}
