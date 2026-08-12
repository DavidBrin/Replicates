import { afterEach, describe, expect, it, vi } from "vitest";

import { Btn, held, pressed, released } from "@/engine/types";
import {
  FOCUS_OVERLAY_ID,
  KeyboardInput,
  STICKY_KEYS_WARNING,
  createKeyboardInput,
  schemeWarnings,
} from "./keyboard";
import { CONFIG_ARROWS, CONFIG_LOCAL_P2, CONFIG_WASD, SchemeConflictError } from "./schemes";

let live: KeyboardInput | null = null;

function makeInput(...args: ConstructorParameters<typeof KeyboardInput>): KeyboardInput {
  const kb = new KeyboardInput(...args);
  kb.attach();
  live = kb;
  return kb;
}

function keydown(code: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { code, cancelable: true, bubbles: true, ...init });
  window.dispatchEvent(event);
  return event;
}

function keyup(code: string): KeyboardEvent {
  const event = new KeyboardEvent("keyup", { code, cancelable: true, bubbles: true });
  window.dispatchEvent(event);
  return event;
}

afterEach(() => {
  live?.detach();
  live = null;
});

describe("latching: a tap between two frames must not vanish", () => {
  it("keeps a press and release that both happen inside one frame gap", () => {
    const kb = makeInput([{ port: 0, scheme: CONFIG_ARROWS }]);
    const before = kb.drain().frames[0];

    // The entire jump input happens between two ticks. Sampling "is the key
    // down now?" at the next tick would see nothing at all, and the short hop
    // would silently not happen.
    keydown("KeyW");
    keyup("KeyW");

    const tap = kb.drain();
    expect(held(tap.frames[0], Btn.Jump)).toBe(true);
    expect(pressed(tap.frames[0], before, Btn.Jump)).toBe(true);

    // ...and it lasts exactly one frame, so the release lands inside the
    // 3-frame jumpsquat and the engine reads a short hop.
    const after = kb.drain();
    expect(held(after.frames[0], Btn.Jump)).toBe(false);
    expect(released(after.frames[0], tap.frames[0], Btn.Jump)).toBe(true);
  });

  it("reports a key held across ticks on every one of them", () => {
    const kb = makeInput([{ port: 0, scheme: CONFIG_ARROWS }]);
    keydown("ArrowRight");

    expect(held(kb.drain().frames[0], Btn.Right)).toBe(true);
    expect(held(kb.drain().frames[0], Btn.Right)).toBe(true);

    keyup("ArrowRight");
    expect(held(kb.drain().frames[0], Btn.Right)).toBe(false);
  });

  it("does not turn OS auto-repeat into a stream of fresh presses", () => {
    const kb = makeInput([{ port: 0, scheme: CONFIG_ARROWS }]);
    keydown("KeyW");
    kb.drain();

    keydown("KeyW", { repeat: true });
    keydown("KeyW", { repeat: true });

    const next = kb.drain();
    expect(held(next.frames[0], Btn.Jump)).toBe(true);
    expect(next.pressed[0] & Btn.Jump).toBe(0);
  });

  it("drains destructively: the edges are consumed exactly once", () => {
    const kb = makeInput([{ port: 0, scheme: CONFIG_ARROWS }]);
    keydown("KeyQ");
    keyup("KeyQ");

    expect(kb.peek()[0] & Btn.Grab).toBe(Btn.Grab);
    expect(kb.drain().frames[0] & Btn.Grab).toBe(Btn.Grab);
    expect(kb.drain().frames[0] & Btn.Grab).toBe(0);
  });

  it("routes each preset to its own port", () => {
    const kb = makeInput([
      { port: 0, scheme: CONFIG_ARROWS },
      { port: 1, scheme: CONFIG_LOCAL_P2 },
    ]);

    keydown("ArrowLeft"); // P1 left
    keydown("KeyF"); // P2 left
    keydown("KeyL"); // P2 attack

    const { frames } = kb.drain();
    expect(held(frames[0], Btn.Left)).toBe(true);
    expect(held(frames[0], Btn.Attack)).toBe(false);
    expect(held(frames[1], Btn.Left)).toBe(true);
    expect(held(frames[1], Btn.Attack)).toBe(true);
  });
});

