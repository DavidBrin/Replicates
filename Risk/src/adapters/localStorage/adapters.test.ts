/** The three localStorage adapters (SPEC §4.16). */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PROGRESS_KEY, createProgressAdapter } from "./progress";
import { DEFAULT_SETTINGS, SETTINGS_KEY, createMemorySettings, createSettingsAdapter } from "./settings";
import {
  IDENTITY_KEY, NameTakenError, createIdentityAdapter, generateName, isValidDisplayName,
} from "./identity";
import { newId, readJson, writeJson } from "./store";
import { installMemoryStorage } from "./testStorage";

beforeEach(() => {
  installMemoryStorage();
  vi.restoreAllMocks();
});

describe("the storage wrapper", () => {
  it("round-trips JSON", () => {
    writeJson("k", { a: 1 });
    expect(readJson("k", null)).toEqual({ a: 1 });
  });

  it("falls back on a missing key", () => {
    expect(readJson("absent", "fallback")).toBe("fallback");
  });

  it("falls back on corrupt JSON rather than throwing", () => {
    window.localStorage.setItem("broken", "{not json");
    expect(readJson("broken", 7)).toBe(7);
  });

  it("swallows a write failure", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => writeJson("k", 1)).not.toThrow();
    spy.mockRestore();
  });

  it("mints an id even without crypto.randomUUID", () => {
    expect(newId().length).toBeGreaterThan(4);
  });
});

describe("the settings adapter", () => {
  it("defaults to the SPEC's values", () => {
    const port = createSettingsAdapter();
    expect(port.read()).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.cameraAnimations).toBe(true);
    expect(DEFAULT_SETTINGS.phaseAnimations).toBe(true);
    expect(DEFAULT_SETTINGS.endPhaseConfirmation).toBe(true);
    expect(DEFAULT_SETTINGS.colourPatterns).toBe(false);
    expect(DEFAULT_SETTINGS.winChanceRamp).toBe(false);
  });

  it("writes a patch and reads it back", () => {
    const port = createSettingsAdapter();
    port.write({ sound: false });
    expect(port.read().sound).toBe(false);
    expect(port.read().music).toBe(true);
    expect(window.localStorage.getItem(SETTINGS_KEY)).toContain('"sound":false');
  });

  it("notifies every subscriber, so two tabs agree", () => {
    const port = createSettingsAdapter();
    const seen: boolean[] = [];
    const off = port.subscribe((s) => seen.push(s.music));
    port.write({ music: false });
    expect(seen).toEqual([false]);
    off();
    port.write({ music: true });
    expect(seen).toEqual([false]);
  });

  it("repairs a partial or wrong-typed stored value", () => {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ sound: "yes", music: false }));
    expect(createSettingsAdapter().read()).toEqual({ ...DEFAULT_SETTINGS, music: false });
  });

  it("offers an in-memory port for tests", () => {
    const port = createMemorySettings({ sound: false });
    expect(port.read().sound).toBe(false);
    port.write({ sound: true });
    expect(port.read().sound).toBe(true);
  });
});

describe("the progress adapter", () => {
  it("mints a device id on first read and keeps it", () => {
    const port = createProgressAdapter();
    const first = port.read().deviceId;
    expect(first).toBeTruthy();
    expect(createProgressAdapter().read().deviceId).toBe(first);
  });

  it("records a played game and a win", () => {
    const port = createProgressAdapter();
    port.recordResult("classic", true);
    port.recordResult("classic", false);
    const record = port.read().maps.classic;
    expect(record).toEqual({ played: 2, won: 1, lastSeats: 0 });
  });

  it("keeps maps apart", () => {
    const port = createProgressAdapter();
    port.recordResult("classic", true);
    port.recordResult("europe", false);
    expect(port.read().maps.classic?.won).toBe(1);
    expect(port.read().maps.europe?.won).toBe(0);
  });

  it("repairs a corrupt record", () => {
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify({ maps: { classic: "nope" }, deviceId: 4 }));
    const progress = createProgressAdapter().read();
    expect(typeof progress.deviceId).toBe("string");
    expect(progress.maps.classic).toBeUndefined();
  });
});

