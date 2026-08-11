/**
 * The wire shape of a grid.
 *
 * Claims, not blocks (DECISIONS D15). A 400x400 page is 160,000 cells but only
 * ever a few thousand purchases, so the payload scales with how much has sold
 * rather than with how big the grid is. An untouched page transfers almost
 * nothing.
 */

import type { PageKind } from "./entities";
import type { BlockRect, PageSize } from "./geometry";

/** One purchase, as the renderer needs it. No owner id, no order id, no link. */
export interface SnapshotClaim {
  readonly id: string;
  readonly rect: BlockRect;
  readonly caption: string;
  readonly colour: string;
  /** PNG data URL sized exactly to the rect, or null for a solid colour. */
  readonly tile: string | null;
  readonly ownerName: string;
  readonly createdAt: string;
}

/**
 * A block held by an in-flight order.
 *
 * Sent so the grid can show someone else's pending purchase as unavailable
 * rather than letting a buyer select blocks that will be refused at checkout.
 * Carries no identity — who is buying is nobody else's business.
 */
export interface SnapshotHold {
  readonly rect: BlockRect;
  readonly expiresAt: string;
}

export interface GridSnapshot {
  readonly slug: string;
  readonly title: string;
  readonly kind: PageKind;
  readonly size: PageSize;
  readonly wBlocks: number;
  readonly hBlocks: number;
  readonly totalBlocks: number;
  readonly soldBlocks: number;
  readonly claims: readonly SnapshotClaim[];
  readonly holds: readonly SnapshotHold[];
  /** ISO instant the snapshot was taken, so a client can order refetches. */
  readonly takenAt: string;
}
