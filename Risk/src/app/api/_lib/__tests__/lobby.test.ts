// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LOBBY_CODE_ALPHABET, newLobbyCode } from "@/adapters/db/repositories/ids";

import { packBrowseVersion } from "../lobbyService";
import type { LobbyRoom } from "../lobbyService";
import {
  createLobby,
  joinLobby,
  mustClaim,
  readyUp,
  req,
  routes,
  startGame,
  startHarness,
  TEST_RULES,
  type Harness,
} from "./harness";

/**
 * POLL 1, POLL 2 and the lobby transitions (SPEC §6, §7's lobby rows).
 */

let harness: Harness;

beforeEach(async () => {
  harness = await startHarness();
});

afterEach(async () => {
  await harness.dispose();
});

async function room(code: string, cookie: string, since = 0): Promise<LobbyRoom> {
  const response = await routes.pollRoom(
    code,
    req(`/api/lobbies/${code}?since=${since}`, { cookie }),
  );
  if (response.status !== 200) throw new Error(`pollRoom: ${response.status}`);
  return (await response.json()) as LobbyRoom;
}

describe("lobby codes", () => {
  it("are four letters from a 24-letter alphabet without I or O", () => {
    expect(LOBBY_CODE_ALPHABET).not.toContain("I");
    expect(LOBBY_CODE_ALPHABET).not.toContain("O");
    expect(LOBBY_CODE_ALPHABET).toHaveLength(24);
    for (let i = 0; i < 200; i += 1) {
      const code = newLobbyCode();
      expect(code, code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);
    }
  });

  it("draw every letter of the alphabet over enough samples", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 4000; i += 1) for (const letter of newLobbyCode()) seen.add(letter);
    expect(seen.size).toBe(24);
  });
});

describe("the browse cursor", () => {
  it("changes when any one of its three parts changes", () => {
    const base = packBrowseVersion(10, 5, 3);
    expect(packBrowseVersion(11, 5, 3)).not.toBe(base);
    expect(packBrowseVersion(10, 6, 3)).not.toBe(base);
    expect(packBrowseVersion(10, 5, 4)).not.toBe(base);
    expect(packBrowseVersion(10, 5, 3)).toBe(base);
  });

  it("stays an exact integer at the top of each field", () => {
    const packed = packBrowseVersion(2 ** 26 - 1, 2 ** 13 - 1, 2 ** 13 - 1);
    expect(Number.isSafeInteger(packed)).toBe(true);
  });
});

