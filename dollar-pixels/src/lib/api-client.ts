"use client";

/**
 * The browser's side of the envelope.
 *
 * Every route answers `{ok:true,data}` or `{ok:false,error}`, so unwrapping it
 * once here means no component ever writes `if (json.ok)`. A failed request
 * throws an `ApiError` carrying the server's own message, which is already
 * written for a person to read.
 */

import type { GridSnapshot } from "@/domain/snapshot";
import type { BlockRect } from "@/domain/geometry";
import type { PageKind, User } from "@/domain/entities";
import type { PageSize } from "@/domain/geometry";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError("internal", `Server returned ${res.status}.`, res.status);
  }

  if (
    typeof body === "object" &&
    body !== null &&
    "ok" in body &&
    (body as { ok: unknown }).ok === true &&
    "data" in body
  ) {
    return (body as { data: T }).data;
  }

  const error =
    typeof body === "object" && body !== null && "error" in body
      ? (body as { error: { code?: unknown; message?: unknown } }).error
      : null;

  throw new ApiError(
    typeof error?.code === "string" ? error.code : "internal",
    typeof error?.message === "string" ? error.message : "Something went wrong.",
    res.status,
  );
}

/* ------------------------------------------------------------------ types -- */

export interface MeResponse {
  user: User | null;
  payments: { id: string; label: string; live: boolean };
}

export interface PageMeta {
  slug: string;
  title: string;
  kind: PageKind;
  size: PageSize;
  wBlocks: number;
  hBlocks: number;
  totalBlocks: number;
  soldBlocks: number;
  availableBlocks: number;
  ownerName: string | null;
  createdAt: string;
  allowance: { total: number; used: number } | null;
  isOwner: boolean;
}

export interface DirectoryRow {
  slug: string;
  title: string;
  kind: PageKind;
  size: PageSize;
  createdAt: string;
  soldBlocks: number;
  ownerName: string | null;
}

export interface CheckoutStarted {
  orderId: string;
  amountCents: number;
  redirectUrl: string;
  holdMinutes?: number;
}

export interface OrderView {
  id: string;
  kind: "blocks" | "page";
  status: "pending" | "paid" | "expired" | "cancelled";
  amountCents: number;
  createdAt: string;
  settledAt: string | null;
  pageSlug: string | null;
}

export interface DashboardView {
  user: User;
  pages: {
    slug: string;
    title: string;
    kind: PageKind;
    size: PageSize;
    soldBlocks: number;
    allowanceTotal: number;
    allowanceUsed: number;
  }[];
  claims: {
    id: string;
    pageSlug: string | null;
    rect: BlockRect;
    caption: string;
    colour: string;
    createdAt: string;
  }[];
  earnings: {
    balanceCents: number;
    entries: { id: string; amountCents: number; kind: string; createdAt: string }[];
  };
  orders: {
    id: string;
    kind: string;
    status: string;
    amountCents: number;
    createdAt: string;
  }[];
}

export interface ClaimBody {
  rect: BlockRect;
  caption: string;
  colour: string;
  tile: string | null;
}

/* -------------------------------------------------------------------- api -- */

export const api = {
  me: () => request<MeResponse>("/api/me"),

  signIn: (displayName: string) =>
    request<{ user: User }>("/api/session", {
      method: "POST",
      body: JSON.stringify({ displayName }),
    }),

  signOut: () => request<{ signedOut: boolean }>("/api/session", { method: "DELETE" }),

  directory: () => request<{ pages: DirectoryRow[] }>("/api/pages"),

  page: (slug: string) => request<PageMeta>(`/api/pages/${encodeURIComponent(slug)}`),

  grid: (slug: string) =>
    request<GridSnapshot>(`/api/pages/${encodeURIComponent(slug)}/grid`),

  buyBlocks: (slug: string, body: ClaimBody) =>
    request<CheckoutStarted>(`/api/pages/${encodeURIComponent(slug)}/checkout`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  claimFree: (slug: string, body: ClaimBody) =>
    request<{ orderId: string; claimId: string | null }>(
      `/api/pages/${encodeURIComponent(slug)}/claim-free`,
      { method: "POST", body: JSON.stringify(body) },
    ),

  createPage: (body: {
    slug: string;
    title: string;
    kind: "private" | "premium";
    size: PageSize;
  }) =>
    request<CheckoutStarted & { quotedCents: number }>("/api/pages", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  checkSlug: (slug: string) =>
    request<{ available: boolean; reason: string | null }>(
      `/api/slug-check?slug=${encodeURIComponent(slug)}`,
    ),

  order: (id: string) => request<OrderView>(`/api/orders/${encodeURIComponent(id)}`),

  mockSettle: (id: string, outcome: "paid" | "declined" | "cancelled") =>
    request<{ status: string; claimId: string | null; pageSlug: string | null }>(
      `/api/orders/${encodeURIComponent(id)}/mock-settle`,
      { method: "POST", body: JSON.stringify({ outcome }) },
    ),

  dashboard: () => request<DashboardView>("/api/dashboard"),
};
