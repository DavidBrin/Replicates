import "server-only";

/**
 * The composition root. The only file that knows which adapter is which.
 *
 * Memoised on `globalThis` rather than in a module-level `let`, because in
 * Next 16 a Server Component's module graph and a Route Handler's are bundled
 * as separate layers — a plain singleton is constructed twice and the two
 * halves of the app end up looking at different in-memory stores. The sibling
 * project `bet` found this the hard way; we inherit the fix
 * (research/persistence-and-vercel.md §4).
 */

import { cookies } from "next/headers";
import { DemoSessionAuth, resolveAuthSecret, SESSION_COOKIE } from "@/adapters/auth/demo-session";
import { createPaymentProvider } from "@/adapters/payment";
import { getStore, resetStoreForTests } from "@/adapters/store";
import { NanoIdGen, SystemClock } from "@/adapters/system";
import type { User } from "@/domain/entities";
import { AppError } from "@/domain/services/errors";
import { seedFlagship } from "@/domain/services/seed";
import type { AuthProvider, Clock, IdGen, PaymentProvider, Store } from "@/ports";

export interface Container {
  readonly store: Store;
  readonly clock: Clock;
  readonly idGen: IdGen;
  readonly auth: AuthProvider;
  readonly payments: PaymentProvider;
  readonly platformFeeBps: number;
}

const KEY = Symbol.for("dollar-pixels.container.v1");

type Global = typeof globalThis & { [KEY]?: Promise<Container> };

async function buildContainer(): Promise<Container> {
  const env = process.env;

  const clock = new SystemClock();
  const idGen = new NanoIdGen();
  const store = getStore();

  // Throws when PAYMENT_PROVIDER=stripe without keys. Deliberately fatal:
  // a deploy that silently stops charging is worse than one that will not
  // boot (DECISIONS D11).
  const payments = createPaymentProvider(env);

  const auth = new DemoSessionAuth(resolveAuthSecret(env));
  const platformFeeBps = readFeeBps(env.PLATFORM_FEE_BPS);

  await seedFlagship({ store, clock, idGen });

  return { store, clock, idGen, auth, payments, platformFeeBps };
}

export function getContainer(): Promise<Container> {
  const g = globalThis as Global;
  // Memoise the in-flight promise, not the resolved value, so two concurrent
  // first requests do not both seed the flagship page.
  g[KEY] ??= buildContainer();
  return g[KEY];
}

export function resetContainerForTests(): void {
  const g = globalThis as Global;
  delete g[KEY];
  resetStoreForTests();
}

function readFeeBps(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 10_000) {
    throw new AppError(
      "misconfigured",
      `PLATFORM_FEE_BPS must be a whole number of basis points in 0..10000, got "${raw}".`,
    );
  }
  return n;
}

/* --------------------------------------------------------------- session -- */

export type Actor = { kind: "anonymous" } | { kind: "user"; user: User };

/** Never throws. An unreadable or stale cookie is simply "not signed in". */
export async function getActor(): Promise<Actor> {
  const container = await getContainer();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return { kind: "anonymous" };

  const claims = await container.auth.verify(token);
  if (!claims) return { kind: "anonymous" };

  const user = await container.store.getUser(claims.userId);
  // A valid signature over a user that no longer exists — for the in-memory
  // store, every server restart — is anonymous, not an error.
  if (!user) return { kind: "anonymous" };

  return { kind: "user", user };
}

export async function requireUser(): Promise<User> {
  const actor = await getActor();
  if (actor.kind !== "user") {
    throw new AppError("unauthorized", "Sign in to do that.");
  }
  return actor.user;
}
