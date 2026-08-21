import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __resetKeyboardRegistryForTests,
  attachKeyboardListener,
  comboMatches,
  dispatchKeyEvent,
  getAllBindings,
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
