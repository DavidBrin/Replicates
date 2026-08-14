/**
 * Every tunable number the DAG view has, in one place.
 *
 * The team page next door writes `limit: 500` inline, and that is exactly the
 * pattern this feature should not repeat: its numbers are spread across three
 * layers — SQL bounds the walk, the layout sizes the boxes, the renderer sizes
 * the viewport — and a card that grows by ten pixels has to be able to say so
 * once. So the route reads its cap from here, the layout options come from
 * here, and neither the query nor the component invents a number of its own.
 *
 * Environment overrides are deliberately absent. These are drawing parameters,
 * not deployment parameters: a graph that lays out differently on Vercel than
 * it does locally would make every visual bug unreproducible.
 */

import {
  DEFAULT_LAYOUT_OPTIONS,
  type LayoutOptions,
} from "@/domain/services/graph-layout";

export interface DependencyGraphConfig {
  /**
   * The largest component the view will draw.
   *
   * Two hundred and forty cards is already past the point where a human reads
   * a graph rather than skims it, and the honest answer beyond it is a notice
   * saying so — not a slower page. It bounds the query too: the traversal is
   * over a component whose size nothing in the product limits, so without a cap
   * one cross-team dependency chain could make this the most expensive page in
   * the app.
   */
  readonly maxNodes: number;
  readonly layout: LayoutOptions;
  /**
   * How much of the drawing is guaranteed visible before the canvas scrolls.
   * Below this the graph is not smaller, it is panned.
   */
  readonly minViewportHeight: number;
  /** Zoom limits for the canvas controls. */
  readonly minZoom: number;
  readonly maxZoom: number;
  readonly zoomStep: number;
}

export const DEPENDENCY_GRAPH_CONFIG: DependencyGraphConfig = Object.freeze({
  maxNodes: 240,
  layout: DEFAULT_LAYOUT_OPTIONS,
  minViewportHeight: 420,
  minZoom: 0.25,
  maxZoom: 2,
  zoomStep: 0.2,
});
