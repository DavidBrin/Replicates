/**
 * Scheduling DECISIONS (SPEC.md §7): which events get queued for a pass, that
 * swing offsets apply at schedule time, and what the transport is armed with
 * for pattern vs. song mode.
 */

import { describe, expect, it, vi } from "vitest";

import { compilePatternMode, compileSongMode, type CompiledTimeline } from "@/domain/compile";
import { createDefaultProject } from "@/domain/defaultProject";
import { ticksToSeconds } from "@/domain/tickMath";
import {
  PATTERN_LENGTH_TICKS,
  PPQ,
  TICKS_PER_BAR,
  TICKS_PER_BEAT,
  TICKS_PER_STEP,
  type Note,
  type Project,
} from "@/domain/types";

import {
  armTransport,
  eventDurationSeconds,
  isDownbeat,
  metronomeBeatTicks,
  scheduleEvents,
  STEP_BLIP_TICKS,
  ticksNotation,
  triggerMetronomeClick,
  type TransportLike,
} from "./scheduler";
import {
  asBaseContext,
  createStubContext,
  StubAudioBufferSourceNode,
  StubBiquadFilterNode,
} from "./testing/audioStub";

/* ------------------------------------------------------------ fixtures -- */

function note(overrides: Partial<Note> & Pick<Note, "id" | "positionTicks">): Note {
  return {
    channelId: "ch-kick",
    lengthTicks: 0,
    pitch: 60,
    velocity: 0.8,
    ...overrides,
  } as Note;
}

function projectWithNotes(notes: Note[], patch: Partial<Project> = {}): Project {
  const base = createDefaultProject();
  const pattern = base.patterns["pat-1"]!;
  return {
    ...base,
    ...patch,
    patterns: {
      ...base.patterns,
      "pat-1": { ...pattern, notes: Object.fromEntries(notes.map((n) => [n.id, n])) },
    },
  };
}

function fakeTransport(): TransportLike & {
  scheduled: { time: string | number; callback: (time: number) => void }[];
  cancelled: number;
  started: number;
} {
  return {
    PPQ: 192,
    bpm: { value: 120 },
    loop: false,
    loopStart: 0,
    loopEnd: 0,
    ticks: 0,
    state: "stopped",
    scheduled: [],
    cancelled: 0,
    started: 0,
    schedule(callback, time) {
      this.scheduled.push({ time, callback });
      return this.scheduled.length - 1;
    },
    cancel() {
      this.cancelled += 1;
      this.scheduled = [];
      return this;
    },
    start() {
      this.started += 1;
      return this;
    },
    stop() {
      return this;
    },
  };
}

/* ------------------------------------------------------ pure decisions -- */

