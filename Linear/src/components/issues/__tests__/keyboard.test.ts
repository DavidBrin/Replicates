/**
 * The shortcut dispatcher.
 *
 * The input guard gets the most tests here, and deliberately: this app binds
 * bare `C`, `S`, `A`, `P`, `L` and `X`, so a guard that leaks fires a status
 * picker in the middle of somebody's issue title. `research/04-interaction.md`
 * §1.11 calls it "the single most important correctness detail" and singles out
 * IME composition, which is the case a hand-rolled guard always forgets.
 *
 * Events are dispatched on real DOM nodes rather than passed to `handle`
 * directly, because `event.target` is what the guard reads — constructing an
 * event object with a fake target would test the assertion instead of the code.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  allowedWhileTyping,
  createDispatcher,
  isTypingTarget,
  normaliseKey,
  type Binding,
} from "@/components/issues/keyboard";

interface Harness {
  readonly ran: string[];
  press(
    target: EventTarget,
    init: KeyboardEventInit & { code?: string },
  ): boolean;
  cleanup(): void;
}

function harness(
  bindings: readonly Binding[],
  options: { now?: () => number } = {},
): Harness {
  const ran: string[] = [];
  const withRecording = bindings.map((binding) => ({
    ...binding,
    run: () => {
      ran.push(binding.id);
      binding.run();
    },
  }));

  const dispatcher = createDispatcher({
    bindings: () => withRecording,
    ...(options.now ? { now: options.now } : {}),
  });
  let handled = false;
  const listener = (event: Event): void => {
    handled = dispatcher.handle(event as KeyboardEvent);
  };
  document.addEventListener("keydown", listener);

  return {
    ran,
    press(target, init) {
      handled = false;
      target.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, ...init }),
      );
      return handled;
    },
    cleanup: () => document.removeEventListener("keydown", listener),
  };
}

const noop = (): void => {};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("normaliseKey", () => {
  it("names the physical key, so Shift+1 is not '!'", () => {
    const event = new KeyboardEvent("keydown", {
      key: "!",
      code: "Digit1",
      shiftKey: true,
    });
    expect(normaliseKey(event)).toBe("shift+1");
  });

  it("folds Cmd and Ctrl into one modifier", () => {
    const meta = new KeyboardEvent("keydown", { key: "b", code: "KeyB", metaKey: true });
    const ctrl = new KeyboardEvent("keydown", { key: "b", code: "KeyB", ctrlKey: true });
    expect(normaliseKey(meta)).toBe("mod+b");
    expect(normaliseKey(ctrl)).toBe("mod+b");
  });

  it("keeps named keys as their names", () => {
    expect(
      normaliseKey(new KeyboardEvent("keydown", { key: "Escape", code: "Escape" })),
    ).toBe("Escape");
    expect(
      normaliseKey(
        new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown" }),
      ),
    ).toBe("ArrowDown");
  });

  it("orders the modifiers the same way every time", () => {
    const event = new KeyboardEvent("keydown", {
      key: "P",
      code: "KeyP",
      metaKey: true,
      shiftKey: true,
      altKey: true,
    });
    expect(normaliseKey(event)).toBe("mod+alt+shift+p");
  });

  it("recognises the bracket that toggles the sidebar", () => {
    expect(
      normaliseKey(
        new KeyboardEvent("keydown", { key: "[", code: "BracketLeft" }),
      ),
    ).toBe("[");
  });
});

describe("isTypingTarget", () => {
  function dispatchOn(element: Element, init: KeyboardEventInit): boolean {
    let seen = false;
    const listener = (event: Event): void => {
      seen = isTypingTarget(event as KeyboardEvent);
    };
    document.addEventListener("keydown", listener);
    element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
    document.removeEventListener("keydown", listener);
    return seen;
  }

  it("is true for inputs, textareas and selects", () => {
    for (const tag of ["input", "textarea", "select"]) {
      const element = document.createElement(tag);
      document.body.append(element);
      expect(dispatchOn(element, { key: "s", code: "KeyS" })).toBe(true);
    }
  });

  it("is true for a contenteditable", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    // jsdom does not derive `isContentEditable` from the attribute.
    Object.defineProperty(editor, "isContentEditable", { value: true });
    document.body.append(editor);
    expect(dispatchOn(editor, { key: "s", code: "KeyS" })).toBe(true);
  });

  it("is true anywhere inside a [data-no-shortcuts] subtree", () => {
    const region = document.createElement("div");
    region.dataset.noShortcuts = "";
    const inner = document.createElement("span");
    region.append(inner);
    document.body.append(region);
    expect(dispatchOn(inner, { key: "s", code: "KeyS" })).toBe(true);
  });

  it("is true during an IME composition, whatever the target", () => {
    const button = document.createElement("button");
    document.body.append(button);
    expect(
      dispatchOn(button, { key: "s", code: "KeyS", isComposing: true }),
    ).toBe(true);
  });

  it("is false for an ordinary element", () => {
    const button = document.createElement("button");
    document.body.append(button);
    expect(dispatchOn(button, { key: "s", code: "KeyS" })).toBe(false);
  });
});

describe("allowedWhileTyping", () => {
  it("lets modifier-bearing bindings and Escape through, and nothing else", () => {
    expect(allowedWhileTyping("mod+k")).toBe(true);
    expect(allowedWhileTyping("Escape")).toBe(true);
    expect(allowedWhileTyping("s")).toBe(false);
    expect(allowedWhileTyping("shift+1")).toBe(false);
  });
});

describe("createDispatcher", () => {
  it("runs a matching binding and prevents the default", () => {
    const run = vi.fn();
    const h = harness([{ id: "issue.status", keys: "s", run }]);

    const event = new KeyboardEvent("keydown", {
      key: "s",
      code: "KeyS",
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(event);

    expect(run).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    h.cleanup();
  });

  it("does not fire a bare letter while a text field has focus", () => {
    const h = harness([{ id: "issue.status", keys: "s", run: noop }]);
    const input = document.createElement("input");
    document.body.append(input);

    expect(h.press(input, { key: "s", code: "KeyS" })).toBe(false);
    expect(h.ran).toEqual([]);
    h.cleanup();
  });

  it("still fires a modifier binding while typing", () => {
    const h = harness([{ id: "view.layout", keys: "mod+b", run: noop }]);
    const input = document.createElement("input");
    document.body.append(input);

    expect(h.press(input, { key: "b", code: "KeyB", metaKey: true })).toBe(true);
    expect(h.ran).toEqual(["view.layout"]);
    h.cleanup();
  });

  it("still fires Escape while typing", () => {
    const h = harness([{ id: "list.clear", keys: "Escape", run: noop }]);
    const input = document.createElement("input");
    document.body.append(input);

    expect(h.press(input, { key: "Escape", code: "Escape" })).toBe(true);
    h.cleanup();
  });

  it("respects a `when` guard without swallowing the key", () => {
    let enabled = false;
    const h = harness([
      { id: "issue.status", keys: "s", when: () => enabled, run: noop },
    ]);

    expect(h.press(document.body, { key: "s", code: "KeyS" })).toBe(false);
    enabled = true;
    expect(h.press(document.body, { key: "s", code: "KeyS" })).toBe(true);
    h.cleanup();
  });

  it("resolves a two-key chord", () => {
    const h = harness([{ id: "go.inbox", keys: "g i", run: noop }]);

    expect(h.press(document.body, { key: "g", code: "KeyG" })).toBe(true);
    expect(h.ran).toEqual([]);
    expect(h.press(document.body, { key: "i", code: "KeyI" })).toBe(true);
    expect(h.ran).toEqual(["go.inbox"]);
    h.cleanup();
  });

  it("does not arm a prefix nothing is bound behind", () => {
    const h = harness([{ id: "issue.status", keys: "s", run: noop }]);
    // `G` with no `G …` bindings must fall through, or it swallows the next key.
    expect(h.press(document.body, { key: "g", code: "KeyG" })).toBe(false);
    expect(h.press(document.body, { key: "s", code: "KeyS" })).toBe(true);
    h.cleanup();
  });

  it("cancels the chord on a miss", () => {
    const h = harness([
      { id: "go.inbox", keys: "g i", run: noop },
      { id: "issue.status", keys: "s", run: noop },
    ]);

    h.press(document.body, { key: "g", code: "KeyG" });
    h.press(document.body, { key: "q", code: "KeyQ" });
    // If the buffer survived, this would resolve as "g s" and do nothing.
    expect(h.press(document.body, { key: "s", code: "KeyS" })).toBe(true);
    expect(h.ran).toEqual(["issue.status"]);
    h.cleanup();
  });

  it("forgets an armed chord after the timeout", () => {
    let now = 0;
    const h = harness(
      [
        { id: "go.inbox", keys: "g i", run: noop },
        { id: "issue.assignee", keys: "i", run: noop },
      ],
      { now: () => now },
    );

    h.press(document.body, { key: "g", code: "KeyG" });
    now = 5_000;
    h.press(document.body, { key: "i", code: "KeyI" });

    expect(h.ran).toEqual(["issue.assignee"]);
    h.cleanup();
  });

  it("ignores a bare modifier press so reaching for Shift does not cancel a chord", () => {
    const h = harness([{ id: "go.inbox", keys: "g i", run: noop }]);

    h.press(document.body, { key: "g", code: "KeyG" });
    h.press(document.body, { key: "Shift", code: "ShiftLeft", shiftKey: true });
    h.press(document.body, { key: "i", code: "KeyI" });

    expect(h.ran).toEqual(["go.inbox"]);
    h.cleanup();
  });

  it("matches Shift+1..4 by position, not by the glyph the layout produces", () => {
    const h = harness([{ id: "issue.urgent", keys: "shift+1", run: noop }]);

    expect(
      h.press(document.body, { key: "!", code: "Digit1", shiftKey: true }),
    ).toBe(true);
    expect(h.ran).toEqual(["issue.urgent"]);
    h.cleanup();
  });
});
