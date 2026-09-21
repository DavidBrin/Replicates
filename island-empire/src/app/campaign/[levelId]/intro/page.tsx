import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LevelIntro } from "@/components/menu/LevelIntro";
import { LEVEL_IDS, LEVEL_META, isLevelId } from "@/content/levels/index";

interface Props {
  params: Promise<{ levelId: string }>;
}

export function generateStaticParams() {
  return LEVEL_IDS.map((levelId) => ({ levelId }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { levelId } = await params;
  if (!isLevelId(levelId)) return { title: "Level" };
  return { title: `Level ${Number(levelId)} — ${LEVEL_META[levelId].name}` };
}

export default async function LevelIntroPage({ params }: Props) {
  const { levelId } = await params;
  if (!isLevelId(levelId)) notFound();
  return <LevelIntro levelId={levelId} />;
}
