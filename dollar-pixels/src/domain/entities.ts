/**
 * The entities, and nothing but the entities.
 *
 * Kept in one file so the storage adapters, the services and the API
 * serialisers all agree on shape without a cycle between them. Behaviour lives
 * in the sibling modules (`pricing`, `order`, `claim`, `page`).
 */

import type { BlockRect, PageSize } from "./geometry";
import type { Cents } from "./money";

/* ------------------------------------------------------------------ user -- */

export interface User {
  readonly id: string;
  /** Lowercase, unique, URL-safe. Derived from the display name at sign-in. */
  readonly handle: string;
  readonly displayName: string;
  readonly createdAt: string;
}

/* ------------------------------------------------------------------ page -- */

export const PAGE_KINDS = ["flagship", "private", "premium"] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

export function isPageKind(value: unknown): value is PageKind {
  return typeof value === "string" && (PAGE_KINDS as readonly string[]).includes(value);
}

export interface Page {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly kind: PageKind;
  readonly size: PageSize;
  /** Null on the flagship page, which belongs to the platform. */
  readonly ownerId: string | null;
  /** Free blocks the owner may claim. 69 on a private page, 0 elsewhere. */
  readonly allowanceTotal: number;
  readonly allowanceUsed: number;
  readonly createdAt: string;
}

/* ----------------------------------------------------------------- claim -- */

export interface Claim {
  readonly id: string;
  readonly pageId: string;
  readonly ownerId: string;
  readonly rect: BlockRect;
  readonly caption: string;
  /** Hex, `#rrggbb`. Drawn when there is no tile, and behind a transparent one. */
  readonly colour: string;
  /** PNG data URL sized exactly to the rect, or null for a solid colour claim. */
  readonly tile: string | null;
  readonly orderId: string;
  readonly createdAt: string;
}

/* ------------------------------------------------------------------ hold -- */

/**
 * A reservation over one rectangle while its buyer pays.
 *
 * Nothing sweeps these. A hold whose `expiresAt` has passed is treated as
 * absent by every read (DECISIONS D9).
 */
export interface Hold {
  readonly orderId: string;
  readonly pageId: string;
  readonly rect: BlockRect;
  readonly expiresAt: string;
}

/* ----------------------------------------------------------------- order -- */

export const ORDER_STATUSES = ["pending", "paid", "expired", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_KINDS = ["blocks", "page"] as const;
export type OrderKind = (typeof ORDER_KINDS)[number];

/** What a `blocks` order will create once it settles. */
export interface BlocksPayload {
  readonly kind: "blocks";
  readonly pageId: string;
  readonly rect: BlockRect;
  readonly caption: string;
  readonly colour: string;
  readonly tile: string | null;
}

/** What a `page` order will create once it settles. */
export interface PagePayload {
  readonly kind: "page";
  readonly slug: string;
  readonly title: string;
  readonly pageKind: Exclude<PageKind, "flagship">;
  readonly size: PageSize;
}

export type OrderPayload = BlocksPayload | PagePayload;

export interface Order {
  readonly id: string;
  readonly kind: OrderKind;
  /** Null for a `page` order — the page does not exist until it settles. */
  readonly pageId: string | null;
  readonly buyerId: string;
  readonly amountCents: Cents;
  readonly status: OrderStatus;
  readonly provider: string;
  /** The provider's own identifier, once it has one. */
  readonly providerRef: string | null;
  readonly payload: OrderPayload;
  readonly createdAt: string;
  readonly settledAt: string | null;
}

/* ---------------------------------------------------------------- ledger -- */

export const LEDGER_KINDS = ["block_sale", "page_sale", "platform_fee"] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

/**
 * One line of who is owed what.
 *
 * `recipientId` is null when the money belongs to the platform. Entries are
 * append-only; a correction is a new negative entry, never an edit.
 */
export interface LedgerEntry {
  readonly id: string;
  readonly orderId: string;
  readonly pageId: string | null;
  readonly recipientId: string | null;
  readonly amountCents: Cents;
  readonly kind: LedgerKind;
  readonly createdAt: string;
}

/* -------------------------------------------------------------- webhooks -- */

/** Processed provider events, so an at-least-once delivery stays idempotent. */
export interface ProcessedEvent {
  readonly id: string;
  readonly provider: string;
  readonly receivedAt: string;
}
