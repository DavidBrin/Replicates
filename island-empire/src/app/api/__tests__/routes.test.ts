// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { setDbForTests } from "@/adapters/db";
import { PgliteDatabase } from "@/adapters/db/pglite";
import { SCHEMA_SQL } from "@/adapters/db/schema";
import { GET as currentChallenge } from "@/app/api/challenges/current/route";
import { GET as getMap } from "@/app/api/maps/[id]/route";
import { GET as listMaps, POST as createMap } from "@/app/api/maps/route";
import { mapInput } from "@/lib/__tests__/fixtures";
import { resetReadyForTests } from "@/lib/boot";
import { resetSeededLevelsForTests } from "@/lib/seededLevels";

/**
 * The three routes against a real embedded Postgres, called as functions
 * with `Request` objects — no HTTP server, no mocks of the repository.
 *
 * The engine's `validateMap` is mocked to a structural pass: the rules are
 * S1's to test, and this suite is about the boundary (status codes, bodies,
 * ids, paging, the weekly picks) — plus the one case where the stub matters,
 * pinned below: a not-implemented engine must be a 503, never a saved map.
 */

vi.mock("@/engine", async (importActual) => {
  const actual = await importActual<typeof import("@/engine")>();
  return {
    ...actual,
    validateMap: vi.fn((map: { players: unknown[]; tiles: Array<{ building: string | null }> }) => {
      const cities = map.tiles.filter((t) => t.building === "city").length;
      return cities >= map.players.length
        ? { valid: true, errors: [] }
        : { valid: false, errors: ["every player needs a city"] };
    }),
  };
});

let dispose: () => Promise<void>;

beforeAll(async () => {
  const db = new PgliteDatabase(":memory:", SCHEMA_SQL);
  dispose = setDbForTests(db);
  resetReadyForTests();
  resetSeededLevelsForTests();
});

afterAll(async () => {
  await dispose();
  resetReadyForTests();
});

function post(body: unknown): Request {
  return new Request("http://test/api/maps", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function get(url: string): Request {
  return new Request(`http://test${url}`);
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("POST /api/maps", () => {
  it("creates a map and returns 201 { id }", async () => {
    const response = await createMap(post(mapInput({ name: "Saved" })));
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string };
    expect(body.id).toMatch(/^[A-Za-z0-9_-]{12}$/);

    const fetched = await getMap(get(`/api/maps/${body.id}`), params(body.id));
    expect(fetched.status).toBe(200);
    const map = (await fetched.json()) as { id: string; name: string; tiles: unknown[] };
    expect(map).toMatchObject({ id: body.id, name: "Saved" });
    expect(map.tiles).toHaveLength(64);
  });

  it("returns 400 for a body that is not JSON or not a map", async () => {
    const notJson = await createMap(post("{not json"));
    expect(notJson.status).toBe(400);

    const notMap = await createMap(post({ name: "x" }));
    expect(notMap.status).toBe(400);
    const body = (await notMap.json()) as { error: string; errors: string[] };
    expect(body.error).toMatch(/not a map/);
    expect(body.errors.length).toBeGreaterThan(0);

    const shortTiles = mapInput();
    shortTiles.tiles.pop();
    const wrongLength = await createMap(post(shortTiles));
    expect(wrongLength.status).toBe(400);
  });

  it("returns 422 with the engine's errors when the rules reject it", async () => {
    const input = mapInput();
    input.tiles = input.tiles.map((t) => ({ ...t, building: null }));
    const response = await createMap(post(input));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: "map failed validation",
      errors: ["every player needs a city"],
    });
  });

  it("returns 503, and saves nothing, while validateMap is a stub", async () => {
    const engine = await import("@/engine");
    const spy = vi.mocked(engine.validateMap);
    spy.mockImplementationOnce(() => {
      throw new Error("engine: validateMap is not implemented yet");
    });
    const before = ((await (await listMaps(get("/api/maps?limit=100"))).json()) as { maps: unknown[] }).maps.length;
    const response = await createMap(post(mapInput({ name: "Stubbed" })));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "engine not ready" });
    const after = ((await (await listMaps(get("/api/maps?limit=100"))).json()) as { maps: unknown[] }).maps.length;
    expect(after).toBe(before);
  });
});

