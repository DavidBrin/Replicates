// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { COOKIE_NAME, readSessionCookie } from "../auth";
import { generateName, isValidName, nameKey, normaliseName, suggestNames } from "../names";
import { claim, cookieOf, mustClaim, req, routes, startHarness, type Harness } from "./harness";

/**
 * `/api/session` — the whole identity model (SPEC §6.1, D17): claiming,
 * `409` with suggestions, the conditional reap, the cookie's attributes, and
 * the colour being a NAME rather than a hex.
 */

let harness: Harness;

beforeEach(async () => {
  harness = await startHarness();
});

afterEach(async () => {
  await harness.dispose();
});

describe("normalisation", () => {
  it("trims and collapses internal whitespace", () => {
    expect(normaliseName("  Napoleon   Bonaparte ")).toBe("Napoleon Bonaparte");
    expect(nameKey("Napoleon")).toBe("napoleon");
  });

  it("accepts 2–20 characters of the allowed alphabet", () => {
    expect(isValidName("Ab")).toBe(true);
    expect(isValidName("A")).toBe(false);
    expect(isValidName("A".repeat(21))).toBe(false);
    expect(isValidName("Nap_oleon.1-2")).toBe(true);
  });

  it("refuses a name that does not start with a letter or digit", () => {
    expect(isValidName(" Napoleon")).toBe(false);
    expect(isValidName("-Napoleon")).toBe(false);
    expect(isValidName("Napoleon!")).toBe(false);
  });

  it("generates an <Adjective> <Noun> <NN> that passes its own validator", () => {
    for (let i = 0; i < 25; i += 1) {
      const name = generateName();
      expect(name, name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ \d\d$/);
      expect(isValidName(name), name).toBe(true);
    }
  });

  it("suggests three free names and never repeats one", async () => {
    const taken = new Set(["napoleon-2"]);
    const suggestions = await suggestNames("Napoleon", async (key) => !taken.has(key));
    expect(suggestions).toEqual(["Napoleon-3", "Napoleon-4", "Napoleon-5"]);
    expect(new Set(suggestions).size).toBe(3);
  });

  it("truncates the stem so a 20-character name still gets suggestions", async () => {
    const suggestions = await suggestNames("A".repeat(20), async () => true);
    expect(suggestions).toHaveLength(3);
    for (const suggestion of suggestions) {
      expect(suggestion.length).toBeLessThanOrEqual(20);
      expect(isValidName(suggestion)).toBe(true);
    }
  });
});

