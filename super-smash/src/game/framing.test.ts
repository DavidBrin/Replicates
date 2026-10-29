import { describe, expect, it } from "vitest";

import { restEcb } from "@/engine/acmd/hurtboxes";
import { fx, toFloat } from "@/engine/fixed";
import { FIGHTERS } from "@/fighters";
import { cameraTarget, VIEW_HEIGHT } from "@/render/camera";
import { makeFighter, makeState } from "@/render/testFixtures";
import { STAGES } from "@/stages";
import { readBakeFromDisk } from "./bakeNode";

const bake = readBakeFromDisk();

/**
 * SSBU sizes (D57) make DK 26 units tall where the camera frames "a fighter"
 * as 13 (`FIGHTER_UNITS`). The frame must still hold every fighter's whole
 * standing body with room over the head — on every stage, alone in the
 * middle or two apart at the main platform's edges, where the camera is
 * zoomed in furthest and widest respectively. Measured when written: at
 * least 16.7 units of headroom everywhere, so no camera constant changed.
 */
const HEADROOM = 4;

describe("the camera frames SSBU-sized fighters (Plan 4)", () => {
  for (const stage of STAGES) {
    it(`${stage.id}: every fighter's standing body is in frame with ${HEADROOM} units over the head`, () => {
      const main = stage.platforms.find((p) => p.ledges) ?? stage.platforms[0];
      let worst = Infinity;
      for (const def of FIGHTERS) {
        const top = toFloat(restEcb(def, bake)!.top);
        for (const xs of [[0], [-0.9, 0.9]]) {
          const fighters = xs.map((k, port) => makeFighter({ port, defId: def.id, x: main.x + Math.round(toFloat(main.halfWidth) * k) * fx(1), y: main.y }));
          const cam = cameraTarget(makeState({ fighters, stageId: stage.id }), stage);
          const viewTop = cam.y + VIEW_HEIGHT / (2 * cam.zoom);
          for (const f of fighters) worst = Math.min(worst, viewTop - (toFloat(f.y) + top));
        }
      }
      expect(worst).toBeGreaterThanOrEqual(HEADROOM);
    });
  }
});
