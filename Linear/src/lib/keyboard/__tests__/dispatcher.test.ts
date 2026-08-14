import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHORD_TIMEOUT_MS,
  KeyboardDispatcher,
  type BindingInput,
} from "@/lib/keyboard/dispatcher";
import { normalizeKeyEvent } from "@/lib/keyboard/keys";

/**
 * The dispatcher, driven with synthetic events and no React.
 *
 * Every assertion here is a rule from `research/04-interaction.md` §1.11 or
 * §9.6, and each is asserted on its own rather than as one "shortcuts work"
 * test, because each is a rule a reimplementation would plausibly break by
 * itself. The four that matter most — scope precedence, chord timeout, the IME
 * guard and the input-focus guard — are the four that produce silent,
 * intermittent, user-visible damage when they are wrong.
 */

/**
 * Build a `keydown` the way a browser would.
 *
 * `target` is assigned rather than passed because `KeyboardEventInit` has no
 * `target`: the DOM sets it on dispatch. Defining it here lets the test aim an
 * event at an input without mounting anything.
 */
function keydown(
  key: string,
  init: KeyboardEventInit & { target?: EventTarget; code?: string } = {},
): KeyboardEvent {
  const { target, ...rest } = init;
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...rest,
  });
  if (target !== undefined) {
    Object.defineProperty(event, "target", { value: target, enumerable: true });
  }
  return event;
}

let dispatcher: KeyboardDispatcher;
const fired: string[] = [];

/** A binding that records that it ran. Ids come from the real registry. */
function spy(id: string, extra: Partial<BindingInput> = {}): BindingInput {
  return { id, run: () => fired.push(id), ...extra };
}

beforeEach(() => {
  dispatcher = new KeyboardDispatcher();
  fired.length = 0;
});

afterEach(() => {
  dispatcher.dispose();
  vi.useRealTimers();
});

/* ================================================================= scopes = */

describe("scope stack", () => {
  it("gives the key to the topmost scope that claims it", () => {
    dispatcher.register("global", [spy("app.search", { keys: "z" })]);
    dispatcher.register("view", [spy("view.filter", { keys: "z" })]);
    dispatcher.register("selection", [spy("issue.status", { keys: "z" })]);

    dispatcher.handleKeyDown(keydown("z"));
    expect(fired).toEqual(["issue.status"]);
  });

  it("ranks scopes by level, not by registration order", () => {
    // The bug this prevents: React mounts the list *after* the modal that
    // covers it — or re-renders it — and a purely LIFO stack then hands the key
    // to the thing underneath. Registration order here is deliberately wrong.
    dispatcher.register("modal", [spy("app.submit", { keys: "z" })]);
    dispatcher.register("view", [spy("view.filter", { keys: "z" })]);

    dispatcher.handleKeyDown(keydown("z"));
    expect(fired).toEqual(["app.submit"]);
  });

  it("lets the later registration win within one level", () => {
    dispatcher.register("view", [spy("view.filter", { keys: "z" })]);
    dispatcher.register("view", [spy("view.display", { keys: "z" })]);

    dispatcher.handleKeyDown(keydown("z"));
    expect(fired).toEqual(["view.display"]);
  });

  it("stops at a modal — a dialog does not leak keys to the list behind it", () => {
    dispatcher.register("view", [spy("view.filter", { keys: "z" })]);
    dispatcher.register("modal", []);

    const outcome = dispatcher.handleKeyDown(keydown("z"));
    expect(fired).toEqual([]);
    expect(outcome).toEqual({ kind: "ignored", reason: "no-match" });
  });

  it("still lets the palette, submit and undo through a modal", () => {
    dispatcher.register("global", [spy("app.palette")]);
    dispatcher.register("modal", []);

    dispatcher.handleKeyDown(keydown("k", { metaKey: true }));
    expect(fired).toEqual(["app.palette"]);
  });

  it("passes over a binding whose `when` is false and keeps walking down", () => {
    dispatcher.register("global", [spy("app.search", { keys: "z" })]);
    dispatcher.register("selection", [
      spy("issue.status", { keys: "z", when: () => false }),
    ]);

    dispatcher.handleKeyDown(keydown("z"));
    expect(fired).toEqual(["app.search"]);
  });

  it("unregisters exactly the layer it was given", () => {
    const remove = dispatcher.register("selection", [
      spy("issue.status", { keys: "z" }),
    ]);
    dispatcher.register("view", [spy("view.filter", { keys: "z" })]);

    remove();
    dispatcher.handleKeyDown(keydown("z"));
    expect(fired).toEqual(["view.filter"]);
  });
});

