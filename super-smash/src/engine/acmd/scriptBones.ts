/** Every bone an ATTACK or CATCH in these commands hangs off (loops included, `top` excluded). */

import type { AcmdCommand } from "./types";

export function scriptBoneNames(commands: readonly AcmdCommand[]): Set<string> {
  const out = new Set<string>();
  for (const c of commands) {
    if (c.op === "attack" || c.op === "catch") out.add(c.params.bone);
    else if (c.op === "loop") for (const b of scriptBoneNames(c.body)) out.add(b);
  }
  out.delete("top");
  return out;
}
