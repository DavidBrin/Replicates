// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { getContainer, resetContainerForTests } from "@/lib/container";
import { GET } from "@/app/api/explore/route";

beforeEach(() => {
  resetContainerForTests();
});

function exploreReq(): Request {
  return new Request("http://localhost/api/explore");
}

describe("GET /api/explore", () => {
  it("requires no auth and returns categorized public markets", async () => {
    const res = await GET(exploreReq() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data.categories)).toBe(true);
    expect(body.data.categories.length).toBeGreaterThan(0);
    expect(Array.isArray(body.data.trending)).toBe(true);
    expect(body.data.trending.length).toBeGreaterThan(0);

    const allExploreMarkets = body.data.categories.flatMap(
      (c: { markets: { market: { id: string } }[] }) => c.markets,
    );
    expect(allExploreMarkets.length).toBeGreaterThanOrEqual(20); // ~24 seeded Explore markets
    for (const entry of allExploreMarkets) {
      expect(typeof entry.market.category).toBe("string");
    }
  });

  it("never returns a private market — a known seeded private market's id never appears", async () => {
    const { store } = await getContainer();
    const group = await store.groups.findBySlug("sunday-league");
    const privateMarket = (await store.markets.listByGroup(group!.id))[0]!;
    expect(privateMarket.visibility).not.toBe("public");

    const res = await GET(exploreReq() as never);
    const body = await res.json();
    const allIds = new Set<string>(
      body.data.categories.flatMap((c: { markets: { market: { id: string } }[] }) =>
        c.markets.map((m) => m.market.id),
      ),
    );
    expect(allIds.has(privateMarket.id)).toBe(false);

    const trendingIds = new Set<string>(body.data.trending.map((e: { market: { id: string } }) => e.market.id));
    expect(trendingIds.has(privateMarket.id)).toBe(false);
  });

  it("trending is ordered by volume, descending", async () => {
    const res = await GET(exploreReq() as never);
    const body = await res.json();
    const volumes = body.data.trending.map((e: { volume: number }) => e.volume);
    for (let i = 1; i < volumes.length; i++) {
      expect(volumes[i - 1]).toBeGreaterThanOrEqual(volumes[i]);
    }
  });

  it("filters by ?category=", async () => {
    const res = await GET(new Request("http://localhost/api/explore?category=sports") as never);
    const body = await res.json();
    const allEntries: { market: { category?: string } }[] = body.data.categories.flatMap(
      (c: { markets: { market: { category?: string } }[] }) => c.markets,
    );
    expect(allEntries.length).toBeGreaterThan(0);
    for (const entry of allEntries) {
      expect(entry.market.category).toBe("sports");
    }
  });

  // G4: `?category=` used to be read straight off `searchParams` — the last
  // unparsed input in src/app/api/**.
  it("rejects an over-long ?category= with a 400 validation envelope", async () => {
    const tooLong = "x".repeat(41);
    const res = await GET(
      new Request(`http://localhost/api/explore?category=${tooLong}`) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation");
    expect(body.error.fields.category).toBeTruthy();
  });

  it("treats an empty ?category= as no filter rather than an error", async () => {
    const res = await GET(new Request("http://localhost/api/explore?category=") as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.categories.length).toBeGreaterThan(1);
  });
});