/* ================================================================= chords = */

describe("chord buffer", () => {
  it("resolves G then I", () => {
    dispatcher.register("global", [spy("nav.inbox")]);

    const armed = dispatcher.handleKeyDown(keydown("g"));
    expect(armed).toEqual({ kind: "chord", buffer: ["g"] });
    expect(fired).toEqual([]);

    dispatcher.handleKeyDown(keydown("i"));
    expect(fired).toEqual(["nav.inbox"]);
  });

  it("resolves the M relation chords and never fires a bare M", () => {
    dispatcher.register("selection", [
      spy("issue.blockedBy"),
      spy("issue.blocking"),
      spy("issue.related"),
    ]);

    dispatcher.handleKeyDown(keydown("m"));
    dispatcher.handleKeyDown(keydown("x"));
    dispatcher.handleKeyDown(keydown("m"));
    dispatcher.handleKeyDown(keydown("b"));

    expect(fired).toEqual(["issue.blocking", "issue.blockedBy"]);
  });

  it("clears a half-typed chord after the timeout, and the next key is bare", () => {
    // The whole reason the timeout exists: an armed prefix the user has
    // forgotten about turns their next deliberate keystroke into a surprise.
    vi.useFakeTimers();
    dispatcher.register("global", [spy("nav.inbox")]);
    dispatcher.register("selection", [spy("issue.assignToMe")]);

    dispatcher.handleKeyDown(keydown("g"));
    expect(dispatcher.chord).toEqual(["g"]);

    vi.advanceTimersByTime(CHORD_TIMEOUT_MS + 1);
    expect(dispatcher.chord).toEqual([]);

    // `i` alone is "assign to me". Before the timeout it would have been the
    // second half of "go to Inbox".
    dispatcher.handleKeyDown(keydown("i"));
    expect(fired).toEqual(["issue.assignToMe"]);
  });

  it("keeps the chord alive right up to the timeout", () => {
    vi.useFakeTimers();
    dispatcher.register("global", [spy("nav.inbox")]);

    dispatcher.handleKeyDown(keydown("g"));
    vi.advanceTimersByTime(CHORD_TIMEOUT_MS - 1);
    dispatcher.handleKeyDown(keydown("i"));

    expect(fired).toEqual(["nav.inbox"]);
  });

  it("cancels the chord on any miss", () => {
    dispatcher.register("global", [spy("nav.inbox")]);

    dispatcher.handleKeyDown(keydown("g"));
    const outcome = dispatcher.handleKeyDown(keydown("q"));

    expect(outcome).toEqual({ kind: "chord-cancelled", buffer: ["g"] });
    expect(dispatcher.chord).toEqual([]);
    expect(fired).toEqual([]);
  });

  it("does not arm a prefix nobody has bound a chord under", () => {
    // `g` is a live prefix in the registry, but with no G-chord registered the
    // key must fall through rather than eat the following keystroke.
    dispatcher.register("selection", [spy("issue.status")]);

    expect(dispatcher.handleKeyDown(keydown("g"))).toEqual({
      kind: "ignored",
      reason: "no-match",
    });
    dispatcher.handleKeyDown(keydown("s"));
    expect(fired).toEqual(["issue.status"]);
  });

  it("does not arm a chord from a modifier-bearing key", () => {
    dispatcher.register("global", [spy("nav.inbox")]);

    const outcome = dispatcher.handleKeyDown(keydown("g", { metaKey: true }));
    expect(outcome).toEqual({ kind: "ignored", reason: "no-match" });
    expect(dispatcher.chord).toEqual([]);
  });

  it("announces the armed prefix to subscribers", () => {
    const seen: string[][] = [];
    dispatcher.onChordChange((buffer) => seen.push([...buffer]));
    dispatcher.register("global", [spy("nav.inbox")]);

    dispatcher.handleKeyDown(keydown("g"));
    dispatcher.handleKeyDown(keydown("i"));

    expect(seen).toEqual([["g"], []]);
  });
});

