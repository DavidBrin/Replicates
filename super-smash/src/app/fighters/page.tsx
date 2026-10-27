import type { Metadata } from "next";

import { CharacterSelect } from "@/components/menu/CharacterSelect";
import { pageTitle } from "@/lib/brand";

export const metadata: Metadata = { title: pageTitle("Character Select") };

export default function Page() {
  return <CharacterSelect />;
}
