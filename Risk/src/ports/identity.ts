// Published verbatim from SPEC §4.16 as the cross-slice contract. S4 owns this file.
import type { PlayerColour } from "@/engine/types";

// src/ports/identity.ts
export interface Identity { playerId: string; displayName: string; colour: PlayerColour }
export interface IdentityPort { readCached(): Pick<Identity, "displayName" | "colour"> | null;
  claim(displayName: string): Promise<Identity>;      // POST /api/session
  setColour(colour: PlayerColour): Promise<Identity>; // PATCH /api/session
  leave(): Promise<void> }                            // DELETE /api/session
