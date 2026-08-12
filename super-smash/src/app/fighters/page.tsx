import type { Metadata } from "next";

import { CharacterSelect } from "@/components/menu/CharacterSelect";

export const metadata: Metadata = { title: "Character Select · Super Smash" };

export default function Page() {
  return <CharacterSelect />;
}
