/**
 * The stage registry, and the two transforms that give every stage three forms.
 *
 * Ultimate ships each stage in three shapes: its **normal** layout, an **Ω
 * form** that is flat, and a **Battlefield form** with three soft platforms.
 * The important guarantee — and the reason this file is a transform rather than
 * eighteen hand-written stages — is that Ultimate makes every Ω form
 * *geometrically identical* to every other Ω form, and every Battlefield form
 * identical to every other Battlefield form. Only the artwork changes.
 *
 * So a form is a **skin wearing someone else's geometry**: keep the id lineage,
 * name, series and theme from the source stage; take platforms, blast zones and
 * spawns wholesale from the template. Doing it this way means a fix to
 * Battlefield's platform heights fixes all six Battlefield forms at once, which
 * is exactly the property the real game has.
 */

import type { StageDef } from "@/engine/types";
import { battlefield } from "./battlefield";
import { finalDestination } from "./finalDestination";
import { pokemonStadium2 } from "./pokemonStadium2";
import { smallBattlefield } from "./smallBattlefield";
import { smashville } from "./smashville";
import { townAndCity } from "./townAndCity";

export { battlefield } from "./battlefield";
export { finalDestination } from "./finalDestination";
export { pokemonStadium2 } from "./pokemonStadium2";
export { smallBattlefield } from "./smallBattlefield";
export { smashville } from "./smashville";
export { townAndCity } from "./townAndCity";

/** The six legal stages, in the order the stage select screen lists them. */
export const STAGES: readonly StageDef[] = [
  battlefield,
  finalDestination,
  smallBattlefield,
  smashville,
  townAndCity,
  pokemonStadium2,
];

const BY_ID: ReadonlyMap<string, StageDef> = new Map(STAGES.map((s) => [s.id, s]));

/** Look up a stage by id. Returns undefined for a form id — see `resolveStage`. */
export function getStage(id: string): StageDef | undefined {
  return BY_ID.get(id);
}

/** Which of a stage's three shapes is being played. */
export type StageForm = "normal" | "omega" | "battlefield";

/** The suffix a form adds to its source stage's id. */
const FORM_SUFFIX: Record<StageForm, string> = {
  normal: "",
  omega: "-omega",
  battlefield: "-battlefield",
};

/**
 * The geometry each form borrows.
 *
 * `normal` maps to `null` because a normal stage keeps its own geometry; the
 * two others point at the templates. Note that Battlefield's own Battlefield
 * form and Final Destination's own Ω form are therefore *identity* transforms,
 * which is correct and worth having fall out of the data rather than being a
 * special case in the code.
 */
const FORM_TEMPLATE: Record<StageForm, StageDef | null> = {
  normal: null,
  omega: finalDestination,
  battlefield: battlefield,
};

/**
 * Put `stage`'s skin on `template`'s geometry.
 *
 * The split is the whole point: **skin** is id lineage, name, series and theme;
 * **geometry** is platforms, blast zones and spawns. Nothing is deep-copied
 * because every one of these fields is readonly all the way down, so the forms
 * can share the template's platform array rather than each holding a private
 * duplicate that could drift.
 */
function reskin(stage: StageDef, template: StageDef, suffix: string): StageDef {
  return {
    id: stage.id + suffix,
    name: stage.name,
    series: stage.series,
    theme: stage.theme,
    platforms: template.platforms,
    blastZone: template.blastZone,
    spawns: template.spawns,
  };
}

/** `stage`'s skin on Final Destination's geometry — flat, no platforms. */
export function omegaForm(stage: StageDef): StageDef {
  return reskin(stage, finalDestination, FORM_SUFFIX.omega);
}

/** `stage`'s skin on Battlefield's geometry — three soft platforms. */
export function battlefieldForm(stage: StageDef): StageDef {
  return reskin(stage, battlefield, FORM_SUFFIX.battlefield);
}

/** Either transform, or the stage untouched, chosen by `form`. */
export function stageForm(stage: StageDef, form: StageForm): StageDef {
  const template = FORM_TEMPLATE[form];
  return template === null ? stage : reskin(stage, template, FORM_SUFFIX[form]);
}

/**
 * Resolve any id the game can hand us — a plain stage, or one of its forms.
 *
 * `GameState.stageId` is a single string that has to survive rollback and a
 * netcode round trip, so a form is encoded in the id rather than carried
 * alongside it as a second field that could disagree with the first.
 */
export function resolveStage(id: string): StageDef | undefined {
  const direct = BY_ID.get(id);
  if (direct) return direct;

  for (const form of ["omega", "battlefield"] as const) {
    const suffix = FORM_SUFFIX[form];
    if (id.endsWith(suffix)) {
      const base = BY_ID.get(id.slice(0, -suffix.length));
      if (base) return stageForm(base, form);
    }
  }
  return undefined;
}

/** Every stage in every form — what the stage select screen enumerates. */
export function allStageForms(): readonly StageDef[] {
  return STAGES.flatMap((s) => [s, battlefieldForm(s), omegaForm(s)]);
}