/* ============================================================== IME guard = */

describe("IME guard", () => {
  it("never dispatches while a composition is in progress", () => {
    // Without this, a Japanese, Chinese or Korean user typing an issue title
    // reassigns the issue and changes its status as a side effect of writing a
    // sentence. `research/04-interaction.md` §9.6 calls it the number one cause.
    dispatcher.register("selection", [spy("issue.status")]);

    const outcome = dispatcher.handleKeyDown(
      keydown("s", { isComposing: true }),
    );

    expect(outcome).toEqual({ kind: "ignored", reason: "composing" });
    expect(fired).toEqual([]);
  });

  it("honours the legacy keyCode 229 signal as well", () => {
    dispatcher.register("selection", [spy("issue.status")]);
    const event = keydown("s");
    Object.defineProperty(event, "keyCode", { value: 229 });

    expect(dispatcher.handleKeyDown(event)).toEqual({
      kind: "ignored",
      reason: "composing",
    });
    expect(fired).toEqual([]);
  });

  it("does not cancel an armed chord mid-composition", () => {
    // A composition keystroke is not a miss — it is not aimed at us at all.
    dispatcher.register("global", [spy("nav.inbox")]);

    dispatcher.handleKeyDown(keydown("g"));
    dispatcher.handleKeyDown(keydown("あ", { isComposing: true }));
    expect(dispatcher.chord).toEqual(["g"]);
  });

  it("does not cancel an armed chord on a bare modifier press", () => {
    dispatcher.register("selection", [spy("issue.blockedBy")]);

    dispatcher.handleKeyDown(keydown("m"));
    dispatcher.handleKeyDown(keydown("Shift", { shiftKey: true }));
    expect(dispatcher.chord).toEqual(["m"]);
  });
});

/* ============================================================ input guard = */

