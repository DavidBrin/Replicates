import { describe, expect, it } from "vitest";

import {
  ASSUMED_FRAME_RATE,
  PLAYBACK_RATES,
  SEEK_JUMP_SECONDS,
  SEEK_STEP_SECONDS,
  VOLUME_STEP,
  isTypingContext,
  resolveShortcut,
  steppedPlaybackRate,
  type KeyboardEventLike,
  type ShortcutContext,
} from "../keyboard";

/**
 * The keyboard map.
 *
 * `research/07-captions-and-a11y.md` §6 is the table this asserts, row by row,
 * and §6.1 is the rule that keeps it from firing while somebody is typing. §6's
 * own closing note is the reason the preconditions get their own tests: "build
 * both preconditions into our handler, not just the key match".
 */

const PLAYING: ShortcutContext = {
  paused: false,
  captionsAvailable: true,
  captionsOn: false,
};

function key(k: string, modifiers: Partial<KeyboardEventLike> = {}): KeyboardEventLike {
  return { key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...modifiers };
}

describe("resolveShortcut — the transport keys (§6)", () => {
  it("maps space and k to play/pause", () => {
    for (const k of [" ", "k", "K"]) {
      expect(resolveShortcut(key(k), PLAYING)?.action).toEqual({ kind: "toggle-play" });
    }
  });

  it("gives j and l the ±10s jump and the arrows the ±5s step", () => {
    // The two pairs are different distances, which is the single most likely
    // thing to collapse into one constant.
    expect(resolveShortcut(key("j"), PLAYING)?.action).toEqual({
      kind: "seek-by",
      seconds: -SEEK_JUMP_SECONDS,
    });
    expect(resolveShortcut(key("l"), PLAYING)?.action).toEqual({
      kind: "seek-by",
      seconds: SEEK_JUMP_SECONDS,
    });
    expect(resolveShortcut(key("ArrowLeft"), PLAYING)?.action).toEqual({
      kind: "seek-by",
      seconds: -SEEK_STEP_SECONDS,
    });
    expect(resolveShortcut(key("ArrowRight"), PLAYING)?.action).toEqual({
      kind: "seek-by",
      seconds: SEEK_STEP_SECONDS,
    });
    expect(SEEK_JUMP_SECONDS).not.toBe(SEEK_STEP_SECONDS);
  });

  it("gives the vertical arrows the volume, not a seek", () => {
    expect(resolveShortcut(key("ArrowUp"), PLAYING)?.action).toEqual({
      kind: "volume-by",
      delta: VOLUME_STEP,
    });
    expect(resolveShortcut(key("ArrowDown"), PLAYING)?.action).toEqual({
      kind: "volume-by",
      delta: -VOLUME_STEP,
    });
  });

  it("maps 0-9 onto tenths of the duration, with 0 at the start", () => {
    expect(resolveShortcut(key("0"), PLAYING)?.action).toEqual({
      kind: "seek-to-fraction",
      fraction: 0,
    });
    expect(resolveShortcut(key("7"), PLAYING)?.action).toEqual({
      kind: "seek-to-fraction",
      fraction: 0.7,
    });
    expect(resolveShortcut(key("9"), PLAYING)?.action).toEqual({
      kind: "seek-to-fraction",
      fraction: 0.9,
    });
  });

  it("maps Home and End onto the ends", () => {
    expect(resolveShortcut(key("Home"), PLAYING)?.action).toEqual({
      kind: "seek-to-fraction",
      fraction: 0,
    });
    expect(resolveShortcut(key("End"), PLAYING)?.action).toEqual({
      kind: "seek-to-fraction",
      fraction: 1,
    });
  });

  it("maps f, t, i, m to the view and audio toggles", () => {
    expect(resolveShortcut(key("f"), PLAYING)?.action).toEqual({ kind: "toggle-fullscreen" });
    // §6 marks `t` as corroborated by the in-player panel only — it is not on
    // the official help page. Implemented, and flagged where it is decided.
    expect(resolveShortcut(key("t"), PLAYING)?.action).toEqual({ kind: "toggle-theatre" });
    expect(resolveShortcut(key("i"), PLAYING)?.action).toEqual({ kind: "toggle-miniplayer" });
    expect(resolveShortcut(key("m"), PLAYING)?.action).toEqual({ kind: "toggle-mute" });
  });

  it("maps < and > onto the speed ladder", () => {
    expect(resolveShortcut(key("<"), PLAYING)?.action).toEqual({
      kind: "speed-step",
      direction: -1,
    });
    expect(resolveShortcut(key(">"), PLAYING)?.action).toEqual({
      kind: "speed-step",
      direction: 1,
    });
  });
});

