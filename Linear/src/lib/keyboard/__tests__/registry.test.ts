import { describe, expect, it } from "vitest";

import { parseSequence } from "@/lib/keyboard/keys";
import {
  CHORD_PREFIXES,
  MODAL_PASSTHROUGH,
  SCOPE_LEVEL,
  SHORTCUT_GROUPS,
  SHORTCUTS,
  sequenceIndex,
  shortcutById,
} from "@/lib/keyboard/registry";

/**
 * The registry as a data structure.
 *
 * These are the invariants the compiler cannot express. A duplicate binding is
 * the interesting one: two entries on the same keys in the same scope compiles,
 * renders two rows in the help sheet, and produces "sometimes it archives and
 * sometimes it does nothing" depending on registration order.
 *
 * The corrections from `research/04-interaction.md` §1.10 are asserted
 * individually and by value. They are the four places where the obvious guess
 * is wrong, so a future edit that "fixes" `Cmd+B` to toggle the sidebar should
 * fail here with the reason attached, not pass quietly.
 */

describe("shortcut registry", () => {
  it("has no two bindings on the same keys in the same scope", () => {
    const collisions = [...sequenceIndex().entries()]
      .filter(([, entries]) => entries.length > 1)
      .map(([key, entries]) => `${key} → ${entries.map((e) => e.id).join(", ")}`);

    expect(collisions).toEqual([]);
  });

  it("has a unique id per entry", () => {
    const ids = SHORTCUTS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("puts every entry in a declared group", () => {
    for (const entry of SHORTCUTS) {
      expect(SHORTCUT_GROUPS).toContain(entry.group);
    }
  });

  it("gives every entry a parseable key expression", () => {
    for (const entry of SHORTCUTS) {
      const sequence = parseSequence(entry.keys);
      expect(sequence.length, entry.id).toBeGreaterThan(0);
      expect(sequence.join(" "), entry.id).toBe(entry.keys.toLowerCase());
    }
  });

  it("derives chord prefixes from the chords that exist", () => {
    // Not a hard-coded {g, o, m}: a chord added under a prefix nobody armed
    // would silently never fire, and a prefix armed with no chord under it eats
    // the following keystroke.
    expect([...CHORD_PREFIXES].sort()).toEqual(["g", "m"]);
  });

  it("never binds a bare M — it is only ever a chord prefix", () => {
    // §1.10: FastShortcuts lists bare `M` as "add to active cycle"; Linear's own
    // docs make it the relations prefix. Binding both makes `M B` unreachable.
    const bare = SHORTCUTS.filter((entry) => entry.keys === "m");
    expect(bare).toEqual([]);
    expect(SHORTCUTS.filter((entry) => entry.keys.startsWith("m "))).toHaveLength(3);
  });

  it("never binds a bare digit — 1, 2 and 3 belong to Triage", () => {
    // This is *why* priority is on Shift+1..4. Binding both would make the
    // reservation meaningless.
    const digits = SHORTCUTS.filter((entry) => /^[0-9]$/.test(entry.keys));
    expect(digits).toEqual([]);
  });

  it("does not ship a bare E", () => {
    // §1.10 recommends against it: the sources genuinely disagree, and a bare
    // `E` between `S` and `A` on the home row is an expensive thing to guess.
    expect(SHORTCUTS.find((entry) => entry.keys === "e")).toBeUndefined();
  });

  describe("the four corrections", () => {
    it("puts list/board on Cmd+B and the sidebar on [", () => {
      expect(shortcutById("view.layout")?.keys).toBe("mod+b");
      expect(shortcutById("app.sidebar")?.keys).toBe("[");
    });

    it("puts due date on Shift+D, not D", () => {
      expect(shortcutById("issue.dueDate")?.keys).toBe("shift+d");
      expect(SHORTCUTS.find((entry) => entry.keys === "d")).toBeUndefined();
    });

    it("puts priority on Shift+1..4 with Shift+0 for none", () => {
      expect(shortcutById("issue.priority.urgent")?.keys).toBe("shift+1");
      expect(shortcutById("issue.priority.high")?.keys).toBe("shift+2");
      expect(shortcutById("issue.priority.medium")?.keys).toBe("shift+3");
      expect(shortcutById("issue.priority.low")?.keys).toBe("shift+4");
      expect(shortcutById("issue.priority.none")?.keys).toBe("shift+0");
    });

    it("keeps the relation chords under M", () => {
      expect(shortcutById("issue.blockedBy")?.keys).toBe("m b");
      expect(shortcutById("issue.blocking")?.keys).toBe("m x");
      expect(shortcutById("issue.related")?.keys).toBe("m r");
    });
  });

  it("ranks the scopes global < view < selection < modal", () => {
    expect(SCOPE_LEVEL.global).toBeLessThan(SCOPE_LEVEL.view);
    expect(SCOPE_LEVEL.view).toBeLessThan(SCOPE_LEVEL.selection);
    expect(SCOPE_LEVEL.selection).toBeLessThan(SCOPE_LEVEL.modal);
  });

  it("lets the palette, submit and undo through a modal", () => {
    // A modal that swallows Cmd+K stops the palette being the app's universal
    // surface, which is the one thing §2.1 says it must be.
    expect(MODAL_PASSTHROUGH).toContain("mod+k");
    expect(MODAL_PASSTHROUGH).toContain("mod+enter");
    expect(MODAL_PASSTHROUGH).toContain("escape");
    expect(MODAL_PASSTHROUGH).toContain("mod+z");
  });

  it("keeps the G chord's destinations where Linear has them", () => {
    // `SPEC.md` §6's summary table lists `G I` as My Issues;
    // `research/04-interaction.md` §1.3 records `G I` as Inbox and `G M` as My
    // Issues, both CONFIRMED from Linear's docs. §6's own preamble defers to
    // that document ("Conflicts are resolved there"), so the research wins and
    // both destinations stay reachable.
    expect(shortcutById("nav.inbox")?.keys).toBe("g i");
    expect(shortcutById("nav.myIssues")?.keys).toBe("g m");
  });
});
