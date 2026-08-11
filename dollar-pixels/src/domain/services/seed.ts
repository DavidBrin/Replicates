/**
 * The flagship page, and enough sold blocks that it does not look abandoned.
 *
 * An empty 400x400 grid is a grey square, and a grey square does not show
 * anyone what the product is. The seed lays down a few hundred claims so the
 * wall reads as a wall on first load.
 *
 * Deterministic on purpose: the same grid every boot means a screenshot is
 * reproducible and an e2e test can assert against a known coordinate. All of
 * it is invented — the captions are generic, and no real brand or person
 * appears anywhere in it.
 */

import type { Claim, Page, User } from "@/domain/entities";
import {
  blocksIn,
  eachBlock,
  gridForSize,
  type BlockRect,
} from "@/domain/geometry";
import type { Clock, IdGen, Store } from "@/ports";
import { FLAGSHIP_SLUG } from "./pages";

const SEED_USER_ID = "usr_seed";
const SEED_EPOCH = "2026-01-01T00:00:00.000Z";

/**
 * How many claims the wall starts with.
 *
 * Tuned by looking at it. At 260 the grid was about a tenth sold and read as an
 * empty checkerboard with confetti on it — which is not what the thing being
 * replicated looked like, and not what a visitor needs to see to understand
 * that blocks are bought in clusters. Around a third sold is where it starts
 * reading as a wall.
 */
const SEED_CLAIMS = 900;

/** Invented tenants. Generic trades, no real names. */
const TENANTS: readonly { caption: string; colour: string }[] = [
  { caption: "Harbour Lights Coffee", colour: "#6b3f2a" },
  { caption: "Third Avenue Bicycles", colour: "#1f9d2f" },
  { caption: "The Paper Lantern", colour: "#c0182b" },
  { caption: "Molehill Records", colour: "#1b1b1b" },
  { caption: "Cold Spring Swim Club", colour: "#0a7cff" },
  { caption: "Ferris & Daughters, Ironmongers", colour: "#7a7a7a" },
  { caption: "Quiet Hours Bookshop", colour: "#7b2d8b" },
  { caption: "Ninepin Bowling", colour: "#d9ab22" },
  { caption: "Saltmarsh Kayak Hire", colour: "#0f766e" },
  { caption: "The Long Way Round Travel", colour: "#e2761b" },
  { caption: "Pewter Street Barbers", colour: "#000099" },
  { caption: "Greenhouse Gardening", colour: "#4d7c0f" },
  { caption: "Anvil Fitness", colour: "#57534e" },
  { caption: "Marigold Flowers", colour: "#eab308" },
  { caption: "Bell & Whistle Hardware", colour: "#b91c1c" },
  { caption: "Little Owl Nursery", colour: "#a16207" },
  { caption: "Chapter House Print", colour: "#334155" },
  { caption: "Nightjar Brewing", colour: "#7c2d12" },
  { caption: "Two Rivers Fishing", colour: "#0369a1" },
  { caption: "Copper Kettle Kitchens", colour: "#a45309" },
];

/**
 * A small deterministic generator.
 *
 * `Math.random()` would make the wall different on every boot and every
 * screenshot; a fixed 32-bit LCG gives the same layout forever without pulling
 * in a dependency.
 */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/**
 * Lay out non-overlapping rectangles.
 *
 * Rejection sampling against a set of taken blocks. Crude, but it runs once at
 * boot over a few hundred rectangles and any smarter packing would be a worse
 * trade — this is scaffolding, not a feature.
 */
function planClaims(
  dims: { wBlocks: number; hBlocks: number },
  count: number,
): { rect: BlockRect; tenant: (typeof TENANTS)[number] }[] {
  const rand = lcg(0x9e3779b9);
  const taken = new Set<number>();
  const out: { rect: BlockRect; tenant: (typeof TENANTS)[number] }[] = [];

  const pick = (n: number) => Math.floor(rand() * n);

  // A real wall is mostly small ads with a few big ones. Weight accordingly.
  const sizes: [number, number][] = [
    [4, 4], [4, 4], [6, 4], [8, 6], [10, 6],
    [12, 8], [6, 6], [5, 3], [16, 10], [20, 12],
    [3, 3], [8, 8], [14, 6], [7, 5], [24, 16],
  ];

  let attempts = 0;
  while (out.length < count && attempts < count * 60) {
    attempts++;
    const [bw, bh] = sizes[pick(sizes.length)];
    const bx = pick(dims.wBlocks - bw);
    const by = pick(dims.hBlocks - bh);
    const rect: BlockRect = { bx, by, bw, bh };

    let clash = false;
    for (const { bx: x, by: y } of eachBlock(rect)) {
      if (taken.has(y * dims.wBlocks + x)) {
        clash = true;
        break;
      }
    }
    if (clash) continue;

    for (const { bx: x, by: y } of eachBlock(rect)) {
      taken.add(y * dims.wBlocks + x);
    }
    out.push({ rect, tenant: TENANTS[out.length % TENANTS.length] });
  }

  return out;
}

export interface SeedDeps {
  readonly store: Store;
  readonly clock: Clock;
  readonly idGen: IdGen;
}

/**
 * Create the flagship page if it is not already there.
 *
 * Idempotent, and cheap to call on every container build: the existence check
 * is one read and everything after it is skipped.
 */
export async function seedFlagship(deps: SeedDeps): Promise<Page> {
  const existing = await deps.store.getPageBySlug(FLAGSHIP_SLUG);
  if (existing) return existing;

  const seedUser: User = {
    id: SEED_USER_ID,
    handle: "the-wall",
    displayName: "Early tenants",
    createdAt: SEED_EPOCH,
  };
  if (!(await deps.store.getUser(SEED_USER_ID))) {
    await deps.store.createUser(seedUser);
  }

  const page: Page = {
    id: "pag_wall",
    slug: FLAGSHIP_SLUG,
    title: "The Wall",
    kind: "flagship",
    size: "full",
    ownerId: null,
    allowanceTotal: 0,
    allowanceUsed: 0,
    createdAt: SEED_EPOCH,
  };
  const created = await deps.store.createPage(page);

  const dims = gridForSize(created.size);
  const planned = planClaims(dims, SEED_CLAIMS);
  const expiry = new Date(Date.parse(SEED_EPOCH) + 60_000);
  const asOf = new Date(SEED_EPOCH);

  let n = 0;
  for (const { rect, tenant } of planned) {
    n++;
    const orderId = `ord_seed_${n}`;
    // Seeded claims still go through reserve-then-claim rather than being
    // written straight in, so the seed exercises the same invariants a real
    // purchase does. A seed that bypassed them could hide a broken store.
    const reserved = await deps.store.reserveBlocks(
      created.id,
      rect,
      orderId,
      expiry,
      asOf,
    );
    if (!reserved) continue;

    const claim: Claim = {
      id: `clm_seed_${n}`,
      pageId: created.id,
      ownerId: SEED_USER_ID,
      rect,
      caption: tenant.caption,
      colour: tenant.colour,
      tile: null,
      orderId,
      createdAt: SEED_EPOCH,
    };
    await deps.store.claimBlocks(claim, asOf);
  }

  return created;
}

/** Blocks the seed occupies, for tests that assert on the starting state. */
export function seededBlockCount(): number {
  return planClaims(gridForSize("full"), SEED_CLAIMS).reduce(
    (sum, { rect }) => sum + blocksIn(rect),
    0,
  );
}
