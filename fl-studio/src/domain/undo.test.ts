import { describe, expect, it } from "vitest";

import { updateChannel } from "./commands/channels";
import { addNotes, removeNotes, updateNotes } from "./commands/patterns";
import { updateProject } from "./commands/project";
import { composite, isComposite, noop } from "./commands/types";
import { fixtureProject } from "./testKit";
import { UNDO_STACK_LIMIT, type Note } from "./types";
import {
  canRedo,
  canUndo,
  createHistory,
  dispatchCommand,
  endGesture,
  redo,
  redoLabel,
  undo,
  undoLabel,
  type History,
} from "./undo";

function note(id: string): Note {
  return { id, channelId: "ch-kick", positionTicks: 0, lengthTicks: 0, pitch: 60, velocity: 0.5 };
}

describe("history basics", () => {
  it("starts empty", () => {
    const history = createHistory();
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
    expect(undoLabel(history)).toBeNull();
    expect(redoLabel(history)).toBeNull();
  });

  it("undo of nothing is a no-op that keeps the same objects", () => {
    const project = fixtureProject();
    const history = createHistory();
    const result = undo(project, history);
    expect(result.project).toBe(project);
    expect(result.history).toBe(history);
    expect(redo(project, history).project).toBe(project);
  });

  it("applies, undoes and redoes a command", () => {
    const start = fixtureProject();
    const dispatched = dispatchCommand(start, createHistory(), updateProject({ tempo: 90 }));
    expect(dispatched.project.tempo).toBe(90);
    expect(canUndo(dispatched.history)).toBe(true);
    expect(undoLabel(dispatched.history)).toBe("Change project settings");

    const undone = undo(dispatched.project, dispatched.history);
    expect(undone.project).toEqual(start);
    expect(canUndo(undone.history)).toBe(false);
    expect(canRedo(undone.history)).toBe(true);
    expect(redoLabel(undone.history)).toBe("Change project settings");

    const redone = redo(undone.project, undone.history);
    expect(redone.project).toEqual(dispatched.project);
    expect(canRedo(redone.history)).toBe(false);
  });

  it("round-trips a long chain of mixed commands", () => {
    const start = fixtureProject();
    let state = { project: start, history: createHistory() as History };
    const commands = [
      updateProject({ tempo: 128 }),
      updateChannel("ch-kick", { volume: 0.2 }),
      addNotes("pat-1", [note("n1")]),
      updateChannel("ch-clap", { muted: true }),
    ];
    const snapshots = [structuredClone(start)];
    for (const command of commands) {
      state = dispatchCommand(state.project, state.history, command);
      snapshots.push(structuredClone(state.project));
    }

    for (let i = commands.length; i > 0; i -= 1) {
      state = undo(state.project, state.history);
      expect(state.project).toEqual(snapshots[i - 1]);
    }
    for (let i = 1; i <= commands.length; i += 1) {
      state = redo(state.project, state.history);
      expect(state.project).toEqual(snapshots[i]);
    }
  });

  it("drops the redo branch once a new command is dispatched", () => {
    const start = fixtureProject();
    let state = dispatchCommand(start, createHistory(), updateProject({ tempo: 90 }));
    state = undo(state.project, state.history);
    expect(canRedo(state.history)).toBe(true);

    state = dispatchCommand(state.project, state.history, updateProject({ tempo: 100 }));
    expect(canRedo(state.history)).toBe(false);
    expect(state.project.tempo).toBe(100);
  });

  it("caps the stack at 200 entries, dropping the oldest", () => {
    let state = { project: fixtureProject(), history: createHistory() as History };
    for (let i = 0; i < UNDO_STACK_LIMIT + 25; i += 1) {
      state = dispatchCommand(state.project, state.history, updateProject({ tempo: 100 + (i % 50) }));
    }
    expect(state.history.past).toHaveLength(UNDO_STACK_LIMIT);
  });
});

