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

  it("drops unknown keys from a future version", () => {
    const parsed = parseSettings({ ...defaultSettings, somethingNew: true });
    expect(parsed).not.toHaveProperty("somethingNew");
  });

  it("round-trips a valid object unchanged", () => {
    expect(parseSettings(defaultSettings)).toEqual(defaultSettings);
  });
});