describe("resolveShortcut — the preconditions §6 says to build in", () => {
  it("steps frames only while paused", () => {
    // §6: "`,` (comma) | Previous frame — **only while paused**".
    expect(resolveShortcut(key(","), PLAYING)).toBeNull();
    expect(resolveShortcut(key("."), PLAYING)).toBeNull();

    const paused = { ...PLAYING, paused: true };
    expect(resolveShortcut(key(","), paused)?.action).toEqual({
      kind: "frame-step",
      seconds: -1 / ASSUMED_FRAME_RATE,
    });
    expect(resolveShortcut(key("."), paused)?.action).toEqual({
      kind: "frame-step",
      seconds: 1 / ASSUMED_FRAME_RATE,
    });
  });

  it("steps a real frame when the rendition reported a frame rate", () => {
    const paused = { ...PLAYING, paused: true, frameRate: 60 };
    expect(resolveShortcut(key("."), paused)?.action).toEqual({
      kind: "frame-step",
      seconds: 1 / 60,
    });
  });

  it("makes c inert when the video has no caption track", () => {
    // §6: "Toggle captions/subtitles on/off (**if available**)".
    expect(
      resolveShortcut(key("c"), { ...PLAYING, captionsAvailable: false }),
    ).toBeNull();
    expect(resolveShortcut(key("c"), PLAYING)?.action).toEqual({
      kind: "toggle-captions",
    });
  });

  it("gates o, w, + and - on captions already being on", () => {
    // §6: all four are "only while captions are on". With captions off they
    // must be no-ops rather than acting on a layer that is not rendering.
    for (const k of ["o", "w", "+", "-"]) {
      expect(resolveShortcut(key(k), PLAYING)).toBeNull();
    }
    const on = { ...PLAYING, captionsOn: true };
    expect(resolveShortcut(key("o"), on)?.action).toEqual({ kind: "caption-text-opacity" });
    expect(resolveShortcut(key("w"), on)?.action).toEqual({ kind: "caption-window-opacity" });
    expect(resolveShortcut(key("+"), on)?.action).toEqual({
      kind: "caption-font-size",
      direction: 1,
    });
    expect(resolveShortcut(key("-"), on)?.action).toEqual({
      kind: "caption-font-size",
      direction: -1,
    });
  });
});

describe("resolveShortcut — scope, and modifiers", () => {
  it("marks /, Shift+N, Shift+P and Escape as global and the rest as player", () => {
    // §6's "Scope" column. The distinction is what lets a surface with no
    // player install only half the map.
    expect(resolveShortcut(key("/"), PLAYING)?.scope).toBe("global");
    expect(resolveShortcut(key("N", { shiftKey: true }), PLAYING)?.scope).toBe("global");
    expect(resolveShortcut(key("P", { shiftKey: true }), PLAYING)?.scope).toBe("global");
    expect(resolveShortcut(key("Escape"), PLAYING)?.scope).toBe("global");
    expect(resolveShortcut(key("k"), PLAYING)?.scope).toBe("player");
  });

  it("ignores every binding while ctrl, meta or alt is held", () => {
    // ⌘L focuses the address bar and Ctrl+F opens find. A player that seeks on
    // either has stolen a key the browser owns.
    for (const modifier of ["ctrlKey", "metaKey", "altKey"] as const) {
      expect(resolveShortcut(key("l", { [modifier]: true }), PLAYING)).toBeNull();
      expect(resolveShortcut(key("f", { [modifier]: true }), PLAYING)).toBeNull();
      expect(resolveShortcut(key(" ", { [modifier]: true }), PLAYING)).toBeNull();
    }
  });

  it("returns null for a key it does not own", () => {
    expect(resolveShortcut(key("q"), PLAYING)).toBeNull();
    expect(resolveShortcut(key("Tab"), PLAYING)).toBeNull();
  });
});

describe("isTypingContext — §6.1's do-not-steal rule", () => {
  it("matches the four surfaces §6.1 lists", () => {
    for (const tag of ["INPUT", "TEXTAREA", "SELECT"]) {
      expect(isTypingContext({ tagName: tag } as unknown as EventTarget)).toBe(true);
    }
    expect(
      isTypingContext({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget),
    ).toBe(true);
  });

  it("matches a real search box and a real comment composer", () => {
    // The two elements that actually sit on the watch page: the masthead's
    // `input[name=search_query]` and the composer's `<textarea>`.
    const input = document.createElement("input");
    input.setAttribute("name", "search_query");
    const textarea = document.createElement("textarea");
    expect(isTypingContext(input)).toBe(true);
    expect(isTypingContext(textarea)).toBe(true);
  });

  it("does not match the player, a button or the document body", () => {
    expect(isTypingContext(document.body)).toBe(false);
    expect(isTypingContext(document.createElement("button"))).toBe(false);
    expect(isTypingContext(document.createElement("video"))).toBe(false);
    expect(isTypingContext(null)).toBe(false);
  });

  it("treats a role=textbox div as a typing context", () => {
    const div = document.createElement("div");
    div.setAttribute("role", "textbox");
    expect(isTypingContext(div)).toBe(true);
  });

  it("is case-insensitive about the tag name", () => {
    // A target that crossed a shadow boundary, or a literal in a test, can
    // report a lowercase tag. Treating that as "safe to steal from" is the
    // failure mode this guards.
    expect(isTypingContext({ tagName: "input" } as unknown as EventTarget)).toBe(true);
  });
});

describe("steppedPlaybackRate", () => {
  it("clamps rather than wrapping at both ends", () => {
    const slowest = PLAYBACK_RATES[0] ?? 0;
    const fastest = PLAYBACK_RATES[PLAYBACK_RATES.length - 1] ?? 0;
    expect(steppedPlaybackRate(slowest, -1)).toBe(slowest);
    expect(steppedPlaybackRate(fastest, 1)).toBe(fastest);
  });

  it("moves one rung at a time", () => {
    expect(steppedPlaybackRate(1, 1)).toBe(1.25);
    expect(steppedPlaybackRate(1, -1)).toBe(0.75);
  });

  it("snaps an off-ladder rate to the nearest rung in the asked-for direction", () => {
    expect(steppedPlaybackRate(1.1, 1)).toBe(1.25);
    expect(steppedPlaybackRate(1.1, -1)).toBe(1);
  });
});