/*
 * Round 16, the class. Four separate findings — a resize with no room, a
 * `Delete` with no selection, a digit that maps to no channel, a routing cycle
 * of length one — were all the same bug: an action that writes nothing still
 * went through dispatch. The call sites each stop building such a command now,
 * and this is the floor underneath them: whatever gets through, an empty
 * command never becomes an undo entry.
 */
describe("a command that writes nothing never reaches the stack", () => {
  const empties = [
    ["updateNotes with no patches", updateNotes(fixtureProject().activePatternId, [])],
    ["updateChannel with an empty patch", updateChannel("ch-kick", {})],
    ["updateProject with an empty patch", updateProject({})],
    ["removeNotes with no ids", removeNotes(fixtureProject().activePatternId, [])],
    ["addNotes with no notes", addNotes(fixtureProject().activePatternId, [])],
    ["a composite of nothing", composite([])],
    ["a composite of empties", composite([updateChannel("ch-kick", {}), noop()])],
  ] as const;

  it.each(empties)("drops %s — same project, same history", (_label, command) => {
    const project = fixtureProject();
    const history = createHistory();

    const result = dispatchCommand(project, history, command, { gestureId: "g-1" });

    expect(result.project).toBe(project);
    expect(result.history).toBe(history);
    expect(result.wholesale).toBe(false);
  });

  it("does not clear a pending REDO — a no-op keystroke costs the user nothing", () => {
    const project = fixtureProject();
    const seeded = dispatchCommand(project, createHistory(), addNotes(project.activePatternId, [note("n-1")]));
    const undone = undo(seeded.project, seeded.history);
    expect(canRedo(undone.history)).toBe(true);

    const after = dispatchCommand(undone.project, undone.history, updateChannel("ch-kick", {}));

    expect(canRedo(after.history)).toBe(true);
    expect(after.history).toBe(undone.history);
  });

  it("SEALS nothing: an empty dispatch is not evidence that a gesture ended", () => {
    const project = fixtureProject();
    const open = dispatchCommand(project, createHistory(), updateChannel("ch-kick", { muted: true }), {
      coalesceKey: "rack:mute",
      gestureId: "g-drag",
    });

    // The empty command arrives under a DIFFERENT gesture id — the shape that
    // seals every other gesture's entry when it writes.
    const between = dispatchCommand(open.project, open.history, updateNotes(project.activePatternId, []), {
      gestureId: "g-other",
    });
    // ...so the original gesture's entry is still open and still coalescing.
    const resumed = dispatchCommand(
      between.project,
      between.history,
      updateChannel("ch-kick", { muted: false }),
      { coalesceKey: "rack:mute", gestureId: "g-drag" },
    );

    expect(resumed.history.past).toHaveLength(1);
  });

  it("still dispatches a command whose patch is non-empty but whose VALUE matches", () => {
    // The dispatcher's guard is deliberately structural — value equality is
    // the call site's job, where the current values are already in hand.
    const project = fixtureProject();
    const muted = project.channels["ch-kick"]!.muted;

    const result = dispatchCommand(project, createHistory(), updateChannel("ch-kick", { muted }));

    expect(result.history.past).toHaveLength(1);
  });
});

