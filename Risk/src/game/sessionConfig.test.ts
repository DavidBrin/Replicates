/** The setup-flow store and the autosave key (SPEC §4.14, §4.15). */
import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_RULES } from "@/engine/types";

import {
  BOT_TIERS, DEFAULT_VORONOI, SEAT_COLOURS, VIEWER_SEAT_PLACEHOLDER, createSessionConfigStore,
  defaultSeat, defaultSeats, sessionConfigStore, sourceKey, tierLabel, toGameConfig,
  withIdentityName,
} from "./sessionConfig";
import { gameConfig } from "./__fixtures__/harness";
import { SESSION_KEY_PREFIX, autosaveFor, hasSavedSession, listSavedSessions, readSaved, sessionKey, writeSaved }
  from "./autosave";
import type { SavedSession } from "./session";
import { installMemoryStorage } from "@/adapters/localStorage/testStorage";

describe("the session-config store", () => {
  beforeEach(() => {
    sessionConfigStore.getState().reset();
    installMemoryStorage();
  });

  it("starts on Solo with three seats and the default rules", () => {
    const s = sessionConfigStore.getState();
    expect(s.mode).toBe("solo");
    expect(s.seats).toHaveLength(3);
    expect(s.rules).toEqual(DEFAULT_RULES);
    expect(s.ready).toBe(false);
  });

  it("solo gives seat 0 to the human and the rest to bots", () => {
    const seats = defaultSeats("solo", 4, "medium");
    expect(seats.map((s) => s.kind)).toEqual(["human", "bot", "bot", "bot"]);
    expect(seats[1]?.tier).toBe("medium");
    expect(seats[0]?.tier).toBeNull();
  });

  it("pass & play gives every seat to a human", () => {
    expect(defaultSeats("pass-and-play", 3, "medium").every((s) => s.kind === "human")).toBe(true);
  });

  it("switching mode rebuilds the seats", () => {
    const store = createSessionConfigStore();
    store.getState().setMode("pass-and-play");
    expect(store.getState().seats.every((s) => s.kind === "human")).toBe(true);
    expect(store.getState().mode).toBe("pass-and-play");
  });

  it("1v1 collapses to two seats", () => {
    const store = createSessionConfigStore();
    store.getState().setFormat("1v1");
    expect(store.getState().seats).toHaveLength(2);
  });

  it("clamps the seat count to 2..6", () => {
    const store = createSessionConfigStore();
    store.getState().setSeatCount(99);
    expect(store.getState().seats).toHaveLength(6);
    store.getState().setSeatCount(0);
    expect(store.getState().seats).toHaveLength(2);
  });

  it("keeps existing seat rows when growing", () => {
    const store = createSessionConfigStore();
    store.getState().setSeat(0, { name: "Ada" });
    store.getState().setSeatCount(5);
    expect(store.getState().seats[0]?.name).toBe("Ada");
    expect(store.getState().seats).toHaveLength(5);
  });

  it("keeps tier non-null iff the seat is a bot (§4.6)", () => {
    const store = createSessionConfigStore();
    store.getState().setSeat(1, { kind: "human" });
    expect(store.getState().seats[1]?.tier).toBeNull();
    store.getState().setSeat(1, { kind: "bot" });
    expect(store.getState().seats[1]?.tier).not.toBeNull();
  });

  it("the AI Difficulty rule re-tiers every bot seat", () => {
    const store = createSessionConfigStore();
    store.getState().setRules({ aiDifficulty: "expert" });
    for (const s of store.getState().seats) {
      if (s.kind === "bot") expect(s.tier).toBe("expert");
    }
  });

  it("writes a slug map source", () => {
    const store = createSessionConfigStore();
    store.getState().setSource({ kind: "slug", slug: "classic-world" });
    expect(store.getState().source).toEqual({ kind: "slug", slug: "classic-world" });
  });

  it("writes a random map source with Voronoi options", () => {
    const store = createSessionConfigStore();
    store.getState().setSource({ kind: "random", options: DEFAULT_VORONOI, seed: "s" });
    const source = store.getState().source;
    expect(source?.kind).toBe("random");
    if (source?.kind === "random") expect(source.options.territories).toBe(42);
  });

  it("changing the source clears ready", () => {
    const store = createSessionConfigStore();
    store.getState().setReady(true);
    store.getState().setSource({ kind: "slug", slug: "x" });
    expect(store.getState().ready).toBe(false);
  });

  it("offers nine colours and five tiers", () => {
    expect(SEAT_COLOURS).toHaveLength(9);
    expect(BOT_TIERS).toEqual(["beginner", "easy", "medium", "hard", "expert"]);
  });

  it("title-cases a tier for the readout", () => {
    expect(tierLabel("expert")).toBe("Expert");
    expect(tierLabel(null)).toBe("—");
  });

  it("gives a seat the next colour in the wheel", () => {
    expect(defaultSeat(0, "human", "medium").colour).toBe("red");
    expect(defaultSeat(1, "bot", "medium").colour).toBe("green");
  });

  it("assembles a GameConfig", () => {
    const config = toGameConfig(sessionConfigStore.getState(), "classic-world", "seed-1");
    expect(config.mapSlug).toBe("classic-world");
    expect(config.seed).toBe("seed-1");
    expect(config.seats).toHaveLength(3);
  });
});

