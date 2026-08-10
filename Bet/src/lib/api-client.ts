/**
 * Client-side fetch wrapper for `/api/markets/[id]/**` (Task 10's brief).
 * This is deliberately the ONLY place a browser-side component talks to
 * those routes over `fetch` — the market view's `page.tsx` itself is a
 * Server Component and reads straight through `getContainer()` (same
 * pattern Task 9's dashboard used: faster, no self-fetch round trip). This
 * module exists for the CLIENT components nested inside it — `OrderTicket`,
 * `RoomPanel`, the resolution UI — which run in the browser and have no
 * container access.
 *
 * Every response follows the app-wide envelope (G4): `{ data }` or
 * `{ error: { code, message, fields? } }`. `request()` unwraps that once,
 * here, so nothing downstream re-implements envelope handling.
 *
 * Wire types mirror the real domain entities (`@/domain/entities`) but with
 * every `Date` field widened to `string` (Next.js's JSON serialization of a
 * `NextResponse.json()` payload turns every `Date` into its ISO string) and
 * every `Credits` field widened to plain `number` (the brand is a
 * compile-time-only phantom; the wire value is already an integer number of
 * cents — callers that need a real `Credits` construct one with
 * `credits(n)` from `@/domain/money`, which is pure and safe to call from a
 * client component).
 */

import type { MarketStatus, MarketVisibility } from "@/domain/entities";

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

export interface ApiOutcome {
  id: string;
  marketId: string;
  label: string;
  description?: string;
  color: string;
}

export interface ApiResolution {
  winningOutcomeId: string;
  proposedBy: string;
  proposedAt: string;
  finalizesAt: string;
  disputedBy?: string;
  disputedAt?: string;
  votes?: Record<string, string>;
  resolvedAt?: string;
}

export interface ApiPricingConfig {
  kind: "lmsr" | "fixedOdds" | "parimutuel";
  feeBps: number;
  [key: string]: unknown;
}

export interface ApiMarket {
  id: string;
  groupId: string | null;
  creatorId: string;
  question: string;
  resolutionCriteria: string;
  resolutionSource?: string;
  closesAt: string;
  status: MarketStatus;
  visibility: MarketVisibility;
  pricing: ApiPricingConfig;
  minStake: number;
  maxStake: number;
  stakesVisible: boolean;
  outcomes: ApiOutcome[];
  createdAt: string;
  resolution?: ApiResolution;
  category?: string;
}

export interface ApiPosition {
  id: string;
  marketId: string;
  outcomeId: string;
  userId: string;
  shares: number;
  costBasis: number;
}

export interface ApiMessage {
  id: string;
  roomId: string;
  authorId: string | null;
  kind: "text" | "system";
  body: string;
  clientId?: string;
  at: string;
}

export interface ApiQuote {
  shares: number;
  cost: number;
  avgPrice: number;
  priceImpact: number;
  fee: number;
}

// ---------------------------------------------------------------------------
// Request / response shapes
// ---------------------------------------------------------------------------

export interface QuoteResponse {
  quote: ApiQuote;
  prices: Record<string, number>;
}

export interface TradeResponse {
  quote: ApiQuote;
  market: ApiMarket;
  position: ApiPosition;
}

export interface MessagesResponse {
  messages: ApiMessage[];
  nextCursor: string | null;
}

export interface PostMessageResponse {
  message: ApiMessage;
}

export interface ResolveResponse {
  market: ApiMarket;
}

export type OrderInput = {
  outcomeId: string;
  side: "buy" | "sell";
  /** Exactly one of `shares` / `budget` — mirrors `pricing/types.ts`'s
   * `Order`. `budget` is DECIMAL credits (e.g. `25` for 25.00 credits); the
   * route converts it to integer cents via `money.fromDecimal`. */
  shares?: number;
  budget?: number;
  /** Decimal credits. See `OrderTicket.tsx`'s doc comment for how this is
   * derived from a displayed quote plus a 2% tolerance. */
  maxCost?: number;
};

export type ResolveInput =
  | { action: "propose"; outcomeId: string }
  | { action: "dispute" }
  | { action: "vote"; outcomeId: string }
  | { action: "finalize" };

// ---------------------------------------------------------------------------
// Envelope + error handling
// ---------------------------------------------------------------------------

export interface ApiErrorShape {
  code: string;
  message: string;
  fields?: Record<string, string>;
}

/** Thrown by every `request()` call on a `{ error }` envelope, a network
 * failure, or an unparseable response — always with a human-readable
 * `.message` a component can show directly (never a raw stack/internal
 * detail, per G4's client-facing discipline). */
export class ApiError extends Error {
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(shape: ApiErrorShape) {
    super(shape.message);
    this.name = "ApiError";
    this.code = shape.code;
    this.fields = shape.fields;
  }
}

type Envelope<T> = { data: T } | { error: ApiErrorShape };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError({ code: "internal", message: "Couldn't reach the server. Check your connection." });
  }

  let body: Envelope<T>;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    throw new ApiError({ code: "internal", message: "The server returned an unexpected response." });
  }

  if ("error" in body) {
    throw new ApiError(body.error);
  }
  return body.data;
}

// ---------------------------------------------------------------------------
// `/api/markets/[id]` family
// ---------------------------------------------------------------------------

export function getQuote(marketId: string, order: OrderInput): Promise<QuoteResponse> {
  return request<QuoteResponse>(`/api/markets/${marketId}/quote`, {
    method: "POST",
    body: JSON.stringify(order),
  });
}

export function postTrade(marketId: string, order: OrderInput): Promise<TradeResponse> {
  return request<TradeResponse>(`/api/markets/${marketId}/trades`, {
    method: "POST",
    body: JSON.stringify(order),
  });
}

export function getMessages(
  marketId: string,
  options?: { before?: string; limit?: number },
): Promise<MessagesResponse> {
  const params = new URLSearchParams();
  if (options?.before) params.set("before", options.before);
  if (options?.limit) params.set("limit", String(options.limit));
  const qs = params.size > 0 ? `?${params.toString()}` : "";
  return request<MessagesResponse>(`/api/markets/${marketId}/messages${qs}`);
}

export function postMessage(
  marketId: string,
  body: { clientId: string; body: string },
): Promise<PostMessageResponse> {
  return request<PostMessageResponse>(`/api/markets/${marketId}/messages`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function postResolve(marketId: string, input: ResolveInput): Promise<ResolveResponse> {
  return request<ResolveResponse>(`/api/markets/${marketId}/resolve`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * Mirrors `src/app/api/markets/[id]/messages/route.ts`'s private
 * `encodeCursor` (`${at.toISOString()}|${id}`) — that route file isn't ours
 * to import from (Task 10 doesn't own `src/app/api/**`), and the format is
 * a stable, documented wire contract (an opaque `?before=` token the client
 * only ever receives from `nextCursor` and passes back verbatim), so a
 * 1-line duplicate here is safer than reaching into another task's route
 * file. Used by the market page's Server Component to compute the initial
 * `nextCursor` for its first (SSR-fetched) page of messages.
 */
export function encodeMessageCursor(at: Date, id: string): string {
  return `${at.toISOString()}|${id}`;
}