describe("drag coalescing", () => {
  it("folds a whole knob drag into one undo entry", () => {
    const start = fixtureProject();
    let state = { project: start, history: createHistory() as History };
    const key = "knob:ch-kick:volume";
    for (const volume of [0.7, 0.6, 0.5, 0.42]) {
      state = dispatchCommand(state.project, state.history, updateChannel("ch-kick", { volume }), {
        coalesceKey: key,
      });
    }

    expect(state.project.channels["ch-kick"]!.volume).toBe(0.42);
    expect(state.history.past).toHaveLength(1);

    const undone = undo(state.project, state.history);
    expect(undone.project.channels["ch-kick"]!.volume).toBe(start.channels["ch-kick"]!.volume);
    expect(undone.project).toEqual(start);

    // …and redo replays the whole gesture, landing on the final value.
    const redone = redo(undone.project, undone.history);
    expect(redone.project.channels["ch-kick"]!.volume).toBe(0.42);
  });

  it("undoes a HETEROGENEOUS coalesced gesture completely, not just its first command", () => {
    // The regression: four coalesced note-adds, each touching a DIFFERENT
    // note, used to keep only the first command's inverse — one undo left
    // three notes behind. Every gesture that draws/erases more than one
    // entity under one coalesceKey (a rack paint stroke, a marquee move)
    // depends on this.
    const start = fixtureProject();
    let state = { project: start, history: createHistory() as History };
    const key = "roll-draw:pat-1";
    for (const id of ["n1", "n2", "n3", "n4"]) {
      state = dispatchCommand(state.project, state.history, addNotes("pat-1", [note(id)]), {
        coalesceKey: key,
      });
    }

    expect(Object.keys(state.project.patterns["pat-1"]!.notes)).toHaveLength(4);
    expect(state.history.past).toHaveLength(1);

    const undone = undo(state.project, state.history);
    expect(Object.keys(undone.project.patterns["pat-1"]!.notes)).toHaveLength(0);
    expect(undone.project).toEqual(start);

    // …and it still redoes as one entry, restoring all four.
    const redone = redo(undone.project, undone.history);
    expect(Object.keys(redone.project.patterns["pat-1"]!.notes)).toHaveLength(4);
    expect(redone.project).toEqual(state.project);
  });

  it("folds inverses in reverse order, not the order the commands ran", () => {
    // Order-sensitive by construction: the gesture ADDS a note and then
    // REMOVES it, so forward-order folding would re-remove a note that is
    // already gone and then re-add it — ending with a note the gesture had
    // deleted. Only reverse folding lands back on `start`.
    const start = fixtureProject();
    let state = { project: start, history: createHistory() as History };
    const key = "roll-draw:pat-1";
    state = dispatchCommand(state.project, state.history, addNotes("pat-1", [note("n1")]), {
      coalesceKey: key,
    });
    state = dispatchCommand(state.project, state.history, removeNotes("pat-1", ["n1"]), {
      coalesceKey: key,
    });
    expect(state.history.past).toHaveLength(1);
    expect(Object.keys(state.project.patterns["pat-1"]!.notes)).toHaveLength(0);

    const undone = undo(state.project, state.history);
    expect(undone.project).toEqual(start);
  });

  it("keeps a same-field knob drag collapsed to ONE entry with an exact inverse", () => {
    // The property the old shortcut got right, pinned so the fix cannot
    // regress it: repeated writes to one field still make one undo entry, and
    // undoing it lands on the value from before the gesture (not the
    // second-to-last one).
    const start = fixtureProject();
    let state = { project: start, history: createHistory() as History };
    const key = "knob:ch-kick:volume";
    for (const volume of [0.9, 0.8, 0.7, 0.6, 0.5]) {
      state = dispatchCommand(state.project, state.history, updateChannel("ch-kick", { volume }), {
        coalesceKey: key,
      });
    }

    expect(state.history.past).toHaveLength(1);
    expect(state.history.future).toHaveLength(0);
    const undone = undo(state.project, state.history);
    expect(undone.project.channels["ch-kick"]!.volume).toBe(start.channels["ch-kick"]!.volume);
    expect(undone.history.past).toHaveLength(0);
  });

  it("keeps the coalesced entry FLAT rather than nesting one level per dispatch", () => {
    // A long drag emits hundreds of commands; a tree that deepens per dispatch
    // recurses just as deep inside apply().
    let state = { project: fixtureProject(), history: createHistory() as History };
    for (let i = 0; i < 200; i += 1) {
      state = dispatchCommand(
        state.project,
        state.history,
        updateChannel("ch-kick", { volume: i / 200 }),
        { coalesceKey: "knob:ch-kick:volume" },
      );
    }
    const entry = state.history.past[0]!;
    expect(isComposite(entry.command)).toBe(true);
    expect(isComposite(entry.command) ? entry.command.commands : []).toHaveLength(200);
    expect(isComposite(entry.inverse) ? entry.inverse.commands : []).toHaveLength(200);
    // Every part is a leaf: no nested composites.
    for (const part of isComposite(entry.command) ? entry.command.commands : []) {
      expect(isComposite(part)).toBe(false);
    }
  });

  it("starts a new entry when the gesture key changes", () => {
    let state = { project: fixtureProject(), history: createHistory() as History };
    state = dispatchCommand(state.project, state.history, updateChannel("ch-kick", { volume: 0.5 }), {
      coalesceKey: "knob:ch-kick:volume",
    });
    state = dispatchCommand(state.project, state.history, updateChannel("ch-kick", { pan: 0.5 }), {
      coalesceKey: "knob:ch-kick:pan",
    });
    expect(state.history.past).toHaveLength(2);
  });

  it("does not coalesce when no key is given", () => {
    let state = { project: fixtureProject(), history: createHistory() as History };
    state = dispatchCommand(state.project, state.history, updateChannel("ch-kick", { volume: 0.5 }));
    state = dispatchCommand(state.project, state.history, updateChannel("ch-kick", { volume: 0.4 }));
    expect(state.history.past).toHaveLength(2);
  });

  it("does not coalesce across an intervening non-coalescing command", () => {
    let state = { project: fixtureProject(), history: createHistory() as History };
    const key = "knob:ch-kick:volume";
    state = dispatchCommand(state.project, state.history, updateChannel("ch-kick", { volume: 0.5 }), {
      coalesceKey: key,
    });
    state = dispatchCommand(state.project, state.history, addNotes("pat-1", [note("n1")]));
    state = dispatchCommand(state.project, state.history, updateChannel("ch-kick", { volume: 0.3 }), {
      coalesceKey: key,
    });
    expect(state.history.past).toHaveLength(3);
  });
});

