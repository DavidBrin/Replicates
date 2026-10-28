/**
 * The engine, in the shape `RollbackSession` asks for.
 *
 * `prevInputs` is threaded straight through: it is the parameter whose absence
 * once made every online press read as a hold (DECISIONS D25).
 */

import { hashState } from "@/engine/hash";
import { cloneState, step } from "@/engine/simulate";
import type { GameState } from "@/engine/types";
import type { RollbackDeps } from "@/net/rollback";
import { GAME_SIM_CONTEXT } from "./simContext";

export const ENGINE_ROLLBACK_DEPS: RollbackDeps<GameState> = {
  step: (state, inputs, prevInputs) => step(state, inputs, { prevInputs, ctx: GAME_SIM_CONTEXT }),
  cloneState,
  hashState,
};
