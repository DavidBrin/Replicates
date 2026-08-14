"use client";

import { useEffect, useRef } from "react";

import type { IssueRelationType } from "@/domain/entities";

import type { PickerKind } from "./properties-rail";

/**
 * The issue detail pane's keyboard map.
 *
 * `SPEC.md` §6, and the three corrections in it that matter here — each one is
 * a place where the obvious guess is wrong:
 *
 * | Key | Action | The trap |
 * |---|---|---|
 * | `S` `A` `P` `L` | status / assignee / priority / label | — |
 * | `Shift+D` | due date | **not** bare `D` |
 * | `M` then `B`/`X`/`R` | blocked by / blocks / related | `M` is a **chord prefix, never a bare binding** |
 * | `Esc` | close the open picker | one layer per press |
 *
 * ## Why the chord needs a buffer and a timeout
 *
 * `M` on its own does nothing, so pressing it arms a prefix and the *next* key
 * is interpreted against the relation table. Without a timeout the prefix stays
 * armed forever, and an `M` pressed by accident silently eats the next
 * shortcut — the bug reads as "the keyboard stopped working" minutes later,
 * which is close to undiagnosable. 1500ms is long enough to be a chord and
 * short enough that nobody connects the two presses.
 *
 * ## Shortcuts never fire while text has focus
 *
 * Typing "Ship the parser" into the title would otherwise open the status
 * picker on `S` and the priority picker on `P`. The guard covers `input`,
 * `textarea`, `select` and `contenteditable`, and it also honours
 * `event.isComposing`: an IME candidate window swallows keys and emits them
 * later, and dispatching on those produces shortcuts nobody pressed.
 */

const CHORD_TIMEOUT_MS = 1500;

const PROPERTY_KEYS: Readonly<Record<string, PickerKind>> = Object.freeze({
  s: "status",
  a: "assignee",
  p: "priority",
  l: "label",
});

/** `M` then one of these. `M` `M` (duplicate) is not offered: see §1.5. */
const RELATION_KEYS: Readonly<Record<string, IssueRelationType>> = Object.freeze({
  b: "blocked_by",
  x: "blocks",
  r: "related",
});

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export interface IssueShortcutHandlers {
  onOpenPicker: (kind: PickerKind) => void;
  onOpenRelationPicker: (type: IssueRelationType) => void;
  onEscape: () => void;
  /** Off while the pane is read-only, so a denied action never opens a picker. */
  enabled?: boolean;
}

export function useIssueShortcuts({
  onOpenPicker,
  onOpenRelationPicker,
  onEscape,
  enabled = true,
}: IssueShortcutHandlers): void {
  // A ref rather than dependencies: rebinding the listener on every render of a
  // pane that re-renders on every keystroke would drop keys pressed mid-swap.
  //
  // Written in an effect, not during render. A ref mutated while rendering is
  // a write during a phase React is allowed to abandon and re-run, and the
  // update is not needed until an event fires — which cannot happen before the
  // commit this effect runs after.
  const handlers = useRef({ onOpenPicker, onOpenRelationPicker, onEscape });
  useEffect(() => {
    handlers.current = { onOpenPicker, onOpenRelationPicker, onEscape };
  });

  useEffect(() => {
    if (!enabled) return;

    let chord: "m" | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const disarm = (): void => {
      chord = null;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        disarm();
        handlers.current.onEscape();
        return;
      }
      if (event.isComposing || isEditableTarget(event.target)) return;
      // A modifier means the key belongs to the browser or the command palette.
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const key = event.key.toLowerCase();

      if (chord === "m") {
        const relation = RELATION_KEYS[key];
        disarm();
        if (relation !== undefined) {
          event.preventDefault();
          handlers.current.onOpenRelationPicker(relation);
        }
        return;
      }

      if (key === "m" && !event.shiftKey) {
        // Armed, and deliberately not `preventDefault`ed: `M` alone is not a
        // binding, so it must not swallow anything if the chord is abandoned.
        chord = "m";
        timer = setTimeout(disarm, CHORD_TIMEOUT_MS);
        return;
      }

      if (event.shiftKey) {
        if (key === "d") {
          event.preventDefault();
          handlers.current.onOpenPicker("dueDate");
        }
        return;
      }

      const picker = PROPERTY_KEYS[key];
      if (picker !== undefined) {
        event.preventDefault();
        handlers.current.onOpenPicker(picker);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      disarm();
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [enabled]);
}