describe("input guard", () => {
  const inputs: HTMLElement[] = [];

  function field(tag: "input" | "textarea" | "div"): HTMLElement {
    const node = document.createElement(tag);
    if (tag === "div") node.setAttribute("contenteditable", "true");
    document.body.append(node);
    inputs.push(node);
    return node;
  }

  afterEach(() => {
    for (const node of inputs) node.remove();
    inputs.length = 0;
  });

  it("never fires a bare letter while a text input has focus", () => {
    dispatcher.register("selection", [spy("issue.status")]);

    const outcome = dispatcher.handleKeyDown(
      keydown("s", { target: field("input") }),
    );

    expect(outcome).toEqual({ kind: "ignored", reason: "typing" });
    expect(fired).toEqual([]);
  });

  it("never fires a bare letter while a textarea has focus", () => {
    dispatcher.register("selection", [spy("issue.status")]);
    dispatcher.handleKeyDown(keydown("s", { target: field("textarea") }));
    expect(fired).toEqual([]);
  });

  it("never fires a bare letter inside a contenteditable", () => {
    const editable = field("div");
    // jsdom does not implement `isContentEditable`, so the attribute is set
    // above and the property is defined here. Both are how a real editor
    // presents itself, and the guard has to see the property.
    Object.defineProperty(editable, "isContentEditable", { value: true });
    dispatcher.register("selection", [spy("issue.status")]);

    dispatcher.handleKeyDown(keydown("s", { target: editable }));
    expect(fired).toEqual([]);
  });

  it("suppresses Shift-only bindings while typing — Shift+D is just an uppercase D", () => {
    dispatcher.register("selection", [spy("issue.dueDate")]);

    dispatcher.handleKeyDown(
      keydown("D", { shiftKey: true, target: field("input") }),
    );
    expect(fired).toEqual([]);
  });

  it("still lets Cmd+K through from inside a text field", () => {
    dispatcher.register("global", [spy("app.palette")]);

    dispatcher.handleKeyDown(
      keydown("k", { metaKey: true, target: field("input") }),
    );
    expect(fired).toEqual(["app.palette"]);
  });

  it("respects the data-no-shortcuts opt-out on an ancestor", () => {
    const container = document.createElement("div");
    container.setAttribute("data-no-shortcuts", "");
    const inner = document.createElement("span");
    container.append(inner);
    document.body.append(container);
    inputs.push(container);

    dispatcher.register("selection", [spy("issue.status")]);
    dispatcher.handleKeyDown(keydown("s", { target: inner }));
    expect(fired).toEqual([]);
  });

  it("cancels an armed chord when the next key goes to a text field", () => {
    dispatcher.register("global", [spy("nav.inbox")]);

    dispatcher.handleKeyDown(keydown("g"));
    dispatcher.handleKeyDown(keydown("i", { target: field("input") }));

    expect(dispatcher.chord).toEqual([]);
    expect(fired).toEqual([]);
  });
});

/* =========================================================== escape ladder = */

describe("escape ladder", () => {
  it("closes one level per press: picker, then modal, then selection", () => {
    const closed: string[] = [];
    const layer = (id: string) => {
      let open = true;
      const remove = dispatcher.pushEscapeLayer({
        id,
        close: () => {
          if (!open) return false;
          open = false;
          closed.push(id);
          remove();
          return true;
        },
      });
    };

    layer("selection");
    layer("modal");
    layer("picker");

    dispatcher.handleKeyDown(keydown("Escape"));
    expect(closed).toEqual(["picker"]);

    dispatcher.handleKeyDown(keydown("Escape"));
    expect(closed).toEqual(["picker", "modal"]);

    dispatcher.handleKeyDown(keydown("Escape"));
    expect(closed).toEqual(["picker", "modal", "selection"]);
  });

  it("cancels an armed chord before it closes anything", () => {
    // Otherwise pressing G by mistake and reaching for Escape closes the dialog
    // you were standing in.
    const closed: string[] = [];
    dispatcher.pushEscapeLayer({
      id: "modal",
      close: () => {
        closed.push("modal");
        return true;
      },
    });
    dispatcher.register("global", [spy("nav.inbox")]);

    dispatcher.handleKeyDown(keydown("g"));
    const outcome = dispatcher.handleKeyDown(keydown("Escape"));

    expect(outcome).toEqual({ kind: "chord-cancelled", buffer: ["g"] });
    expect(closed).toEqual([]);

    dispatcher.handleKeyDown(keydown("Escape"));
    expect(closed).toEqual(["modal"]);
  });

  it("falls to the rung below when the top one declines", () => {
    const closed: string[] = [];
    dispatcher.pushEscapeLayer({
      id: "list",
      close: () => {
        closed.push("list");
        return true;
      },
    });
    dispatcher.pushEscapeLayer({ id: "picker", close: () => false });

    expect(dispatcher.handleKeyDown(keydown("Escape"))).toEqual({
      kind: "escape",
      layer: "list",
    });
    expect(closed).toEqual(["list"]);
  });

  it("falls through to ordinary resolution when no rung claims it", () => {
    dispatcher.register("view", [spy("view.escape", { keys: "escape" })]);

    dispatcher.handleKeyDown(keydown("Escape"));
    expect(fired).toEqual(["view.escape"]);
  });

  it("reaches the ladder from inside a text field", () => {
    const input = document.createElement("input");
    document.body.append(input);
    const closed: string[] = [];
    dispatcher.pushEscapeLayer({
      id: "modal",
      close: () => {
        closed.push("modal");
        return true;
      },
    });

    dispatcher.handleKeyDown(keydown("Escape", { target: input }));
    expect(closed).toEqual(["modal"]);
    input.remove();
  });
});

