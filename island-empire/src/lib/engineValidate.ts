import type { MapDefinition } from "@/engine/types";
import { validateMap } from "@/engine";

import { MapDefinitionSchema, issueMessages } from "./mapSchema";

/**
 * Structural check, then the engine's rules — the two halves of "is this map
 * playable", in the order that makes the errors readable.
 *
 * `validateMap` is the engine's (S1). Until its reducer lands it throws
 * "not implemented"; that is reported as a single `engine not ready` line
 * rather than treated as a pass, so the editor and the POST route can never
 * accept a map on the strength of a stub. `engineReady: false` lets a caller
 * decide whether that is fatal (the route: yes, 503) or informational (the
 * editor's validate panel).
 */
export interface MapCheck {
  /** Structural (zod) problems; empty when the shape is right. */
  shapeErrors: string[];
  /** Rule problems from `validateMap`; empty when the engine accepted it. */
  ruleErrors: string[];
  /** `false` while `validateMap` is still a stub. */
  engineReady: boolean;
  valid: boolean;
}

export function checkMap(map: MapDefinition): MapCheck {
  const parsed = MapDefinitionSchema.safeParse(map);
  const shapeErrors = parsed.success ? [] : issueMessages(parsed.error);
  if (shapeErrors.length > 0) {
    return { shapeErrors, ruleErrors: [], engineReady: true, valid: false };
  }
  try {
    const result = validateMap(map);
    return {
      shapeErrors,
      ruleErrors: result.valid ? [] : result.errors,
      engineReady: true,
      valid: result.valid,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not implemented/i.test(message)) {
      return {
        shapeErrors,
        ruleErrors: ["engine not ready: validateMap is not implemented yet"],
        engineReady: false,
        valid: false,
      };
    }
    return {
      shapeErrors,
      ruleErrors: [`validateMap threw: ${message}`],
      engineReady: true,
      valid: false,
    };
  }
}
