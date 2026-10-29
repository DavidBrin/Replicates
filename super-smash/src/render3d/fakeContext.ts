/**
 * The part of a canvas's WebGL context the jsdom fakes of `WebGLRenderer` must
 * model (Task 20 carry 14): `forceContextLoss()` loses it for good, and three
 * cannot build a renderer on that canvas again. In Chromium the second
 * `WebGLRenderer` throws `Cannot read properties of null (reading 'precision')`
 * (Task 20 review), so a presenter that forces the loss on dispose stops the
 * next match drawn on the same canvas — React's development remount does that.
 *
 * A fake renderer claims its canvas's context when it is built and offers
 * `forceContextLoss` the way three's does, so a presenter calling it, however
 * spelled, fails a test that builds a second one on that canvas.
 *
 * Test support only: nothing in the app imports it.
 */

/** Canvases whose context was forced lost: no renderer can be built on one again. */
const lostForGood = new WeakSet<HTMLCanvasElement>();

/** What three r186 throws building a `WebGLRenderer` on a canvas whose context is lost. */
export const LOST_CONTEXT_ERROR = "Cannot read properties of null (reading 'precision')";

/** Take `canvas`'s WebGL context for a fake renderer; throws, as three does, if it was forced lost. */
export function claimContext(canvas: HTMLCanvasElement): { forceContextLoss(): void } {
  if (lostForGood.has(canvas)) throw new TypeError(LOST_CONTEXT_ERROR);
  return { forceContextLoss: () => void lostForGood.add(canvas) };
}