/* ========================================================= preventDefault = */

describe("preventDefault discipline", () => {
  it("does not swallow a key no binding matched", () => {
    // Rule 5 of §9.6. Swallowing unmatched keys breaks browser find, assistive
    // technology and the user's own OS shortcuts, invisibly.
    const event = keydown("z");
    dispatcher.handleKeyDown(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("swallows a key a binding claimed", () => {
    dispatcher.register("global", [spy("app.palette")]);
    const event = keydown("k", { metaKey: true });
    dispatcher.handleKeyDown(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("swallows the arming half of a chord", () => {
    dispatcher.register("global", [spy("nav.inbox")]);
    const event = keydown("g");
    dispatcher.handleKeyDown(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

/* ============================================================ attachment = */

describe("attach", () => {
  it("listens on a real target and detaches cleanly", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const detach = dispatcher.attach(root);
    dispatcher.register("global", [spy("app.palette")]);

    root.dispatchEvent(keydown("k", { metaKey: true }));
    expect(fired).toEqual(["app.palette"]);

    detach();
    root.dispatchEvent(keydown("k", { metaKey: true }));
    expect(fired).toEqual(["app.palette"]);
    root.remove();
  });
});

/* ========================================================== normalisation = */

describe("key normalisation", () => {
  it("reads shifted digits from the physical code, not the character", () => {
    // On a US layout Shift+1 arrives as "!"; on a German one it is "!" too but
    // Shift+7 is "/". Priority lives on Shift+1..4, so reading `key` would bind
    // it to punctuation on one layout and to nothing on another.
    expect(normalizeKeyEvent(keydown("!", { shiftKey: true, code: "Digit1" }))).toBe(
      "shift+1",
    );
  });

  it("keeps punctuation as itself, without a shift modifier", () => {
    // `?` *is* Shift+/ on a US layout. Prepending shift would make the help
    // overlay unreachable.
    expect(normalizeKeyEvent(keydown("?", { shiftKey: true }))).toBe("?");
    expect(normalizeKeyEvent(keydown("#", { shiftKey: true }))).toBe("#");
    expect(normalizeKeyEvent(keydown("["))).toBe("[");
  });

  it("collapses Cmd and Ctrl into one `mod` token", () => {
    expect(normalizeKeyEvent(keydown("k", { metaKey: true }))).toBe("mod+k");
    expect(normalizeKeyEvent(keydown("k", { ctrlKey: true }))).toBe("mod+k");
  });

  it("lower-cases letters and keeps shift as a modifier for them", () => {
    expect(normalizeKeyEvent(keydown("D", { shiftKey: true }))).toBe("shift+d");
    expect(normalizeKeyEvent(keydown("d"))).toBe("d");
  });

  it("names the keys whose `key` is unreadable", () => {
    expect(normalizeKeyEvent(keydown(" "))).toBe("space");
    expect(normalizeKeyEvent(keydown("Escape"))).toBe("escape");
    expect(normalizeKeyEvent(keydown("ArrowDown"))).toBe("arrowdown");
    expect(normalizeKeyEvent(keydown("Backspace", { metaKey: true }))).toBe(
      "mod+backspace",
    );
  });

  it("orders modifiers deterministically", () => {
    expect(
      normalizeKeyEvent(
        keydown("ArrowUp", { altKey: true, shiftKey: true, metaKey: true }),
      ),
    ).toBe("mod+alt+shift+arrowup");
  });
});