describe("scheduleEvents — swing at scheduling time", () => {
  const swingTestProject = (swing: number): CompiledTimeline =>
    compilePatternMode(
      projectWithNotes(
        [
          note({ id: "n0", positionTicks: 0 }), // step 0, on-beat
          note({ id: "n1", positionTicks: TICKS_PER_STEP }), // step 1, OFF-beat
          note({ id: "n2", positionTicks: TICKS_PER_STEP * 2 }), // step 2, on-beat
          note({ id: "n3", positionTicks: TICKS_PER_STEP * 3 }), // step 3, OFF-beat
        ],
        { globalSwing: swing },
      ),
    );

  it("delays only odd (off-beat) 16ths", () => {
    const scheduled = scheduleEvents(swingTestProject(1), 1);
    const byId = new Map(scheduled.map((e) => [e.noteId, e]));
    expect(byId.get("n0")?.scheduledTick).toBe(0);
    expect(byId.get("n2")?.scheduledTick).toBe(TICKS_PER_STEP * 2);
    expect(byId.get("n1")?.scheduledTick).toBe(TICKS_PER_STEP * 1.5);
    expect(byId.get("n3")?.scheduledTick).toBe(TICKS_PER_STEP * 3.5);
  });

  it("scales the delay with the swing amount and is a no-op at zero", () => {
    const none = scheduleEvents(swingTestProject(0), 0);
    expect(none.every((e) => e.scheduledTick === e.sourceTick)).toBe(true);

    const half = scheduleEvents(swingTestProject(0.5), 0.5);
    expect(half.find((e) => e.noteId === "n1")?.scheduledTick).toBe(TICKS_PER_STEP * 1.25);
  });

  it("NEVER rewrites the stored tick — sourceTick stays the compiled position", () => {
    const scheduled = scheduleEvents(swingTestProject(1), 1);
    expect(scheduled.find((e) => e.noteId === "n1")?.sourceTick).toBe(TICKS_PER_STEP);
  });

  it("does not swing a free-timed note drawn between steps", () => {
    const timeline = compilePatternMode(
      projectWithNotes([note({ id: "free", positionTicks: TICKS_PER_STEP + 7 })]),
    );
    const scheduled = scheduleEvents(timeline, 1);
    expect(scheduled[0]?.scheduledTick).toBe(TICKS_PER_STEP + 7);
  });

  it("keeps the last off-beat 16th of a bar even at maximum swing", () => {
    const last = PATTERN_LENGTH_TICKS - TICKS_PER_STEP; // step 15, off-beat
    const timeline = compilePatternMode(projectWithNotes([note({ id: "last", positionTicks: last })]));
    // Maximum delay is half a step, so a bar's last 16th can never overflow it.
    expect(scheduleEvents(timeline, 1)).toHaveLength(1);
    expect(scheduleEvents(timeline, 1)[0]?.scheduledTick).toBe(last + TICKS_PER_STEP / 2);
  });

  it("drops — rather than wraps — an event swung at or past the loop end", () => {
    // Synthetic: a loop shorter than the grid it holds, which is the only way
    // to reach the guard. Wrapping would sound the note a whole loop early.
    const timeline: CompiledTimeline = {
      mode: "pattern",
      lengthTicks: TICKS_PER_STEP + 6,
      events: [
        {
          tick: TICKS_PER_STEP,
          channelId: "ch-kick",
          pitch: 60,
          velocity: 1,
          lengthTicks: 0,
          noteId: "edge",
          patternId: "pat-1",
        },
      ],
    };
    expect(scheduleEvents(timeline, 0)).toHaveLength(1);
    expect(scheduleEvents(timeline, 1)).toHaveLength(0);
  });

  it("returns events sorted by the SWUNG tick, not the stored one", () => {
    const timeline = compilePatternMode(
      projectWithNotes(
        [
          note({ id: "a", positionTicks: TICKS_PER_STEP }), // swings to 36
          note({ id: "b", positionTicks: TICKS_PER_STEP + 4 }), // stays at 28
        ],
        {},
      ),
    );
    expect(scheduleEvents(timeline, 1).map((e) => e.noteId)).toEqual(["b", "a"]);
  });
});

describe("scheduleEvents — durations", () => {
  it("widens a step (lengthTicks 0) to a blip and keeps a drawn note's length", () => {
    const timeline = compilePatternMode(
      projectWithNotes([
        note({ id: "step", positionTicks: 0 }),
        note({ id: "drawn", positionTicks: TICKS_PER_BEAT, lengthTicks: 192 }),
      ]),
    );
    const byId = new Map(scheduleEvents(timeline, 0).map((e) => [e.noteId, e]));
    expect(byId.get("step")?.durationTicks).toBe(STEP_BLIP_TICKS);
    expect(byId.get("drawn")?.durationTicks).toBe(192);
  });

  it("converts a duration to seconds at the project tempo", () => {
    const timeline = compilePatternMode(
      projectWithNotes([note({ id: "n", positionTicks: 0, lengthTicks: PPQ })]),
    );
    const event = scheduleEvents(timeline, 0)[0]!;
    expect(eventDurationSeconds(event, 120)).toBeCloseTo(0.5, 6);
    expect(eventDurationSeconds(event, 60)).toBeCloseTo(1, 6);
  });

  it("carries pitch, velocity and provenance through unchanged", () => {
    const timeline = compilePatternMode(
      projectWithNotes([note({ id: "n", positionTicks: 0, pitch: 43, velocity: 0.31 })]),
    );
    const event = scheduleEvents(timeline, 0)[0]!;
    expect(event).toMatchObject({ pitch: 43, velocity: 0.31, noteId: "n", channelId: "ch-kick" });
  });

  it("keeps a muted channel's events — mute is a ramped gain, not a drop", () => {
    const base = projectWithNotes([note({ id: "n", positionTicks: 0 })]);
    const muted: Project = {
      ...base,
      channels: { ...base.channels, "ch-kick": { ...base.channels["ch-kick"]!, muted: true } },
    };
    expect(scheduleEvents(compilePatternMode(muted), 0)).toHaveLength(1);
  });
});

