/**
 * Registers every status object with the StatusModule.
 *
 * Imported for its side effect by `simulate.ts` (and by tests that drive the
 * state machine directly). Each status group adds itself here as it migrates
 * out of the legacy switch in `states.ts`.
 */

import { DAMAGE_STATUSES } from "./damage";
import { registerStatus } from "./kind";
import type { FighterStatus } from "./kind";
import { META_STATUSES } from "./meta";

export const ALL_STATUSES: readonly FighterStatus[] = [
  ...META_STATUSES,
  ...DAMAGE_STATUSES,
];

for (const s of ALL_STATUSES) registerStatus(s);
