import { describe, expect, it } from "vitest";

import { defaultSettings, parseSettings } from "./settings";

describe("default settings", () => {
  it("opens on the iOS skin with the scripted voice", () => {
    expect(defaultSettings.skin).toBe("ios");
    // Scripted, never AI: the AI tier needs a key we do not ship, so it can
    // never be the default (SPEC §2.2).
    expect(defaultSettings.voiceTier).toBe("scripted");
  });

  it("rings immediately, because the app is opened when it is already needed", () => {
    expect(defaultSettings.ringDelaySeconds).toBe(0);
  });

  it("shows subtitles, so a call still reads as real when speech fails", () => {
    expect(defaultSettings.showSubtitles).toBe(true);
  });
});

describe("parseSettings", () => {
  it("falls back to defaults for junk input", () => {
    expect(parseSettings(null)).toEqual(defaultSettings);
    expect(parseSettings("not settings")).toEqual(defaultSettings);
    expect(parseSettings(42)).toEqual(defaultSettings);
  });

  it("keeps the good fields when one field is corrupt", () => {
    // Field-level repair: a photo that blew the storage quota and got
    // truncated must not cost the user their configured caller name.
    const parsed = parseSettings({
      version: 1,
      skin: "android",
      caller: { name: "Dad", label: "mobile", photo: "" },
      ringDelaySeconds: 9999,
      voiceTier: "telepathy",
    });
    expect(parsed.skin).toBe("android");
    expect(parsed.caller.name).toBe("Dad");
    expect(parsed.ringDelaySeconds).toBe(defaultSettings.ringDelaySeconds);
    expect(parsed.voiceTier).toBe(defaultSettings.voiceTier);
  });

  it("repairs a nested group field by field, not as a whole", () => {
    // D16 promises field-level repair, and a promise that stops at the top
    // level is not one. The photo is the field most likely to go bad — it is
    // the only one large enough to blow the storage quota — and losing it must
    // not also cost the caller name and label sitting beside it, which are what
    // make the call screen convincing.
    const parsed = parseSettings({
      ...defaultSettings,
      caller: { name: "Dad", label: "iPhone", photo: "x".repeat(4_000_001) },
    });

    expect(parsed.caller.name).toBe("Dad");
    expect(parsed.caller.label).toBe("iPhone");
    expect(parsed.caller.photo).toBe(defaultSettings.caller.photo);
  });

  it("repairs the live group the same way", () => {
    const parsed = parseSettings({
      ...defaultSettings,
      live: { username: "nightwalk", avatar: "", viewers: -12, commentsPerMinute: 60 },
    });

    expect(parsed.live.username).toBe("nightwalk");
    expect(parsed.live.commentsPerMinute).toBe(60);
    expect(parsed.live.viewers).toBe(defaultSettings.live.viewers);
  });

  it("repairs a bad nested field and a bad top-level field in the same object", () => {
    const parsed = parseSettings({
      ...defaultSettings,
      skin: "hologram",
      caller: { name: "Dad", label: "iPhone", photo: 42 },
    });

    expect(parsed.skin).toBe(defaultSettings.skin);
    expect(parsed.caller.name).toBe("Dad");
    expect(parsed.caller.label).toBe("iPhone");
  });

  it("takes the group defaults when the group is not an object at all", () => {
    // Nothing to salvage field by field, but the rest of the object survives.
    const parsed = parseSettings({ ...defaultSettings, skin: "android", caller: "Mum" });

    expect(parsed.caller).toEqual(defaultSettings.caller);
    expect(parsed.skin).toBe("android");
  });

  it("drops unknown keys from a future version", () => {
    const parsed = parseSettings({ ...defaultSettings, somethingNew: true });
    expect(parsed).not.toHaveProperty("somethingNew");
  });

  it("round-trips a valid object unchanged", () => {
    expect(parseSettings(defaultSettings)).toEqual(defaultSettings);
  });
});
