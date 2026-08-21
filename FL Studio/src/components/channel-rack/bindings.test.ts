/**
 * The rack's keyboard bindings, fired through the real registry
 * (`src/lib/keyboard.ts`) against the real store — so the combo, the handler
 * and the dispatch are all under test.
 *
 * The case this file was written for is round 11 #2: a keyboard mutation is a
 * GESTURE, and dispatching one straight from a binding bypasses the
 * single-active-mutating-gesture invariant. `1..9,0` did exactly that, so a
 * knob drag or a paint stroke that was open when the digit landed stayed
 * open — hold and all — and the mute wedged itself into the middle of that
 * drag's undo entry.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDefaultProject } from "@/domain/defaultProject";
import { __resetGestureCounterForTests, registerExternalGesture } from "@/lib/gestureHold";
import { __resetKeyboardRegistryForTests, dispatchKeyEvent } from "@/lib/keyboard";
import { useAppStore } from "@/lib/store";

import { registerChannelRackBindings } from "./bindings";

let unregister: (() => void) | null = null;

function press(code: string): boolean {
  return dispatchKeyEvent(new KeyboardEvent("keydown", { code }));
}

function firstChannel(): string {
  return useAppStore.getState().project.channelOrder[0]!;
}

function muted(id: string): boolean {
  return useAppStore.getState().project.channels[id]!.muted;
}

beforeEach(() => {
  __resetKeyboardRegistryForTests();
  __resetGestureCounterForTests();
  useAppStore.getState().loadProject(createDefaultProject());
  unregister = registerChannelRackBindings();
});

afterEach(() => {
  unregister?.();
  unregister = null;
  __resetKeyboardRegistryForTests();
});

describe("mute digits", () => {
  it("toggles the channel at that position", () => {
    const id = firstChannel();
    expect(muted(id)).toBe(false);

    expect(press("Digit1")).toBe(true);
    expect(muted(id)).toBe(true);

    press("Digit1");
    expect(muted(id)).toBe(false);
  });

  it("ENDS the gesture in flight before it dispatches (round 11 #2)", () => {
    // Whatever is being dragged elsewhere in the app — a knob, a clip, a rack
    // paint stroke — is registered here the same way it is in the real app.
    const ended: string[] = [];
    registerExternalGesture(() => ended.push("drag"));

    press("Digit1");

    expect(ended).toEqual(["drag"]);
  });

  it("dispatches under a gesture id, so the mute is its own undo entry", () => {
    // A named dispatch seals every OTHER gesture's open entry
    // (`domain/undo.ts`), which is the history half of the same invariant.
    const id = firstChannel();
    press("Digit1");

    const top = useAppStore.getState().history.past.at(-1);
    expect(top?.gestureId).toMatch(/^channel-rack-mute#/);
    expect(muted(id)).toBe(true);

    press("Digit2");
    const next = useAppStore.getState().history.past.at(-1);
    expect(next?.gestureId).not.toBe(top?.gestureId);
    expect(useAppStore.getState().history.past).toHaveLength(2);
  });

  it("does nothing when there is no channel at that position", () => {
    const before = useAppStore.getState().project;
    press("Digit9");
    expect(useAppStore.getState().project).toBe(before);
  });
});