describe("GET /api/maps", () => {
  it("lists summaries newest first with a cursor, covering every map exactly once", async () => {
    for (const name of ["A", "B", "C"]) {
      await createMap(post(mapInput({ name })));
    }
    // Rows saved inside one millisecond share a created_at, and the keyset
    // then orders by id — so the assertions are about paging, not about which
    // of A/B/C comes first (the repository test pins order with spaced times).
    const all = ((await (await listMaps(get("/api/maps?limit=100"))).json()) as { maps: Array<{ id: string; createdAt: string }> }).maps;
    expect(all.length).toBeGreaterThanOrEqual(4);

    const first = await listMaps(get("/api/maps?limit=2"));
    expect(first.status).toBe(200);
    const page = (await first.json()) as {
      maps: Array<{ name: string; id: string; players: number; createdAt: string }>;
      nextCursor: string | null;
    };
    expect(page.maps).toHaveLength(2);
    expect(page.maps[0]).toMatchObject({ players: 2 });
    expect(page.maps[0]).not.toHaveProperty("tiles");
    expect(page.nextCursor).toEqual(expect.any(String));
    expect(page.maps.map((m) => m.id)).toEqual(all.slice(0, 2).map((m) => m.id));

    const seen = page.maps.map((m) => m.id);
    let cursor = page.nextCursor;
    while (cursor) {
      const next = (await (await listMaps(get(`/api/maps?limit=2&cursor=${encodeURIComponent(cursor)}`))).json()) as {
        maps: Array<{ id: string; createdAt: string }>;
        nextCursor: string | null;
      };
      seen.push(...next.maps.map((m) => m.id));
      cursor = next.nextCursor;
    }
    expect(seen).toEqual(all.map((m) => m.id));
    expect(new Set(seen).size).toBe(seen.length);
    for (let i = 1; i < all.length; i += 1) {
      expect(Date.parse(all[i]!.createdAt)).toBeLessThanOrEqual(Date.parse(all[i - 1]!.createdAt));
    }
  });

  it("returns 400 for a bad limit or cursor", async () => {
    expect((await listMaps(get("/api/maps?limit=0"))).status).toBe(400);
    expect((await listMaps(get("/api/maps?limit=abc"))).status).toBe(400);
    expect((await listMaps(get("/api/maps?cursor=%%%garbage"))).status).toBe(400);
  });
});

describe("GET /api/maps/[id]", () => {
  it("404s an unknown id and an unknown seed id", async () => {
    expect((await getMap(get("/api/maps/nope"), params("nope"))).status).toBe(404);
    expect((await getMap(get("/api/maps/seed:zz"), params("seed:zz"))).status).toBe(404);
    const body = (await (await getMap(get("/api/maps/nope"), params("nope"))).json()) as { error: string };
    expect(body).toEqual({ error: "map not found" });
  });
});

describe("GET /api/challenges/current", () => {
  it("serves this week's picks from the community pool", async () => {
    const response = await currentChallenge();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      weekKey: string;
      weekStart: string;
      weekEnd: string;
      maps: Array<{ id: string }>;
    };
    expect(body.weekKey).toMatch(/^\d{4}-W\d{2}$/);
    expect(new Date(body.weekStart).getUTCDay()).toBe(1);
    expect(new Date(body.weekEnd).getTime() - new Date(body.weekStart).getTime()).toBe(7 * 86_400_000);
    // Six community maps were saved above (Saved, A, B, C — the 422/503 ones
    // were not); the seeded pool depends on whether the content slice is
    // present, so only the shape and distinctness are asserted.
    expect(body.maps.length).toBe(3);
    expect(new Set(body.maps.map((m) => m.id)).size).toBe(3);
  });

  it("is stable within the request's week", async () => {
    const a = (await (await currentChallenge()).json()) as { maps: Array<{ id: string }> };
    const b = (await (await currentChallenge()).json()) as { maps: Array<{ id: string }> };
    expect(b.maps.map((m) => m.id)).toEqual(a.maps.map((m) => m.id));
  });
});
