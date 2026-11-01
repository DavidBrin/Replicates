import { describe, expect, it } from "vitest";

import { DEFAULT_PAD_SETTINGS, PAD_BUTTON_LIMIT, rebind } from "@/input/gamepad";
import { CONTROL_PREFS_KEY, readControlPrefs, writeControlPrefs } from "./controlPrefs";
import { memoryStorage } from "./testing/memoryStorage";

/** A `Storage` whose every access throws, as a blocked or private one may. */
const THROWING = new Proxy({} as Storage, {
  get() {
    throw new Error("SecurityError: storage is blocked");
  },
});

describe("saved control options (Plan 5)", () => {
  it("round-trips each port's Stick Jump and pad settings", () => {
    const storage = memoryStorage();
    const prefs = { 0: { stickJump: false, pad: rebind(DEFAULT_PAD_SETTINGS, "attack", 3) }, 1: { stickJump: true, pad: { ...DEFAULT_PAD_SETTINGS, rightStick: "special" as const } } };
    writeControlPrefs(prefs, storage);
    expect(readControlPrefs(storage)).toEqual(prefs);
  });

  it("reads nothing from corrupt JSON", () => {
    const storage = memoryStorage();
    storage.setItem(CONTROL_PREFS_KEY, "{not json");
    expect(readControlPrefs(storage)).toEqual({});
    storage.setItem(CONTROL_PREFS_KEY, "[1,2]");
    expect(readControlPrefs(storage)).toEqual({});
  });

  /** R-T21b: defaults on any failure, field by field; a port with nothing valid saved is absent. */
  it("gives a field whose saved shape is wrong its default, keeping the port's other field", () => {
    const storage = memoryStorage();
    const special = { ...DEFAULT_PAD_SETTINGS, rightStick: "special" as const };
    storage.setItem(
      CONTROL_PREFS_KEY,
      JSON.stringify({
        0: { stickJump: false, pad: DEFAULT_PAD_SETTINGS },
        1: { stickJump: "no", pad: special },
        2: { stickJump: false, pad: { buttons: {}, rightStick: "smash" } },
        3: { stickJump: "no", pad: 7 },
        4: "on",
      }),
    );
    expect(readControlPrefs(storage)).toEqual({
      0: { stickJump: false, pad: DEFAULT_PAD_SETTINGS },
      1: { stickJump: true, pad: special },
      2: { stickJump: false, pad: DEFAULT_PAD_SETTINGS },
    });
  });

  it("keeps a port's Stick Jump when its pad holds a button the capture would refuse", () => {
    const storage = memoryStorage();
    const big = { ...DEFAULT_PAD_SETTINGS, buttons: { ...DEFAULT_PAD_SETTINGS.buttons, attack: [PAD_BUTTON_LIMIT] } };
    storage.setItem(CONTROL_PREFS_KEY, JSON.stringify({ 0: { stickJump: false, pad: big } }));
    expect(readControlPrefs(storage)).toEqual({ 0: { stickJump: false, pad: DEFAULT_PAD_SETTINGS } });
  });

  it("survives a storage that throws, reading the defaults and saving nothing", () => {
    expect(readControlPrefs(THROWING)).toEqual({});
    expect(() => writeControlPrefs({ 0: { stickJump: false, pad: DEFAULT_PAD_SETTINGS } }, THROWING)).not.toThrow();
    expect(readControlPrefs(null)).toEqual({});
  });

  it("reads only the ports a match can have, by their number", () => {
    const storage = memoryStorage();
    const ok = { stickJump: false, pad: DEFAULT_PAD_SETTINGS };
    const other = { stickJump: true, pad: DEFAULT_PAD_SETTINGS };
    storage.setItem(CONTROL_PREFS_KEY, JSON.stringify({ 3: ok, "03": other, 8: other, "-1": other, "1.5": other, p1: other }));
    expect(readControlPrefs(storage)).toEqual({ 3: ok });
  });

  /**
   * What comes back is rebuilt from the fields it is checked for, so a key
   * the schema does not know (written by hand, or by a later build) never
   * rides into a player's slot or the pad's mapping.
   */
  it("brings back the known fields alone", () => {
    const storage = memoryStorage();
    const pad = { ...DEFAULT_PAD_SETTINGS, buttons: { ...DEFAULT_PAD_SETTINGS.buttons, stickX: 3 }, extra: 1 };
    storage.setItem(CONTROL_PREFS_KEY, JSON.stringify({ 0: { stickJump: false, pad, kind: "cpu", port: 2 } }));
    expect(readControlPrefs(storage)).toStrictEqual({ 0: { stickJump: false, pad: DEFAULT_PAD_SETTINGS } });
  });

  it("gives the default pad for one that puts one button on two actions", () => {
    const storage = memoryStorage();
    const doubled = { ...DEFAULT_PAD_SETTINGS, buttons: { ...DEFAULT_PAD_SETTINGS.buttons, special: [0] } };
    storage.setItem(CONTROL_PREFS_KEY, JSON.stringify({ 0: { stickJump: false, pad: doubled } }));
    expect(readControlPrefs(storage)).toEqual({ 0: { stickJump: false, pad: DEFAULT_PAD_SETTINGS } });
  });
});
