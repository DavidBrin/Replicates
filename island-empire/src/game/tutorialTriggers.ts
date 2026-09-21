import type { TutorialTriggerId } from "@/engine/types";

/**
 * When the game runner (S2) fires each tutorial trigger. Content (S3) scripts
 * against exactly this list; the type in `engine/types.ts` is the source of
 * truth and this table documents the moment each fires. A trigger fires at
 * most once per game unless noted.
 */
export const TUTORIAL_TRIGGERS: Record<TutorialTriggerId, string> = {
  levelIntro: "Before the first turn begins, over the board.",
  "turnStart:1": "When the human's turn 1 begins (after the Next day banner).",
  "turnStart:2": "When the human's turn 2 begins.",
  "turnStart:3": "When the human's turn 3 begins.",
  "turnStart:5": "When the human's turn 5 begins.",
  "unitSelected:first": "The first time the human selects one of their units.",
  "unitMoved:first": "The first time a human unit repositions inside its province.",
  "captured:first": "The first time the human captures any tile.",
  "attackBlocked:defence":
    "The human taps an enemy tile their selected unit cannot beat (defended by a unit or city).",
  "attackBlocked:wall": "The human taps a wall/tower tile their selected unit cannot beat.",
  notEnoughGold: "The human taps a shop card they cannot afford (fires every time).",
  "bought:first": "The first time the human buys a knight.",
  "bought:woodwall": "The first time the human buys a woodwall.",
  "bought:farm": "The first time the human buys a farm.",
  "merged:first": "The first time two human units merge.",
  "fieldCleared:first": "The first time the human clears a grass field or grave.",
  enemyCityCaptured: "The human captures any enemy city.",
  victory: "The human wins the level (before the victory modal).",
  defeat: "The human is eliminated (before the defeat modal).",
};

export const TUTORIAL_TRIGGER_IDS = Object.keys(TUTORIAL_TRIGGERS) as TutorialTriggerId[];