describe("preventDefault", () => {
  it("cancels every bound key and nothing else", () => {
    makeInput([{ port: 0, scheme: CONFIG_ARROWS }]);

    // Arrows scroll the page; the whole action cluster would otherwise reach
    // browser shortcuts.
    for (const code of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyQ"]) {
      expect(keydown(code).defaultPrevented, `${code} keydown`).toBe(true);
      expect(keyup(code).defaultPrevented, `${code} keyup`).toBe(true);
    }

    for (const code of ["KeyZ", "F5", "Tab", "Slash"]) {
      expect(keydown(code).defaultPrevented, `${code} keydown`).toBe(false);
      expect(keyup(code).defaultPrevented, `${code} keyup`).toBe(false);
    }
  });

  it("cancels Slash for the preset that binds it, so Quick Find stays shut", () => {
    makeInput([{ port: 0, scheme: CONFIG_WASD }]);
    expect(keydown("Slash").defaultPrevented).toBe(true);
  });

  it("leaves text fields alone, so the rebinding UI is usable", () => {
    const kb = makeInput([{ port: 0, scheme: CONFIG_ARROWS }]);
    const field = document.createElement("input");
    document.body.appendChild(field);

    const event = new KeyboardEvent("keydown", { code: "KeyW", cancelable: true, bubbles: true });
    field.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(kb.drain().frames[0]).toBe(0);
    field.remove();
  });
});

describe("focus", () => {
  it("releases everything on blur, because the keyup goes elsewhere", () => {
    const onFocusChange = vi.fn();
    const kb = makeInput([{ port: 0, scheme: CONFIG_ARROWS }], { onFocusChange });

    keydown("ArrowRight");
    expect(held(kb.drain().frames[0], Btn.Right)).toBe(true);

    window.dispatchEvent(new Event("blur"));

    expect(kb.focused).toBe(false);
    expect(onFocusChange).toHaveBeenCalledWith(false);
    // Without this the fighter keeps running right, forever, into the blast
    // zone — the `keyup` was delivered to whatever stole focus.
    expect(kb.drain().frames[0]).toBe(0);
  });

  it("shows a click-to-focus overlay while unfocused, and hides it on click", () => {
    const kb = makeInput([{ port: 0, scheme: CONFIG_ARROWS }]);
    const overlay = document.getElementById(FOCUS_OVERLAY_ID);
    expect(overlay).not.toBeNull();
    expect(overlay!.style.display).toBe("none");

    window.dispatchEvent(new Event("blur"));
    expect(overlay!.style.display).toBe("flex");
    expect(overlay!.textContent).toContain("every local player");

    overlay!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(kb.focused).toBe(true);
    expect(overlay!.style.display).toBe("none");
  });

  it("regains focus on the first key after a blur", () => {
    const kb = makeInput([{ port: 0, scheme: CONFIG_ARROWS }]);
    window.dispatchEvent(new Event("blur"));
    expect(kb.focused).toBe(false);

    keydown("KeyD");
    expect(kb.focused).toBe(true);
  });

  it("removes its listeners and its overlay on detach", () => {
    const kb = makeInput([{ port: 0, scheme: CONFIG_ARROWS }]);
    kb.detach();
    live = null;

    expect(document.getElementById(FOCUS_OVERLAY_ID)).toBeNull();
    expect(keydown("KeyW").defaultPrevented).toBe(false);
    expect(kb.drain().frames[0]).toBe(0);
  });

  it("can be built without an overlay for callers that render their own", () => {
    makeInput([{ port: 0, scheme: CONFIG_ARROWS }], { overlayHost: null });
    expect(document.getElementById(FOCUS_OVERLAY_ID)).toBeNull();
  });
});

describe("the UI-facing surface", () => {
  it("refuses two schemes that share a physical key", () => {
    expect(
      () =>
        new KeyboardInput([
          { port: 0, scheme: CONFIG_ARROWS },
          { port: 1, scheme: CONFIG_WASD },
        ]),
    ).toThrow(SchemeConflictError);
  });

  it("warns about Sticky Keys for the preset that holds Shift", () => {
    expect(schemeWarnings(CONFIG_WASD)).toEqual([STICKY_KEYS_WARNING]);
    expect(schemeWarnings(CONFIG_ARROWS)).toEqual([]);
    expect(schemeWarnings(CONFIG_LOCAL_P2)).toEqual([]);

    const kb = makeInput([{ port: 0, scheme: CONFIG_WASD }]);
    expect(kb.warnings).toEqual([STICKY_KEYS_WARNING]);
    expect(STICKY_KEYS_WARNING).toContain("Sticky Keys");
  });

  it("lists every key it will swallow", () => {
    const kb = makeInput([{ port: 0, scheme: CONFIG_ARROWS }]);
    expect(kb.boundCodes.sort()).toEqual(
      ["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "KeyA", "KeyD", "KeyE", "KeyQ", "KeyW"].sort(),
    );
  });

  it("has a factory that behaves like the constructor", () => {
    const kb = createKeyboardInput([{ port: 0, scheme: CONFIG_ARROWS }]);
    live = kb;
    kb.attach();
    keydown("KeyE");
    expect(held(kb.drain().frames[0], Btn.Shield)).toBe(true);
  });
});