describe("metronome decisions", () => {
  it("clicks once per beat across the loop", () => {
    expect(metronomeBeatTicks(PATTERN_LENGTH_TICKS)).toEqual([0, 96, 192, 288]);
    expect(metronomeBeatTicks(TICKS_PER_BAR * 2)).toHaveLength(8);
    expect(metronomeBeatTicks(0)).toEqual([]);
  });

  it("accents the downbeat of each bar only", () => {
    expect(isDownbeat(0)).toBe(true);
    expect(isDownbeat(TICKS_PER_BEAT)).toBe(false);
    expect(isDownbeat(TICKS_PER_BAR)).toBe(true);
    expect(isDownbeat(TICKS_PER_BAR + TICKS_PER_BEAT * 2)).toBe(false);
  });

  it("builds the click from bandpassed noise, not an oscillator", () => {
    const ctx = createStubContext();
    const dest = ctx.createGain();
    triggerMetronomeClick(asBaseContext(ctx), dest as unknown as AudioNode, 2, true);
    const source = ctx.created.find(
      (n): n is StubAudioBufferSourceNode => n instanceof StubAudioBufferSourceNode,
    );
    expect(source?.startTime).toBe(2);
    expect(ctx.created.some((n) => n.kind === "oscillator")).toBe(false);
    const band = ctx.created.find(
      (n): n is StubBiquadFilterNode => n instanceof StubBiquadFilterNode,
    );
    expect(band?.type).toBe("bandpass");
  });

  it("pitches the accented click above the unaccented one", () => {
    const read = (accented: boolean): number => {
      const ctx = createStubContext();
      triggerMetronomeClick(
        asBaseContext(ctx),
        ctx.createGain() as unknown as AudioNode,
        0,
        accented,
      );
      const band = ctx.created.find(
        (n): n is StubBiquadFilterNode => n instanceof StubBiquadFilterNode,
      );
      return band?.frequency.value ?? 0;
    };
    expect(read(true)).toBeGreaterThan(read(false));
  });
});

describe("ticksNotation", () => {
  it("uses Tone's PPQ-relative tick unit", () => {
    expect(ticksNotation(0)).toBe("0i");
    expect(ticksNotation(384)).toBe("384i");
    expect(ticksNotation(35.9)).toBe("36i");
    expect(ticksNotation(-5)).toBe("0i");
  });
});

/* --------------------------------------------------------- armTransport - */