describe("POST /api/session", () => {
  it("claims a name, returns the identity and sets the cookie", async () => {
    const response = await routes.postSession(
      req("/api/session", { method: "POST", body: { displayName: "Napoleon", colour: "red" } }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      playerId: string;
      displayName: string;
      colour: string;
    };
    expect(body).toMatchObject({ displayName: "Napoleon", colour: "red" });
    expect(body.playerId).toMatch(/^p_[A-Za-z0-9_-]{21}$/);

    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${COOKIE_NAME}=${body.playerId}.`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain(`Max-Age=${30 * 24 * 60 * 60}`);
  });

  it("never sets Cache-Control other than no-store", async () => {
    const response = await routes.postSession(
      req("/api/session", { method: "POST", body: { displayName: "Wellington" } }),
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("writes exactly one row for one claim", async () => {
    await mustClaim("Napoleon");
    const rows = await harness.db.query("select id from players");
    expect(rows).toHaveLength(1);
  });

  it("answers 409 nameTaken with three suggestions, and writes no second row", async () => {
    await mustClaim("Napoleon");
    const second = await claim("napoleon");
    if (!("conflict" in second)) throw new Error("expected a conflict");
    expect(second.conflict.status).toBe(409);
    const body = (await second.conflict.json()) as { error: string; suggestions: string[] };
    expect(body.error).toBe("nameTaken");
    expect(body.suggestions).toHaveLength(3);
    // The suggestions are built from what the player TYPED, not from the
    // holder's spelling: they asked for "napoleon" and that is the name they
    // are offered variations of.
    expect(body.suggestions).toEqual(["napoleon-2", "napoleon-3", "napoleon-4"]);

    const rows = await harness.db.query("select id from players");
    expect(rows).toHaveLength(1);
  });

  it("never silently renames — the 409 carries no cookie", async () => {
    await mustClaim("Napoleon");
    const second = await claim("Napoleon");
    if (!("conflict" in second)) throw new Error("expected a conflict");
    expect(second.conflict.headers.get("set-cookie")).toBeNull();
  });

  it("reaps a dead holder and re-issues the name", async () => {
    const first = await mustClaim("Napoleon");
    await harness.db.execute(
      "update players set last_seen_at = now() - interval '5 minutes' where id = $1",
      [first.playerId],
    );
    const second = await mustClaim("Napoleon");
    expect(second.playerId).not.toBe(first.playerId);

    const rows = await harness.db.query("select id from players");
    expect(rows).toHaveLength(1);
  });

  it("never reaps a holder seated in a lobby, however long they have been away", async () => {
    const host = await mustClaim("Napoleon");
    await routes.createLobby(
      req("/api/lobbies", {
        method: "POST",
        cookie: host.cookie,
        body: {
          title: "Held",
          mapSlug: "tiny4",
          rules: {
            winCondition: "world",
            dominationThreshold: 0.7,
            cardBonus: "fixed",
            diceMode: "balancedBlitz",
            fogOfWar: false,
            capitals: false,
            capitalDraftBonus: false,
            blizzards: false,
            portals: "off",
            manualPlacement: false,
            maxRounds: null,
            roundDelayMs: 0,
            turnSeconds: 90,
            alliances: false,
            aiDifficulty: "medium",
          },
          maxSeats: 2,
        },
      }),
    );
    await harness.db.execute(
      "update players set last_seen_at = now() - interval '1 hour' where id = $1",
      [host.playerId],
    );

    const second = await claim("Napoleon");
    expect("conflict" in second).toBe(true);
  });

  it("refuses a body that is not JSON, and one that is not a name", async () => {
    expect(
      (await routes.postSession(req("/api/session", { method: "POST", body: "{nope" }))).status,
    ).toBe(400);
    expect(
      (await routes.postSession(req("/api/session", { method: "POST", body: { displayName: "A" } })))
        .status,
    ).toBe(400);
    expect(
      (
        await routes.postSession(
          req("/api/session", { method: "POST", body: { displayName: "Ok", colour: "#ff0000" } }),
        )
      ).status,
    ).toBe(400);
  });

  it("assigns one of the nine colour NAMES when none is chosen", async () => {
    const response = await routes.postSession(
      req("/api/session", { method: "POST", body: { displayName: "Blucher" } }),
    );
    const body = (await response.json()) as { colour: string };
    expect([
      "red",
      "green",
      "blue",
      "yellow",
      "orange",
      "pink",
      "black",
      "white",
      "purple",
    ]).toContain(body.colour);
  });
});

describe("PATCH /api/session", () => {
  it("changes colour", async () => {
    const session = await mustClaim("Napoleon", "red");
    const response = await routes.patchSession(
      req("/api/session", { method: "PATCH", cookie: session.cookie, body: { colour: "purple" } }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ colour: "purple" });
  });

  it("changes display name", async () => {
    const session = await mustClaim("Napoleon");
    const response = await routes.patchSession(
      req("/api/session", {
        method: "PATCH",
        cookie: session.cookie,
        body: { displayName: "Bonaparte" },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ displayName: "Bonaparte" });
  });

  it("answers 409 when the new name is held by somebody else", async () => {
    await mustClaim("Wellington");
    const session = await mustClaim("Napoleon");
    const response = await routes.patchSession(
      req("/api/session", {
        method: "PATCH",
        cookie: session.cookie,
        body: { displayName: "Wellington" },
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "nameTaken" });
  });

  it("answers 401 without a cookie, and with a forged one", async () => {
    expect(
      (await routes.patchSession(req("/api/session", { method: "PATCH", body: { colour: "red" } })))
        .status,
    ).toBe(401);
    const session = await mustClaim("Napoleon");
    const forged = `${COOKIE_NAME}=${session.playerId}.deadbeef`;
    expect(
      (
        await routes.patchSession(
          req("/api/session", { method: "PATCH", cookie: forged, body: { colour: "red" } }),
        )
      ).status,
    ).toBe(401);
  });

  it("refuses a patch that changes nothing", async () => {
    const session = await mustClaim("Napoleon");
    const response = await routes.patchSession(
      req("/api/session", { method: "PATCH", cookie: session.cookie, body: {} }),
    );
    expect(response.status).toBe(400);
  });
});

describe("DELETE /api/session", () => {
  it("clears the cookie, releases the name, and 401s afterwards", async () => {
    const session = await mustClaim("Napoleon");
    const response = await routes.deleteSession(
      req("/api/session", { method: "DELETE", cookie: session.cookie }),
    );
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");

    // The name is immediately free again, and the old cookie is dead.
    await mustClaim("Napoleon");
    expect(
      (await routes.deleteSession(req("/api/session", { method: "DELETE", cookie: session.cookie })))
        .status,
    ).toBe(401);
  });
});

describe("the cookie parser", () => {
  it("splits playerId from secret on the first dot", () => {
    expect(
      readSessionCookie(new Request("http://t/", { headers: { cookie: "risk_sid=p_1.abc" } })),
    ).toEqual({ id: "p_1", secret: "abc" });
  });

  it("ignores other cookies and malformed values", () => {
    const header = "other=1; risk_sid=p_1.abc; third=2";
    expect(readSessionCookie(new Request("http://t/", { headers: { cookie: header } }))).toEqual({
      id: "p_1",
      secret: "abc",
    });
    for (const bad of ["risk_sid=", "risk_sid=p_1", "risk_sid=.abc", "risk_sid=p_1.a.b"]) {
      expect(
        readSessionCookie(new Request("http://t/", { headers: { cookie: bad } })),
        bad,
      ).toBeNull();
    }
    expect(readSessionCookie(new Request("http://t/"))).toBeNull();
  });

  it("round-trips a real Set-Cookie through cookieOf", async () => {
    const response = await routes.postSession(
      req("/api/session", { method: "POST", body: { displayName: "Napoleon" } }),
    );
    const parsed = readSessionCookie(
      new Request("http://t/", { headers: { cookie: cookieOf(response) } }),
    );
    expect(parsed?.secret).toMatch(/^[0-9a-f]{64}$/);
  });
});