describe("the identity adapter", () => {
  it("generates an <Adjective> <Noun> <NN> name", () => {
    expect(generateName(() => 0)).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ \d{2}$/);
  });

  it("validates 2–20 characters after trimming", () => {
    expect(isValidDisplayName("a")).toBe(false);
    expect(isValidDisplayName("  ab  ")).toBe(true);
    expect(isValidDisplayName("x".repeat(20))).toBe(true);
    expect(isValidDisplayName("x".repeat(21))).toBe(false);
  });

  it("reads nothing before a first claim", () => {
    expect(createIdentityAdapter().readCached()).toBeNull();
  });

  it("claims against POST /api/session and caches the name and colour", async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ playerId: "p1", displayName: "Bold General 42", colour: "blue" }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    const port = createIdentityAdapter({ fetch: fetchMock as unknown as typeof fetch });
    const identity = await port.claim("Bold General 42");
    expect(identity.playerId).toBe("p1");
    expect(port.readCached()).toEqual({ displayName: "Bold General 42", colour: "blue" });
    expect(fetchMock).toHaveBeenCalledWith("/api/session", expect.objectContaining({ method: "POST" }));
  });

  it("throws NameTakenError with the suggestions on a 409", async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ suggestions: ["Bold General 43", "Bold General 44", "Iron Marshal 11"] }),
      { status: 409, headers: { "content-type": "application/json" } },
    ));
    const port = createIdentityAdapter({ fetch: fetchMock as unknown as typeof fetch });
    await expect(port.claim("Taken")).rejects.toBeInstanceOf(NameTakenError);
    await port.claim("Taken").catch((e: unknown) => {
      expect((e as NameTakenError).suggestions).toHaveLength(3);
    });
  });

  it("tolerates a 404 offline and still produces a local identity", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 404 }));
    const port = createIdentityAdapter({ fetch: fetchMock as unknown as typeof fetch });
    const identity = await port.claim("Offline Player");
    expect(identity.displayName).toBe("Offline Player");
    expect(identity.playerId).toMatch(/^local-/);
    expect(port.readCached()?.displayName).toBe("Offline Player");
  });

  it("tolerates a network failure", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("offline");
    });
    const port = createIdentityAdapter({ fetch: fetchMock as unknown as typeof fetch });
    await expect(port.claim("Still Fine")).resolves.toMatchObject({ displayName: "Still Fine" });
  });

  it("stores only the name and colour — never a secret", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 404 }));
    const port = createIdentityAdapter({ fetch: fetchMock as unknown as typeof fetch });
    await port.claim("Secretless");
    const raw = window.localStorage.getItem(IDENTITY_KEY) ?? "";
    expect(Object.keys(JSON.parse(raw) as object).sort()).toEqual(["colour", "displayName"]);
  });

  it("changes the colour and keeps the name", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 404 }));
    const port = createIdentityAdapter({ fetch: fetchMock as unknown as typeof fetch });
    await port.claim("Colourful");
    const next = await port.setColour("purple");
    expect(next.colour).toBe("purple");
    expect(port.readCached()).toEqual({ displayName: "Colourful", colour: "purple" });
  });

  it("forgets the cached identity on leave", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 404 }));
    const port = createIdentityAdapter({ fetch: fetchMock as unknown as typeof fetch });
    await port.claim("Leaver");
    await port.leave();
    expect(port.readCached()).toBeNull();
  });

  it("repairs an unknown stored colour", async () => {
    window.localStorage.setItem(IDENTITY_KEY, JSON.stringify({ displayName: "X", colour: "chartreuse" }));
    expect(createIdentityAdapter().readCached()).toEqual({ displayName: "X", colour: "red" });
  });
});
