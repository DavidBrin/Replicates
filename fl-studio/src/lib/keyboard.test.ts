import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetKeyboardRegistryForTests,
  CUSTOM_SLIDER_KEYS,
  RANGE_INPUT_KEYS,
  attachKeyboardListener,
  claimHandledKey,
  comboMatches,
  dispatchKeyEvent,
  getAllBindings,
  handleRangeInputKeyDown,
  registerBindings,
} from "./keyboard";

function keydown(init: Partial<KeyboardEventInit> & { code: string }) {
  return new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
}

afterEach(() => {
  __resetKeyboardRegistryForTests();
});

describe("keyboard registry", () => {
  it("registers bindings under a surface id and lists them", () => {
    const handler = vi.fn();
    registerBindings("surface-a", [{ id: "a", code: "Space", handler }]);
    expect(getAllBindings()).toHaveLength(1);
  });

  it("dispatches the matching binding's handler", () => {
    const handler = vi.fn();
    registerBindings("shell:global", [{ id: "play", code: "Space", handler }]);

    const fired = dispatchKeyEvent(keydown({ code: "Space" }));

    expect(fired).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch when no combo matches", () => {
    const handler = vi.fn();
    registerBindings("shell:global", [{ id: "play", code: "Space", handler }]);

    const fired = dispatchKeyEvent(keydown({ code: "KeyA" }));

    expect(fired).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it("distinguishes Ctrl+Z from Ctrl+Shift+Z and Ctrl+Y", () => {
    const undo = vi.fn();
    const redo = vi.fn();
    registerBindings("shell:global", [
      { id: "undo", code: "KeyZ", ctrl: true, handler: undo },
      { id: "redo-shift-z", code: "KeyZ", ctrl: true, shift: true, handler: redo },
      { id: "redo-y", code: "KeyY", ctrl: true, handler: redo },
    ]);

    dispatchKeyEvent(keydown({ code: "KeyZ", ctrlKey: true }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).not.toHaveBeenCalled();

    dispatchKeyEvent(keydown({ code: "KeyZ", ctrlKey: true, shiftKey: true }));
    expect(redo).toHaveBeenCalledTimes(1);

    dispatchKeyEvent(keydown({ code: "KeyY", ctrlKey: true }));
    expect(redo).toHaveBeenCalledTimes(2);
  });

  it("calls preventDefault by default and respects preventDefault: false", () => {
    const handler = vi.fn();
    registerBindings("shell:global", [{ id: "a", code: "Space", handler }]);
    const withDefault = keydown({ code: "Space" });
    const preventSpy = vi.spyOn(withDefault, "preventDefault");
    dispatchKeyEvent(withDefault);
    expect(preventSpy).toHaveBeenCalled();

    __resetKeyboardRegistryForTests();
    registerBindings("shell:global", [
      { id: "a", code: "Space", handler, preventDefault: false },
    ]);
    const withoutDefault = keydown({ code: "Space" });
    const preventSpy2 = vi.spyOn(withoutDefault, "preventDefault");
    dispatchKeyEvent(withoutDefault);
    expect(preventSpy2).not.toHaveBeenCalled();
  });

  it("comboMatches is exact on every modifier", () => {
    expect(
      comboMatches(keydown({ code: "KeyL" }), { code: "KeyL" }),
    ).toBe(true);
    expect(
      comboMatches(keydown({ code: "KeyL", altKey: true }), { code: "KeyL" }),
    ).toBe(false);
  });

  it("re-registering under the same surface id replaces its prior bindings", () => {
    const first = vi.fn();
    const second = vi.fn();
    registerBindings("surface-a", [{ id: "a", code: "Space", handler: first }]);
    registerBindings("surface-a", [{ id: "b", code: "Space", handler: second }]);

    dispatchKeyEvent(keydown({ code: "Space" }));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("attachKeyboardListener wires dispatch to a real event target", () => {
    const handler = vi.fn();
    registerBindings("shell:global", [{ id: "play", code: "Space", handler }]);
    const target = new EventTarget();

    const detach = attachKeyboardListener(target);
    target.dispatchEvent(keydown({ code: "Space" }));
    expect(handler).toHaveBeenCalledTimes(1);

    detach();
    target.dispatchEvent(keydown({ code: "Space" }));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------- typing-target guard --- */

describe("bindings do not fire while the user is typing", () => {
  /*
   * The listener is attached for real rather than calling `dispatchKeyEvent`
   * directly. Dispatching on a detached element with nothing listening makes
   * every "does not fire" assertion pass for the wrong reason — which is
   * exactly what the first draft of this block did.
   */
  let detach: (() => void) | null = null;

  beforeEach(() => {
    detach = attachKeyboardListener(window);
  });

  afterEach(() => {
    detach?.();
    detach = null;
  });

  function fireFrom(target: Element, init: Partial<KeyboardEventInit> & { code: string }) {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    target.dispatchEvent(event);
    return event;
  }

  function mount<T extends Element>(element: T): T {
    document.body.appendChild(element);
    return element;
  }

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("skips a digit binding while a number input has focus (the BPM box)", () => {
    const mute = vi.fn();
    registerBindings("channel-rack", [{ id: "mute-1", code: "Digit1", handler: mute }]);
    const input = mount(document.createElement("input"));
    input.type = "number";

    const event = fireFrom(input, { code: "Digit1" });

    expect(mute).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it.each(["Space", "Backspace"])("skips %s while a text input has focus", (code) => {
    const handler = vi.fn();
    registerBindings("shell:global", [{ id: code, code, handler }]);
    const input = mount(document.createElement("input"));

    fireFrom(input, { code });

    expect(handler).not.toHaveBeenCalled();
  });

  it("skips Ctrl+A while typing, so the input's own select-all still works", () => {
    const selectAll = vi.fn();
    registerBindings("piano-roll", [
      { id: "select-all", code: "KeyA", ctrl: true, handler: selectAll },
    ]);
    const textarea = mount(document.createElement("textarea"));

    const event = fireFrom(textarea, { code: "KeyA", ctrlKey: true });

    expect(selectAll).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("skips inside a <select> and inside contenteditable", () => {
    const handler = vi.fn();
    registerBindings("shell:global", [{ id: "play", code: "Space", handler }]);

    fireFrom(mount(document.createElement("select")), { code: "Space" });
    const editable = mount(document.createElement("div"));
    editable.setAttribute("contenteditable", "true");
    // jsdom does not implement `isContentEditable` off the attribute.
    Object.defineProperty(editable, "isContentEditable", { value: true });
    fireFrom(editable, { code: "Space" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("still fires from a plain element, a button, and a checkbox", () => {
    const handler = vi.fn();
    registerBindings("shell:global", [{ id: "play", code: "Space", handler }]);

    fireFrom(mount(document.createElement("div")), { code: "Space" });
    fireFrom(mount(document.createElement("button")), { code: "Space" });
    const checkbox = mount(document.createElement("input"));
    checkbox.type = "checkbox";
    fireFrom(checkbox, { code: "Space" });

    expect(handler).toHaveBeenCalledTimes(3);
  });

  /*
   * Round 10 #8. The guard protects TEXT, and a range slider holds none: it
   * was treated as text entry, so every global shortcut died for as long as
   * one had focus — adjust the swing slider and `Ctrl+Z`, `Ctrl+S` and
   * `Space` were all silently gone, with nothing on screen to explain it.
   */
  describe("a range slider is not text entry (round 10 #8)", () => {
    function range(): HTMLInputElement {
      const input = mount(document.createElement("input"));
      input.type = "range";
      return input;
    }

    it.each([
      ["undo", { code: "KeyZ", ctrlKey: true }],
      ["save", { code: "KeyS", ctrlKey: true }],
      ["play/stop", { code: "Space", ctrlKey: false }],
    ])("runs the global %s binding from a focused slider", (_name, init) => {
      const handler = vi.fn();
      registerBindings("shell:global", [
        { id: "b", code: init.code, ctrl: init.ctrlKey, handler },
      ]);

      fireFrom(range(), init);

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("still guards a text input beside it", () => {
      // The trade is narrow on purpose: a slider gains the shortcuts, a text
      // box keeps its characters.
      const handler = vi.fn();
      registerBindings("shell:global", [{ id: "play", code: "Space", handler }]);

      const text = mount(document.createElement("input"));
      text.type = "text";
      fireFrom(text, { code: "Space" });

      expect(handler).not.toHaveBeenCalled();
    });

    it("does not reach the registry for a key the slider handles itself", () => {
      // The narrow half: `handleRangeInputKeyDown` stops the arrow keys at
      // the control, so letting the registry run from sliders cannot make
      // ArrowUp both nudge the slider and transpose the piano roll.
      const handler = vi.fn();
      registerBindings("piano-roll", [{ id: "transpose", code: "ArrowUp", handler }]);
      const slider = range();
      slider.addEventListener("keydown", (event) => handleRangeInputKeyDown(event));

      const event = fireFrom(slider, { code: "ArrowUp", key: "ArrowUp" });

      expect(handler).not.toHaveBeenCalled();
      // …and the slider's OWN behaviour survives: the browser default is how
      // an arrow key moves a range input at all.
      expect(event.defaultPrevented).toBe(false);
    });
  });

  it("fires a binding that opted in with worksInInputs", () => {
    const escape = vi.fn();
    registerBindings("shell:global", [
      { id: "escape", code: "Escape", worksInInputs: true, handler: escape },
    ]);

    fireFrom(mount(document.createElement("input")), { code: "Escape" });

    expect(escape).toHaveBeenCalledTimes(1);
  });

  it("guards the real window listener too, not just direct dispatch", () => {
    const handler = vi.fn();
    registerBindings("shell:global", [{ id: "play", code: "Space", handler }]);
    const input = mount(document.createElement("input"));

    fireFrom(input, { code: "Space" });
    expect(handler).not.toHaveBeenCalled();

    fireFrom(mount(document.createElement("div")), { code: "Space" });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

/*
 * Round 10 #7. The registry listens on the WINDOW, above React's root
 * container, so a key a control handles reaches it afterwards and fires a
 * second, unrelated action: `Space` on a knob reset the knob AND started
 * playback. No guard in this module can see a `role="slider"` div — it is not
 * a form control — so the control claims the key at the source instead.
 */
describe("claimHandledKey", () => {
  function event(key: string) {
    return {
      key,
      stopped: false,
      prevented: false,
      stopPropagation() {
        this.stopped = true;
      },
      preventDefault() {
        this.prevented = true;
      },
    };
  }

  it("stops a handled key from propagating, and suppresses its default", () => {
    const e = event(" ");
    expect(claimHandledKey(e, CUSTOM_SLIDER_KEYS)).toBe(true);
    expect(e.stopped).toBe(true);
    expect(e.prevented).toBe(true);
  });

  it("leaves an unhandled key entirely alone", () => {
    // A knob must not swallow Ctrl+Z just because it has focus.
    const e = event("z");
    expect(claimHandledKey(e, CUSTOM_SLIDER_KEYS)).toBe(false);
    expect(e.stopped).toBe(false);
    expect(e.prevented).toBe(false);
  });

  it("can claim WITHOUT suppressing the default — the native slider case", () => {
    // A native range input IS its browser default; preventing it would stop
    // the arrow keys moving the slider at all.
    const e = event("ArrowUp");
    expect(claimHandledKey(e, RANGE_INPUT_KEYS, { preventDefault: false })).toBe(true);
    expect(e.stopped).toBe(true);
    expect(e.prevented).toBe(false);
  });

  it("handleRangeInputKeyDown claims exactly the keys a range input acts on", () => {
    for (const key of RANGE_INPUT_KEYS) {
      const e = event(key);
      handleRangeInputKeyDown(e);
      expect(e.stopped, key).toBe(true);
      expect(e.prevented, key).toBe(false);
    }
    const passthrough = event("z");
    handleRangeInputKeyDown(passthrough);
    expect(passthrough.stopped).toBe(false);
  });
});