describe("POST /api/lobbies", () => {
  it("creates a lobby, seats the host at 0, and opens the rest", async () => {
    const host = await mustClaim("Napoleon");
    const code = await createLobby(host, { maxSeats: 4 });
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/);

    const body = await room(code, host.cookie);
    expect(body.seats).toHaveLength(4);
    expect(body.seats[0]).toMatchObject({ seat: 0, kind: "human", playerId: host.playerId });
    expect(body.seats.slice(1).every((seat) => seat.kind === "open")).toBe(true);
    expect(body.hostId).toBe(host.playerId);
    expect(body.status).toBe("open");
  });

  it("answers 409 when the player is already hosting", async () => {
    const host = await mustClaim("Napoleon");
    const first = await createLobby(host);
    const response = await routes.createLobby(
      req("/api/lobbies", {
        method: "POST",
        cookie: host.cookie,
        body: { title: "Second", mapSlug: "tiny4", rules: TEST_RULES, maxSeats: 2 },
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "alreadyHosting", code: first });
  });

  it("answers 401 without a cookie and 400 on a bad body", async () => {
    expect(
      (
        await routes.createLobby(
          req("/api/lobbies", { method: "POST", body: { title: "x", mapSlug: "tiny4", maxSeats: 2 } }),
        )
      ).status,
    ).toBe(401);

    const host = await mustClaim("Napoleon");
    expect(
      (
        await routes.createLobby(
          req("/api/lobbies", {
            method: "POST",
            cookie: host.cookie,
            body: { title: "", mapSlug: "tiny4", rules: TEST_RULES, maxSeats: 2 },
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await routes.createLobby(
          req("/api/lobbies", {
            method: "POST",
            cookie: host.cookie,
            body: { title: "ok", mapSlug: "tiny4", rules: TEST_RULES, maxSeats: 9 },
          }),
        )
      ).status,
    ).toBe(400);
  });

  it("refuses a turn timer that is not one of the five offered values", async () => {
    const host = await mustClaim("Napoleon");
    const response = await routes.createLobby(
      req("/api/lobbies", {
        method: "POST",
        cookie: host.cookie,
        body: {
          title: "ok",
          mapSlug: "tiny4",
          rules: { ...TEST_RULES, turnSeconds: 45 },
          maxSeats: 2,
        },
      }),
    );
    expect(response.status).toBe(400);
  });
});

describe("GET /api/lobby (POLL 1)", () => {
  it("returns online players, open lobbies, chat and you, in one invocation", async () => {
    const host = await mustClaim("Napoleon");
    const code = await createLobby(host, { title: "Austerlitz" });

    const response = await routes.pollLobby(req("/api/lobby?since=0", { cookie: host.cookie }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      version: number;
      players: { displayName: string; online: boolean }[];
      lobbies: { code: string; title: string; hostName: string; seatsTaken: number }[];
      chat: unknown[];
      you: { playerId: string };
    };
    expect(body.players.map((player) => player.displayName)).toContain("Napoleon");
    expect(body.players[0]?.online).toBe(true);
    expect(body.lobbies).toHaveLength(1);
    expect(body.lobbies[0]).toMatchObject({
      code,
      title: "Austerlitz",
      hostName: "Napoleon",
      seatsTaken: 1,
    });
    expect(body.you.playerId).toBe(host.playerId);
    expect(response.headers.get("etag")).toBe(`W/"${body.version}"`);
  });

  it("answers 204 with no body when the version has not moved", async () => {
    const host = await mustClaim("Napoleon");
    await createLobby(host);
    const first = (await (
      await routes.pollLobby(req("/api/lobby?since=0", { cookie: host.cookie }))
    ).json()) as { version: number };

    const second = await routes.pollLobby(
      req(`/api/lobby?since=${first.version}`, { cookie: host.cookie }),
    );
    expect(second.status).toBe(204);
    expect(await second.text()).toBe("");
  });

  it("stamps the caller's heartbeat on the same request", async () => {
    const host = await mustClaim("Napoleon");
    await harness.db.execute(
      "update players set last_seen_at = now() - interval '10 minutes' where id = $1",
      [host.playerId],
    );
    await routes.pollLobby(req("/api/lobby?since=0", { cookie: host.cookie }));
    const rows = await harness.db.query<{ fresh: boolean }>(
      "select last_seen_at > now() - interval '5 seconds' as fresh from players where id = $1",
      [host.playerId],
    );
    expect(rows[0]?.fresh).toBe(true);
  });

  it("answers 401 without a cookie", async () => {
    expect((await routes.pollLobby(req("/api/lobby?since=0"))).status).toBe(401);
  });
});

describe("join / leave / ready", () => {
  it("takes the lowest open seat, and bumps the version", async () => {
    const host = await mustClaim("Napoleon");
    const guest = await mustClaim("Wellington");
    const code = await createLobby(host, { maxSeats: 3 });
    const before = await room(code, host.cookie);

    const response = await joinLobby(guest, code);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { seat: number; version: number; seats: unknown[] };
    expect(body.seat).toBe(1);
    expect(body.version).toBeGreaterThan(before.version);
  });

  it("takes a named seat, and refuses one that is occupied", async () => {
    const host = await mustClaim("Napoleon");
    const guest = await mustClaim("Wellington");
    const third = await mustClaim("Blucher");
    const code = await createLobby(host, { maxSeats: 3 });

    expect((await joinLobby(guest, code, 2)).status).toBe(200);
    const clash = await joinLobby(third, code, 2);
    expect(clash.status).toBe(409);
    expect(await clash.json()).toMatchObject({ error: "seatTaken" });
  });

  it("refuses a second join from the same player, and tells them their seat", async () => {
    const host = await mustClaim("Napoleon");
    const guest = await mustClaim("Wellington");
    const code = await createLobby(host, { maxSeats: 3 });
    await joinLobby(guest, code);

    const again = await joinLobby(guest, code);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: "alreadySeated", seat: 1 });
  });

  it("answers lobbyFull when every seat is taken", async () => {
    const host = await mustClaim("Napoleon");
    const guest = await mustClaim("Wellington");
    const third = await mustClaim("Blucher");
    const code = await createLobby(host, { maxSeats: 2 });
    await joinLobby(guest, code);

    const full = await joinLobby(third, code);
    expect(full.status).toBe(409);
    expect(await full.json()).toMatchObject({ error: "lobbyFull" });
  });

  it("lets a seated player set their own ready flag", async () => {
    const host = await mustClaim("Napoleon");
    const guest = await mustClaim("Wellington");
    const code = await createLobby(host, { maxSeats: 2 });
    await joinLobby(guest, code);

    const response = await readyUp(guest, code);
    expect(response.status).toBe(200);
    const body = (await response.json()) as LobbyRoom;
    expect(body.seats[1]?.ready).toBe(true);
    expect(body.seats[0]?.ready).toBe(false);
  });

  it("refuses a ready flag from somebody not seated", async () => {
    const host = await mustClaim("Napoleon");
    const outsider = await mustClaim("Wellington");
    const code = await createLobby(host, { maxSeats: 2 });
    expect((await readyUp(outsider, code)).status).toBe(404);
  });

  it("hands the host to the next human when the host leaves", async () => {
    const host = await mustClaim("Napoleon");
    const guest = await mustClaim("Wellington");
    const code = await createLobby(host, { maxSeats: 3 });
    await joinLobby(guest, code);

    const response = await routes.leave(
      code,
      req(`/api/lobbies/${code}/leave`, { method: "POST", cookie: host.cookie }),
    );
    expect(response.status).toBe(204);

    const body = await room(code, guest.cookie);
    expect(body.hostId).toBe(guest.playerId);
    expect(body.seats[0]?.kind).toBe("open");
    expect(body.status).toBe("open");
  });

  it("closes the lobby when the last human leaves", async () => {
    const host = await mustClaim("Napoleon");
    const code = await createLobby(host, { maxSeats: 2 });
    await routes.leave(
      code,
      req(`/api/lobbies/${code}/leave`, { method: "POST", cookie: host.cookie }),
    );
    const body = await room(code, host.cookie);
    expect(body.status).toBe("closed");
  });

  it("is idempotent: leaving twice is still 204", async () => {
    const host = await mustClaim("Napoleon");
    const guest = await mustClaim("Wellington");
    const code = await createLobby(host, { maxSeats: 3 });
    await joinLobby(guest, code);
    const request = () =>
      routes.leave(code, req(`/api/lobbies/${code}/leave`, { method: "POST", cookie: guest.cookie }));
    expect((await request()).status).toBe(204);
    expect((await request()).status).toBe(204);
  });
});

describe("PATCH /api/lobbies/:code", () => {
  it("lets the host change title, map and rules", async () => {
    const host = await mustClaim("Napoleon");
    const code = await createLobby(host);
    const response = await routes.patchRoom(
      code,
      req(`/api/lobbies/${code}`, {
        method: "PATCH",
        cookie: host.cookie,
        body: {
          title: "Waterloo",
          mapSlug: "tiny4",
          rules: { ...TEST_RULES, fogOfWar: true, turnSeconds: 120 },
        },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as LobbyRoom;
    expect(body.title).toBe("Waterloo");
    expect(body.rules.fogOfWar).toBe(true);
    expect(body.rules.turnSeconds).toBe(120);
  });

  it("adds and removes a bot seat", async () => {
    const host = await mustClaim("Napoleon");
    const code = await createLobby(host, { maxSeats: 3 });

    const added = (await (
      await routes.patchRoom(
        code,
        req(`/api/lobbies/${code}`, {
          method: "PATCH",
          cookie: host.cookie,
          body: { seats: [{ seat: 1, kind: "bot", tier: "hard" }] },
        }),
      )
    ).json()) as LobbyRoom;
    expect(added.seats[1]).toMatchObject({ kind: "bot", tier: "hard", ready: true });

    const removed = (await (
      await routes.patchRoom(
        code,
        req(`/api/lobbies/${code}`, {
          method: "PATCH",
          cookie: host.cookie,
          body: { seats: [{ seat: 1, kind: "open" }] },
        }),
      )
    ).json()) as LobbyRoom;
    expect(removed.seats[1]).toMatchObject({ kind: "open", tier: null });
  });

  it("kicks a guest but refuses to open the host's own seat", async () => {
    const host = await mustClaim("Napoleon");
    const guest = await mustClaim("Wellington");
    const code = await createLobby(host, { maxSeats: 3 });
    await joinLobby(guest, code);

    const body = (await (
      await routes.patchRoom(
        code,
        req(`/api/lobbies/${code}`, {
          method: "PATCH",
          cookie: host.cookie,
          body: { seats: [{ seat: 1, kind: "open" }, { seat: 0, kind: "open" }] },
        }),
      )
    ).json()) as LobbyRoom;
    expect(body.seats[1]?.kind).toBe("open");
    expect(body.seats[0]).toMatchObject({ kind: "human", playerId: host.playerId });
  });

  it("answers 403 for a guest and 404 for an unknown code", async () => {
    const host = await mustClaim("Napoleon");
    const guest = await mustClaim("Wellington");
    const code = await createLobby(host, { maxSeats: 3 });
    await joinLobby(guest, code);

    expect(
      (
        await routes.patchRoom(
          code,
          req(`/api/lobbies/${code}`, {
            method: "PATCH",
            cookie: guest.cookie,
            body: { title: "Mine now" },
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await routes.patchRoom(
          "ZZZZ",
          req("/api/lobbies/ZZZZ", {
            method: "PATCH",
            cookie: host.cookie,
            body: { title: "x" },
          }),
        )
      ).status,
    ).toBe(404);
  });
});

describe("GET /api/lobbies/:code (POLL 2)", () => {
  it("answers 204 when the version has not moved, and 200 when it has", async () => {
    const host = await mustClaim("Napoleon");
    const guest = await mustClaim("Wellington");
    const code = await createLobby(host, { maxSeats: 2 });
    const first = await room(code, host.cookie);

    const unchanged = await routes.pollRoom(
      code,
      req(`/api/lobbies/${code}?since=${first.version}`, { cookie: host.cookie }),
    );
    expect(unchanged.status).toBe(204);
    expect(await unchanged.text()).toBe("");
    expect(unchanged.headers.get("etag")).toBe(`W/"${first.version}"`);

    await joinLobby(guest, code);
    const changed = await routes.pollRoom(
      code,
      req(`/api/lobbies/${code}?since=${first.version}`, { cookie: host.cookie }),
    );
    expect(changed.status).toBe(200);
  });

  it("404s an unknown and a malformed code", async () => {
    const host = await mustClaim("Napoleon");
    expect(
      (await routes.pollRoom("ZZZZ", req("/api/lobbies/ZZZZ", { cookie: host.cookie }))).status,
    ).toBe(404);
    expect(
      (await routes.pollRoom("nope", req("/api/lobbies/nope", { cookie: host.cookie }))).status,
    ).toBe(404);
  });

  it("reports a seat's liveness from the occupant's heartbeat", async () => {
    const host = await mustClaim("Napoleon");
    const guest = await mustClaim("Wellington");
    const code = await createLobby(host, { maxSeats: 2 });
    await joinLobby(guest, code);
    await harness.db.execute(
      "update players set last_seen_at = now() - interval '2 minutes' where id = $1",
      [guest.playerId],
    );

    const body = await room(code, host.cookie);
    expect(body.seats[0]?.online).toBe(true);
    expect(body.seats[1]?.online).toBe(false);
  });
});

describe("POST /api/lobbies/:code/start", () => {
  it("refuses one occupied seat", async () => {
    const host = await mustClaim("Napoleon");
    const code = await createLobby(host, { maxSeats: 2 });
    await readyUp(host, code);
    const response = await startGame(host, code);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "needTwoSeats" });
  });

  it("refuses when a human seat is not ready", async () => {
    const host = await mustClaim("Napoleon");
    const guest = await mustClaim("Wellington");
    const code = await createLobby(host, { maxSeats: 2 });
    await joinLobby(guest, code);
    await readyUp(host, code);
    const response = await startGame(host, code);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "notAllReady" });
  });

  it("refuses a non-host", async () => {
    const host = await mustClaim("Napoleon");
    const guest = await mustClaim("Wellington");
    const code = await createLobby(host, { maxSeats: 2 });
    await joinLobby(guest, code);
    await readyUp(host, code);
    await readyUp(guest, code);
    expect((await startGame(guest, code)).status).toBe(403);
  });

  it("starts, points the lobby at the game, and refuses a second press", async () => {
    const host = await mustClaim("Napoleon");
    const guest = await mustClaim("Wellington");
    const code = await createLobby(host, { maxSeats: 2 });
    await joinLobby(guest, code);
    await readyUp(host, code);
    await readyUp(guest, code);

    const first = await startGame(host, code);
    expect(first.status).toBe(201);
    const { gameId } = (await first.json()) as { gameId: string };
    expect(gameId).toMatch(/^g_/);

    const body = await room(code, host.cookie);
    expect(body.status).toBe("playing");
    expect(body.gameId).toBe(gameId);

    const second = await startGame(host, code);
    expect(second.status).toBe(409);
  });

  it("compacts occupied seats to 0..n-1 and gives each a distinct colour", async () => {
    const host = await mustClaim("Napoleon", "red");
    const guest = await mustClaim("Wellington", "red");
    const code = await createLobby(host, { maxSeats: 6 });
    await joinLobby(guest, code, 4);
    await readyUp(host, code);
    await readyUp(guest, code);

    const started = await startGame(host, code);
    const { gameId } = (await started.json()) as { gameId: string };

    const rows = await harness.db.query<{ seat: number; color: string; player_id: string }>(
      "select seat, color, player_id from game_players where game_id = $1 order by seat",
      [gameId],
    );
    expect(rows.map((row) => Number(row.seat))).toEqual([0, 1]);
    expect(rows[0]?.player_id).toBe(host.playerId);
    expect(rows[1]?.player_id).toBe(guest.playerId);
    expect(rows[0]?.color).not.toBe(rows[1]?.color);
  });

  it("starts a human-plus-bot game with no ready flag on the bot", async () => {
    const host = await mustClaim("Napoleon");
    const code = await createLobby(host, { maxSeats: 2 });
    await routes.patchRoom(
      code,
      req(`/api/lobbies/${code}`, {
        method: "PATCH",
        cookie: host.cookie,
        body: { seats: [{ seat: 1, kind: "bot", tier: "medium" }] },
      }),
    );
    await readyUp(host, code);
    const started = await startGame(host, code);
    expect(started.status).toBe(201);

    const { gameId } = (await started.json()) as { gameId: string };
    const rows = await harness.db.query<{ kind: string; bot_level: string | null }>(
      "select kind, bot_level from game_players where game_id = $1 order by seat",
      [gameId],
    );
    expect(rows.map((row) => row.kind)).toEqual(["human", "bot"]);
    expect(rows[1]?.bot_level).toBe("medium");
  });
});
