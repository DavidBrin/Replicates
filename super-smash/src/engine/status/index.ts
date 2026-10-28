/**
 * Registers every status object with the StatusModule.
 *
 * Imported for its side effect by `simulate.ts` (and by tests that drive the
 * state machine directly). Every action's status is here, one per group file;
 * `advanceFighter` throws for an action with none.
 */

import { AIR_STATUSES } from "./air";
import { ATTACK_STATUSES } from "./attack";
import { CLIFF_STATUSES } from "./cliff";
import { DAMAGE_STATUSES } from "./damage";
import { GROUND_STATUSES } from "./ground";
import { GUARD_STATUSES } from "./guard";
import { registerStatus } from "./kind";
import type { FighterStatus } from "./kind";
import { META_STATUSES } from "./meta";
import { PASSIVE_STATUSES } from "./passive";

export const ALL_STATUSES: readonly FighterStatus[] = [
  ...META_STATUSES,
  ...DAMAGE_STATUSES,
  ...GUARD_STATUSES,
  ...ATTACK_STATUSES,
  ...CLIFF_STATUSES,
  ...GROUND_STATUSES,
  ...AIR_STATUSES,
  ...PASSIVE_STATUSES,
];

for (const s of ALL_STATUSES) registerStatus(s);