describe("withIdentityName — the viewer's seat takes the claimed display name", () => {
  it("renames the `You` seat and leaves every other seat alone", () => {
    const seats = defaultSeats("solo", 3, "medium");
    expect(seats[0]?.name).toBe(VIEWER_SEAT_PLACEHOLDER);
    const named = withIdentityName(seats, "Northern Warden 21");
    expect(named.map((s) => s.name)).toEqual(["Northern Warden 21", "Bot 1", "Bot 2"]);
    // Everything but the name is untouched, so the autosave key does not move.
    expect(named[0]?.colour).toBe(seats[0]?.colour);
    expect(sourceKey(toGameConfig({ ...sessionConfigStore.getState(), seats: named }, "m", "s")))
      .toBe(sourceKey(toGameConfig({ ...sessionConfigStore.getState(), seats }, "m", "s")));
  });

  it("renames at most one seat — Pass & Play seats keep their own names", () => {
    const seats = defaultSeats("pass-and-play", 3, "medium");
    const named = withIdentityName(seats, "Solace");
    expect(named.map((s) => s.name)).toEqual(["Solace", "Player 2", "Player 3"]);
  });

  it("leaves a seat the player renamed, and ignores an empty identity", () => {
    const seats = defaultSeats("solo", 2, "medium").map((s, i) => (i === 0 ? { ...s, name: "Rook" } : s));
    expect(withIdentityName(seats, "Solace")).toEqual(seats);
    expect(withIdentityName(defaultSeats("solo", 2, "medium"), "  ")[0]?.name)
      .toBe(VIEWER_SEAT_PLACEHOLDER);
    expect(withIdentityName(defaultSeats("solo", 2, "medium"), null)[0]?.name)
      .toBe(VIEWER_SEAT_PLACEHOLDER);
  });
});

describe("sourceKey", () => {
  it("is stable for the same configuration", () => {
    expect(sourceKey(gameConfig())).toBe(sourceKey(gameConfig()));
  });

  it("changes with the map", () => {
    const a = gameConfig();
    expect(sourceKey(a)).not.toBe(sourceKey({ ...a, mapSlug: "other" }));
  });

  it("changes with the rules", () => {
    const a = gameConfig();
    expect(sourceKey(a)).not.toBe(sourceKey({ ...a, rules: { ...a.rules, fogOfWar: true } }));
  });

  it("changes with the seat configuration", () => {
    const a = gameConfig();
    const seats = [...a.seats, { kind: "bot" as const, name: "D", colour: "pink" as const, tier: "easy" as const }];
    expect(sourceKey(a)).not.toBe(sourceKey({ ...a, seats }));
  });

  it("does NOT change with the seed — a reseeded game reuses its bucket", () => {
    const a = gameConfig({ seed: "one" });
    const b = gameConfig({ seed: "two" });
    expect(sourceKey(a)).toBe(sourceKey(b));
  });

  it("starts with the map slug, so a key is legible", () => {
    expect(sourceKey(gameConfig())).toMatch(/^harness-/);
  });
});

describe("autosave", () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  const saved = (config = gameConfig()): SavedSession => ({
    version: 1,
    config,
    state: { mapSlug: config.mapSlug } as unknown as SavedSession["state"],
    turn: 3,
    grudge: [0, 0, 0],
    savedAt: 1000,
  });

  it("namespaces the key under risk:session:v1:", () => {
    expect(sessionKey(gameConfig()).startsWith(SESSION_KEY_PREFIX)).toBe(true);
  });

  it("round-trips a save", () => {
    const config = gameConfig();
    writeSaved(config, saved(config));
    expect(readSaved(config)?.turn).toBe(3);
    expect(hasSavedSession(config)).toBe(true);
  });

  it("clears on null", () => {
    const config = gameConfig();
    writeSaved(config, saved(config));
    writeSaved(config, null);
    expect(readSaved(config)).toBeNull();
    expect(hasSavedSession(config)).toBe(false);
  });

  it("refuses a save from another version", () => {
    const config = gameConfig();
    window.localStorage.setItem(sessionKey(config), JSON.stringify({ ...saved(config), version: 2 }));
    expect(readSaved(config)).toBeNull();
  });

  it("does not resume a differently-configured game", () => {
    const a = gameConfig();
    writeSaved(a, saved(a));
    expect(readSaved({ ...a, mapSlug: "elsewhere" })).toBeNull();
  });

  it("autosaveFor binds the pair to one config", () => {
    const config = gameConfig();
    const { resume, save } = autosaveFor(config);
    expect(resume).toBeNull();
    save(saved(config));
    expect(readSaved(config)?.turn).toBe(3);
  });

  it("lists every saved game newest first", () => {
    const a = gameConfig({ seed: "a" });
    const b = gameConfig({ seed: "b", rules: { fogOfWar: true } });
    writeSaved(a, { ...saved(a), savedAt: 10 });
    writeSaved(b, { ...saved(b), savedAt: 20 });
    const list = listSavedSessions();
    expect(list).toHaveLength(2);
    expect(list[0]?.saved.savedAt).toBe(20);
  });
});
