import { describe, expect, it } from "vitest";

import { updateChannel } from "./commands/channels";
import { addNotes } from "./commands/patterns";
import { updateProject } from "./commands/project";
import { fixtureProject } from "./testKit";
import { UNDO_STACK_LIMIT, type Note } from "./types";
import {
  canRedo,
  canUndo,
  createHistory,
  dispatchCommand,
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