/* ------------------------------------------------------ gesture boundaries */

describe("coalescing separates gestures, not just keys", () => {
  const project = fixtureProject();

  function tempo(value: number) {
    return updateProject({ tempo: value });
  }

  it("folds one gesture's dispatches into a single entry", () => {
    let state = { project, history: createHistory() };
    for (const bpm of [141, 142, 143]) {
      state = dispatchCommand(state.project, state.history, tempo(bpm), {
        coalesceKey: "transport:tempo",
        gestureId: "drag-1",
      });
    }

    expect(state.history.past).toHaveLength(1);
    expect(state.project.tempo).toBe(143);
    expect(undo(state.project, state.history).project.tempo).toBe(project.tempo);
  });

  it("does NOT fold two gestures that share a fixed coalesceKey", () => {
    let state = dispatchCommand(project, createHistory(), tempo(150), {
      coalesceKey: "transport:tempo",
      gestureId: "drag-1",
    });
    state = dispatchCommand(state.project, state.history, tempo(160), {
      coalesceKey: "transport:tempo",
      gestureId: "drag-2",
    });

    expect(state.history.past).toHaveLength(2);

    // One Ctrl+Z takes back only the second gesture.
    const back = undo(state.project, state.history);
    expect(back.project.tempo).toBe(150);
    expect(undo(back.project, back.history).project.tempo).toBe(project.tempo);
  });

  it("keeps the interim convention working: a unique key per gesture", () => {
    let state = dispatchCommand(project, createHistory(), tempo(150), {
      coalesceKey: "transport:tempo:1",
    });
    state = dispatchCommand(state.project, state.history, tempo(151), {
      coalesceKey: "transport:tempo:1",
    });
    state = dispatchCommand(state.project, state.history, tempo(160), {
      coalesceKey: "transport:tempo:2",
    });

    expect(state.history.past).toHaveLength(2);
    expect(undo(state.project, state.history).project.tempo).toBe(151);
  });

  it("a keyed dispatch never coalesces into an unkeyed entry, and vice versa", () => {
    let state = dispatchCommand(project, createHistory(), tempo(150));
    state = dispatchCommand(state.project, state.history, tempo(160), {
      coalesceKey: "transport:tempo",
    });
    expect(state.history.past).toHaveLength(2);
  });

  it("endGesture() seals the top entry so the next dispatch starts a new one", () => {
    let state = dispatchCommand(project, createHistory(), tempo(150), {
      coalesceKey: "transport:tempo",
    });
    state = { ...state, history: endGesture(state.history) };
    state = dispatchCommand(state.project, state.history, tempo(160), {
      coalesceKey: "transport:tempo",
    });

    expect(state.history.past).toHaveLength(2);
    expect(undo(state.project, state.history).project.tempo).toBe(150);
  });

  it("endGesture() is a no-op object-identity-wise when there is nothing to seal", () => {
    const empty = createHistory();
    expect(endGesture(empty)).toBe(empty);

    const unkeyed = dispatchCommand(project, createHistory(), tempo(150)).history;
    expect(endGesture(unkeyed)).toBe(unkeyed);
  });

  /*
   * Round 9 #5. Sealing was unconditionally "the top entry", and gestures
   * overlap: a wheel nudge on another surface, a second pointer, a keyboard
   * edit mid-drag. Gesture A ending sealed whatever was on top — routinely
   * gesture B's still-OPEN entry — so B's next dispatch could no longer
   * coalesce and one drag became two undo entries.
   */
  describe("endGesture(gestureId) seals only ITS gesture's entry (round 9 #5)", () => {
    const dragA = { coalesceKey: "swing", gestureId: "A" };
    const dragB = { coalesceKey: "tempo", gestureId: "B" };

    it("leaves a concurrent gesture's entry open when the other one ends", () => {
      let state = dispatchCommand(project, createHistory(), tempo(150), dragA);
      state = dispatchCommand(state.project, state.history, tempo(160), dragB);

      // A ends while B is still down. B's entry is on top.
      state = { ...state, history: endGesture(state.history, "A") };
      state = dispatchCommand(state.project, state.history, tempo(170), dragB);

      // B is still one entry: A's ending did not cut it in half.
      expect(state.history.past).toHaveLength(2);
      expect(state.history.past[1]!.gestureId).toBe("B");
      // ...and A's own entry really was sealed.
      expect(state.history.past[0]!.gestureId).toBeUndefined();
      expect(state.history.past[0]!.coalesceKey).toBeUndefined();
    });

    it("finds its entry beneath the top of the stack", () => {
      let state = dispatchCommand(project, createHistory(), tempo(150), dragA);
      state = dispatchCommand(state.project, state.history, tempo(160), dragB);
      state = { ...state, history: endGesture(state.history, "A") };

      // A cannot be extended even though its entry was buried.
      state = dispatchCommand(state.project, state.history, tempo(170), dragA);
      expect(state.history.past).toHaveLength(3);
    });

    it("is a no-op when its gesture dispatched nothing and the top is somebody else's", () => {
      const state = dispatchCommand(project, createHistory(), tempo(150), dragB);
      expect(endGesture(state.history, "A")).toBe(state.history);
    });

    it("seals NOTHING when its gesture owns no entry — the anonymous top may be in flight", () => {
      // A knob drag: it mints a unique `coalesceKey` per gesture and puts no
      // id in history, so its entry is anonymous — and still OPEN.
      let state = dispatchCommand(project, createHistory(), tempo(150), {
        coalesceKey: "knob:volume:7",
      });

      // A different, NAMED gesture ends having dispatched nothing. It owns no
      // entry, so it seals none: the top is somebody else's.
      expect(endGesture(state.history, "swing#3")).toBe(state.history);

      // Proof it matters: the knob's drag continues as ONE entry. The old
      // fallback sealed the anonymous top on the named gesture's behalf and
      // cut this drag into two Ctrl+Z's.
      state = dispatchCommand(state.project, state.history, tempo(160), {
        coalesceKey: "knob:volume:7",
      });
      expect(state.history.past).toHaveLength(1);
    });

    /**
     * The interleave, prevented rather than modelled (module header). Two
     * gestures taking turns used to grow two entries at once — B's on top, A's
     * buried and still extendable — so where the user's Ctrl+Z boundaries
     * fell depended on which gesture ended first, and A's entry could keep
     * absorbing edits for as long as A stayed open.
     */
    describe("a dispatch under a new gestureId seals the previous gesture (round 10 #5)", () => {
      it("serializes A-B-A into three bounded entries", () => {
        let state = dispatchCommand(project, createHistory(), tempo(150), dragA);
        expect(state.history.past[0]!.gestureId).toBe("A");

        // B starts. A's entry is sealed on the spot — A's own `endGesture`
        // may never arrive.
        state = dispatchCommand(state.project, state.history, tempo(160), dragB);
        expect(state.history.past[0]!.gestureId).toBeUndefined();
        expect(state.history.past[0]!.coalesceKey).toBeUndefined();
        expect(state.history.past[1]!.gestureId).toBe("B");

        // A resumes: B is sealed, and A cannot reach back into its own
        // sealed entry — it opens a third.
        state = dispatchCommand(state.project, state.history, tempo(170), dragA);
        expect(state.history.past).toHaveLength(3);
        expect(state.history.past[1]!.gestureId).toBeUndefined();
        expect(state.history.past[2]!.gestureId).toBe("A");

        // A's second run still coalesces with ITSELF — sealing is per switch,
        // not per dispatch.
        state = dispatchCommand(state.project, state.history, tempo(180), dragA);
        expect(state.history.past).toHaveLength(3);
      });

      it("bounds the entries however long the two gestures take turns", () => {
        let state = dispatchCommand(project, createHistory(), tempo(150), dragA);
        for (let i = 0; i < 20; i += 1) {
          state = dispatchCommand(state.project, state.history, tempo(151 + i), dragB);
          state = dispatchCommand(state.project, state.history, tempo(171 + i), dragA);
        }
        // One entry per turn, and never an entry reopened beneath the top:
        // exactly 41 switches' worth, not an unbounded pair of open entries.
        expect(state.history.past).toHaveLength(41);
        const open = state.history.past.filter((entry) => entry.gestureId !== undefined);
        expect(open).toHaveLength(1);
        expect(open[0]).toBe(state.history.past[state.history.past.length - 1]);
      });

      it("leaves the stack ALONE when nothing needs sealing", () => {
        // The hot path: a coalescing drag must not copy the stack per move.
        const state = dispatchCommand(project, createHistory(), tempo(150), dragA);
        const next = dispatchCommand(state.project, state.history, tempo(151), dragA);
        expect(next.history.past).toHaveLength(1);

        // An ANONYMOUS dispatch claims to be no gesture, so it seals none —
        // a knob drag in flight beside a swing drag keeps its entry.
        const anon = dispatchCommand(next.project, next.history, tempo(152), {
          coalesceKey: "knob:volume:7",
        });
        expect(anon.history.past[0]!.gestureId).toBe("A");
      });
    });

    it("an ANONYMOUS end seals an anonymous top, but never a named one", () => {
      // Anonymous top: sealed, because an anonymous caller can only be its
      // owner (nothing else could have made it).
      let state = dispatchCommand(project, createHistory(), tempo(150), {
        coalesceKey: "knob:volume:7",
      });
      state = { ...state, history: endGesture(state.history) };
      expect(state.history.past[0]!.coalesceKey).toBeUndefined();

      // Named top: untouched. It belongs to that gesture.
      const named = dispatchCommand(state.project, state.history, tempo(160), dragB);
      expect(endGesture(named.history)).toBe(named.history);
    });
  });

  it("does not disturb the redo stack it seals over", () => {
    let state = dispatchCommand(project, createHistory(), tempo(150), {
      coalesceKey: "transport:tempo",
    });
    state = dispatchCommand(state.project, state.history, tempo(160), {
      coalesceKey: "other",
    });
    const back = undo(state.project, state.history);
    expect(back.history.future).toHaveLength(1);

    const sealed = endGesture(back.history);
    expect(sealed.future).toHaveLength(1);
    expect(redo(back.project, sealed).project.tempo).toBe(160);
  });
});