describe("armTransport", () => {
  it("pins the transport to the domain PPQ so a transport tick IS a domain tick", () => {
    const transport = fakeTransport();
    armTransport({
      transport,
      timeline: compilePatternMode(createDefaultProject()),
      project: createDefaultProject(),
      metronomeEnabled: false,
      onNote: vi.fn(),
      onMetronome: vi.fn(),
    });
    expect(transport.PPQ).toBe(PPQ);
  });

  it("loops pattern mode over exactly one bar", () => {
    const transport = fakeTransport();
    const project = projectWithNotes([note({ id: "n", positionTicks: 0 })]);
    armTransport({
      transport,
      timeline: compilePatternMode(project),
      project,
      metronomeEnabled: false,
      onNote: vi.fn(),
      onMetronome: vi.fn(),
    });
    expect(transport.loop).toBe(true);
    expect(transport.loopStart).toBe(0);
    expect(transport.loopEnd).toBe(ticksNotation(PATTERN_LENGTH_TICKS));
  });

  it("loops song mode over the arrangement end, scheduling each clip's offset copy", () => {
    const base = projectWithNotes([note({ id: "n", positionTicks: 0 })]);
    const project: Project = {
      ...base,
      playbackMode: "song",
      clips: {
        "clip-1": { id: "clip-1", trackId: "trk-1", patternId: "pat-1", startTick: 0 },
        "clip-2": { id: "clip-2", trackId: "trk-1", patternId: "pat-1", startTick: TICKS_PER_BAR },
      },
    };
    const transport = fakeTransport();
    const events = armTransport({
      transport,
      timeline: compileSongMode(project),
      project,
      metronomeEnabled: false,
      onNote: vi.fn(),
      onMetronome: vi.fn(),
    });
    expect(transport.loopEnd).toBe(ticksNotation(TICKS_PER_BAR * 2));
    expect(events.map((e) => e.scheduledTick)).toEqual([0, TICKS_PER_BAR]);
    expect(transport.scheduled.map((s) => s.time)).toEqual(["0i", "384i"]);
  });

  it("cancels the previous arming before queueing the new one", () => {
    const transport = fakeTransport();
    const project = projectWithNotes([note({ id: "n", positionTicks: 0 })]);
    const arm = () =>
      armTransport({
        transport,
        timeline: compilePatternMode(project),
        project,
        metronomeEnabled: false,
        onNote: vi.fn(),
        onMetronome: vi.fn(),
      });
    arm();
    arm();
    expect(transport.cancelled).toBe(2);
    expect(transport.scheduled).toHaveLength(1); // not two
  });

  it("hands the callback the transport's own time argument", () => {
    const transport = fakeTransport();
    const project = projectWithNotes([note({ id: "n", positionTicks: 0 })]);
    const onNote = vi.fn();
    armTransport({
      transport,
      timeline: compilePatternMode(project),
      project,
      metronomeEnabled: false,
      onNote,
      onMetronome: vi.fn(),
    });
    transport.scheduled[0]?.callback(12.5);
    expect(onNote).toHaveBeenCalledWith(expect.objectContaining({ noteId: "n" }), 12.5);
  });

  it("adds four metronome clicks to a one-bar loop, and none when disabled", () => {
    const project = projectWithNotes([note({ id: "n", positionTicks: 0 })]);
    const on = fakeTransport();
    armTransport({
      transport: on,
      timeline: compilePatternMode(project),
      project,
      metronomeEnabled: true,
      onNote: vi.fn(),
      onMetronome: vi.fn(),
    });
    const off = fakeTransport();
    armTransport({
      transport: off,
      timeline: compilePatternMode(project),
      project,
      metronomeEnabled: false,
      onNote: vi.fn(),
      onMetronome: vi.fn(),
    });
    expect(on.scheduled).toHaveLength(off.scheduled.length + 4);
  });

  it("sets BPM as a live value rather than baking tempo into the schedule", () => {
    const transport = fakeTransport();
    const project = { ...projectWithNotes([note({ id: "n", positionTicks: 96 })]), tempo: 174 };
    armTransport({
      transport,
      timeline: compilePatternMode(project),
      project,
      metronomeEnabled: false,
      onNote: vi.fn(),
      onMetronome: vi.fn(),
    });
    expect(transport.bpm.value).toBe(174);
    // The queued time is in TICKS — tempo-independent by construction.
    expect(transport.scheduled[0]?.time).toBe("96i");
    expect(ticksToSeconds(96, 174)).toBeCloseTo(60 / 174, 6);
  });
});
