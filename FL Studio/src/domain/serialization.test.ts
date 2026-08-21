import { afterEach, describe, expect, it } from "vitest";

import { addNotes } from "./commands/patterns";
import { addClip } from "./commands/playlist";
import { updateChannel } from "./commands/channels";
import { createDefaultProject } from "./defaultProject";
import {
  MIGRATIONS,
  deserializeProject,
  migrate,
  parseSaveFile,
  readProject,
  serializeProject,
  toSaveFile,
} from "./serialization";
import { fixtureProject } from "./testKit";
import { noteEndTicks } from "./tickMath";
import {
  CURRENT_SCHEMA_VERSION,
  MASTER_MIXER_TRACK_ID,
  PATTERN_LENGTH_TICKS,
  type Project,
} from "./types";

/** A project with notes, a clip, a choke group and a non-default routing. */
function richProject(): Project {
  let project = fixtureProject();
  project = addNotes("pat-1", [
    { id: "n1", channelId: "ch-kick", positionTicks: 0, lengthTicks: 0, pitch: 60, velocity: 0.78 },
    {
      id: "n2",
      channelId: "ch-bass",
      positionTicks: 26,
      lengthTicks: 90,
      pitch: 41,
      velocity: 0.42,
    },
  ]).apply(project);
  project = addClip({ id: "clip-1", trackId: "trk-2", patternId: "pat-1", startTick: 384 }).apply(
    project,
  );
  project = updateChannel("ch-snare", { routedToMixerTrackId: "mix-4", pan: -0.5 }).apply(project);
  return { ...project, playbackMode: "song", tempo: 174, globalSwing: 0.35 };
}

describe("the envelope", () => {
  it("wraps the project under the current schema version", () => {
    const save = toSaveFile(fixtureProject());
    expect(save.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(save.schemaVersion).toBe(1);
    expect(save.project).toEqual(fixtureProject());
  });

  it("serializes to JSON carrying the version", () => {
    const parsed = JSON.parse(serializeProject(fixtureProject())) as Record<string, unknown>;
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.project).toBeTypeOf("object");
  });
});

describe("round trip", () => {
  it("restores a rich project byte-for-byte", () => {
    const project = richProject();
    const restored = deserializeProject(serializeProject(project));
    expect(restored).toEqual(project);
  });

  it("keeps the choke group on the channels that have one, and only those", () => {
    const restored = deserializeProject(serializeProject(fixtureProject()))!;
    expect(restored.channels["ch-hat-closed"]!.chokeGroup).toBe("hats");
    expect(restored.channels["ch-hat-open"]!.chokeGroup).toBe("hats");
    expect("chokeGroup" in restored.channels["ch-kick"]!).toBe(false);
    expect(JSON.parse(serializeProject(fixtureProject()))).toBeTruthy();
  });

  it("keeps clips as references — two clips still share one pattern id", () => {
    let project = fixtureProject();
    project = addClip({ id: "a", trackId: "trk-1", patternId: "pat-1", startTick: 0 }).apply(project);
    project = addClip({ id: "b", trackId: "trk-2", patternId: "pat-1", startTick: 384 }).apply(
      project,
    );
    const restored = deserializeProject(serializeProject(project))!;
    expect(restored.clips["a"]!.patternId).toBe(restored.clips["b"]!.patternId);
    expect(Object.keys(restored.patterns)).toEqual(["pat-1"]);
  });

  it("preserves navigation state (playbackMode and activePatternId)", () => {
    const project = { ...fixtureProject(), playbackMode: "song" as const };
    expect(deserializeProject(serializeProject(project))!.playbackMode).toBe("song");
  });

  it("survives a double round trip unchanged", () => {
    const once = deserializeProject(serializeProject(richProject()))!;
    const twice = deserializeProject(serializeProject(once))!;
    expect(twice).toEqual(once);
  });
});

describe("migrate", () => {
  it("has a dispatch table with a v1 entry from day one", () => {
    expect(Object.keys(MIGRATIONS)).toEqual(["1"]);
    expect(MIGRATIONS[1]).toBeTypeOf("function");
  });

  it("refuses an unknown or missing schema version", () => {
    expect(migrate({ schemaVersion: 2, project: fixtureProject() })).toBeNull();
    expect(migrate({ project: fixtureProject() })).toBeNull();
    expect(migrate({ schemaVersion: "1", project: fixtureProject() })).toBeNull();
    expect(migrate(null)).toBeNull();
    expect(migrate("nope")).toBeNull();
  });

  it("parseSaveFile returns a normalized envelope", () => {
    const save = parseSaveFile(JSON.parse(serializeProject(fixtureProject())));
    expect(save?.schemaVersion).toBe(1);
    expect(save?.project.name).toBe("New project");
    expect(parseSaveFile({ schemaVersion: 9 })).toBeNull();
  });
});

describe("corrupt and hostile input", () => {
  it("returns null for absent, empty or unparseable text", () => {
    expect(deserializeProject(null)).toBeNull();
    expect(deserializeProject(undefined)).toBeNull();
    expect(deserializeProject("")).toBeNull();
    expect(deserializeProject("{ not json")).toBeNull();
    expect(deserializeProject("[]")).toBeNull();
    expect(deserializeProject("42")).toBeNull();
  });

  it("returns null for a project with no patterns at all", () => {
    expect(readProject({ patterns: {} })).toBeNull();
    expect(readProject({})).toBeNull();
    expect(readProject("nope")).toBeNull();
  });

  it("drops notes whose channel is gone rather than losing the project", () => {
    const project = richProject();
    const damaged = {
      ...project,
      channels: Object.fromEntries(
        Object.entries(project.channels).filter(([id]) => id !== "ch-bass"),
      ),
    };
    const restored = readProject(damaged)!;
    expect(restored).not.toBeNull();
    expect(Object.keys(restored.patterns["pat-1"]!.notes)).toEqual(["n1"]);
  });

  it("drops imported notes at or past the pattern's end, and clamps overruns", () => {
    // Crafted JSON, exactly as a hand-edited or foreign export would arrive:
    // one note beyond the bar, one exactly ON the bar line, one that starts
    // inside but runs past it, and one honest note.
    const project = fixtureProject();
    const restored = readProject({
      ...project,
      patterns: {
        "pat-1": {
          ...project.patterns["pat-1"],
          notes: {
            beyond: { channelId: "ch-kick", positionTicks: 5000, lengthTicks: 24, pitch: 60, velocity: 0.8 },
            onTheLine: {
              channelId: "ch-kick",
              positionTicks: PATTERN_LENGTH_TICKS,
              lengthTicks: 24,
              pitch: 60,
              velocity: 0.8,
            },
            overrun: {
              channelId: "ch-kick",
              positionTicks: PATTERN_LENGTH_TICKS - 24,
              lengthTicks: 900,
              pitch: 62,
              velocity: 0.8,
            },
            fine: { channelId: "ch-kick", positionTicks: 48, lengthTicks: 24, pitch: 64, velocity: 0.8 },
            step: { channelId: "ch-kick", positionTicks: 360, lengthTicks: 0, pitch: 65, velocity: 0.8 },
          },
        },
      },
      patternOrder: ["pat-1"],
      activePatternId: "pat-1",
    })!;

    const notes = restored.patterns["pat-1"]!.notes;
    expect(Object.keys(notes).sort()).toEqual(["fine", "overrun", "step"]);
    expect(notes.overrun!.lengthTicks).toBe(24); // clamped to end exactly on the bar
    expect(notes.step!.lengthTicks).toBe(0); // a step's 0 is a marker, not a length
    for (const note of Object.values(notes)) {
      expect(note.positionTicks).toBeLessThan(PATTERN_LENGTH_TICKS);
      expect(note.positionTicks + note.lengthTicks).toBeLessThanOrEqual(PATTERN_LENGTH_TICKS);
    }
  });

  /*
   * A step's stored length is 0, but it is not zero ticks wide: the scheduler
   * blips it for a whole cell (TICKS_PER_STEP). Judging an imported step
   * against its literal 0 admitted one at tick 361 — "inside the bar" by the
   * raw arithmetic, sounding past it, and worse: the piano roll's move clamp
   * measures the SAME note by its effective length, so the first drag on it
   * computed a negative maximum delta. The two must agree, and they now share
   * `effectiveLengthTicks`.
   */
  it("drops an imported step whose EFFECTIVE length crosses the bar", () => {
    const project = fixtureProject();
    const restored = readProject({
      ...project,
      patterns: {
        "pat-1": {
          ...project.patterns["pat-1"],
          notes: {
            // 361 + 24 = 385: one tick past the bar.
            crossing: { channelId: "ch-kick", positionTicks: 361, lengthTicks: 0, pitch: 60, velocity: 0.8 },
            // The last LEGAL step position: 360 + 24 = 384, ending on the line.
            lastCell: { channelId: "ch-kick", positionTicks: 360, lengthTicks: 0, pitch: 62, velocity: 0.8 },
            // A sized note there has a length to shorten, so it is kept.
            sized: { channelId: "ch-kick", positionTicks: 361, lengthTicks: 900, pitch: 64, velocity: 0.8 },
          },
        },
      },
      patternOrder: ["pat-1"],
      activePatternId: "pat-1",
    })!;

    const notes = restored.patterns["pat-1"]!.notes;
    expect(Object.keys(notes).sort()).toEqual(["lastCell", "sized"]);
    expect(notes.sized!.lengthTicks).toBe(PATTERN_LENGTH_TICKS - 361);
    // The invariant, stated the way the roll's clamp states it.
    for (const note of Object.values(notes)) {
      expect(noteEndTicks(note.positionTicks, note.lengthTicks)).toBeLessThanOrEqual(
        PATTERN_LENGTH_TICKS,
      );
    }
  });

  it("survives the same damage through the real serialize → deserialize path", () => {
    const project = fixtureProject();
    const text = JSON.stringify({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      project: {
        ...project,
        patterns: {
          "pat-1": {
            ...project.patterns["pat-1"],
            notes: {
              far: { channelId: "ch-kick", positionTicks: 4096, lengthTicks: 48, pitch: 60, velocity: 1 },
            },
          },
        },
        patternOrder: ["pat-1"],
        activePatternId: "pat-1",
      },
    });

    const restored = deserializeProject(text)!;
    expect(restored).not.toBeNull();
    expect(restored.patterns["pat-1"]!.notes).toEqual({});
  });

  it("drops clips pointing at a missing pattern or track", () => {
    const project = fixtureProject();
    const restored = readProject({
      ...project,
      clips: {
        good: { id: "good", trackId: "trk-1", patternId: "pat-1", startTick: 0 },
        deadPattern: { id: "deadPattern", trackId: "trk-1", patternId: "ghost", startTick: 0 },
        deadTrack: { id: "deadTrack", trackId: "ghost", patternId: "pat-1", startTick: 0 },
      },
    })!;
    expect(Object.keys(restored.clips)).toEqual(["good"]);
  });

  it("recreates a missing master strip", () => {
    const project = fixtureProject();
    const restored = readProject({
      ...project,
      mixerTracks: Object.fromEntries(
        Object.entries(project.mixerTracks).filter(([id]) => id !== MASTER_MIXER_TRACK_ID),
      ),
    })!;
    expect(restored.mixerTracks[MASTER_MIXER_TRACK_ID]).toMatchObject({ name: "Master" });
  });

  it("re-routes a channel whose mixer strip is gone back to master", () => {
    const restored = readProject({
      ...fixtureProject(),
      channels: {
        "ch-kick": { ...fixtureProject().channels["ch-kick"], routedToMixerTrackId: "mix-99" },
      },
    })!;
    expect(restored.channels["ch-kick"]!.routedToMixerTrackId).toBe(MASTER_MIXER_TRACK_ID);
  });

  it("repairs an activePatternId that points nowhere", () => {
    const restored = readProject({ ...fixtureProject(), activePatternId: "ghost" })!;
    expect(restored.activePatternId).toBe("pat-1");
  });

  it("reconciles order arrays against the records", () => {
    const project = fixtureProject();
    const restored = readProject({
      ...project,
      channelOrder: ["ch-snare", "ghost", "ch-snare", "ch-kick"],
    })!;
    expect(restored.channelOrder.slice(0, 2)).toEqual(["ch-snare", "ch-kick"]);
    expect(restored.channelOrder).toHaveLength(Object.keys(project.channels).length);
    expect(new Set(restored.channelOrder).size).toBe(restored.channelOrder.length);
  });

  it("clamps out-of-range numbers instead of trusting them", () => {
    const project = fixtureProject();
    const restored = readProject({
      ...project,
      tempo: 100000,
      globalSwing: 7,
      channels: {
        "ch-kick": {
          ...project.channels["ch-kick"],
          volume: 12,
          pan: -9,
          defaultStepPitch: 999,
        },
      },
      patterns: {
        "pat-1": {
          ...project.patterns["pat-1"],
          notes: {
            n1: { channelId: "ch-kick", positionTicks: -50, lengthTicks: -3, pitch: 300, velocity: 4 },
          },
        },
      },
    })!;
    expect(restored.tempo).toBe(522);
    expect(restored.globalSwing).toBe(1);
    expect(restored.channels["ch-kick"]).toMatchObject({ volume: 1, pan: -1, defaultStepPitch: 127 });
    expect(restored.patterns["pat-1"]!.notes["n1"]).toMatchObject({
      positionTicks: 0,
      lengthTicks: 0,
      pitch: 127,
      velocity: 1,
    });
  });

  it("falls back to a sane voice for an unknown instrument kind", () => {
    const project = fixtureProject();
    const restored = readProject({
      ...project,
      channels: { "ch-kick": { ...project.channels["ch-kick"], voice: "theremin" } },
    })!;
    expect(restored.channels["ch-kick"]!.voice).toBe("kick");
  });

  it("drops unknown junk fields rather than carrying them into state", () => {
    const restored = readProject({
      ...fixtureProject(),
      evil: "<script>",
      channels: { "ch-kick": { ...fixtureProject().channels["ch-kick"], evil: 1 } },
    })!;
    expect("evil" in restored).toBe(false);
    expect("evil" in restored.channels["ch-kick"]!).toBe(false);
  });

  it("a default project survives the whole path unchanged", () => {
    const project = createDefaultProject({ now: "2026-08-20T10:00:00.000Z" });
    expect(deserializeProject(serializeProject(project))).toEqual(project);
  });
});

/* ------------------------------------------------- crafted / hostile JSON */

describe("prototype-bearing JSON cannot pollute or forge membership", () => {
  /** Restore anything a failing test manages to plant, so it cannot cascade. */
  afterEach(() => {
    delete (Object.prototype as Record<string, unknown>).polluted;
    delete (Object.prototype as Record<string, unknown>).id;
  });

  it("does not run the __proto__ setter while rebuilding records", () => {
    /*
     * Written as raw text, NOT via `JSON.stringify` of an object literal:
     * `{ __proto__: x }` in source sets the literal's *prototype* and emits no
     * key at all, so the stringified form would be a harmless payload and this
     * test would pass against the very bug it exists for. `JSON.parse`, by
     * contrast, defines `__proto__` as an own data property — which is the
     * whole attack.
     */
    const hostile = `{
      "schemaVersion": ${CURRENT_SCHEMA_VERSION},
      "project": {
        "id": "prj-1",
        "name": "Hostile",
        "channels": {
          "ch-1": { "name": "Kick", "voice": "kick" },
          "__proto__": { "polluted": true }
        },
        "channelOrder": ["ch-1"],
        "patterns": {
          "pat-1": { "name": "P", "notes": {} },
          "__proto__": { "polluted": true }
        },
        "patternOrder": ["pat-1"],
        "playlistTracks": { "__proto__": { "polluted": true } },
        "clips": { "__proto__": { "polluted": true } },
        "mixerTracks": { "__proto__": { "polluted": true } },
        "activePatternId": "pat-1"
      }
    }`;
    expect(Object.hasOwn(JSON.parse(hostile).project.channels, "__proto__")).toBe(true);

    const project = deserializeProject(hostile);

    expect(project).not.toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);

    // The concrete damage a bare `records[id] = value` does: `JSON.parse`
    // makes `__proto__` an OWN key, and assigning it runs the inherited
    // setter, so the rebuilt record ends up *inheriting from the attacker's
    // object* — every field on it then answers a membership probe.
    for (const record of [
      project!.channels,
      project!.patterns,
      project!.playlistTracks,
      project!.clips,
      project!.mixerTracks,
    ]) {
      expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
      expect((record as Record<string, unknown>).polluted).toBeUndefined();
    }

    // …and the forbidden key is simply not an entity.
    expect(Object.keys(project!.channels)).toEqual(["ch-1"]);
    expect(project!.channelOrder).toEqual(["ch-1"]);
    expect(project!.patternOrder).toEqual(["pat-1"]);
  });

  it("treats an inherited key as absent, not as an existing entity", () => {
    const hostile = JSON.stringify({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      project: {
        id: "prj-1",
        channels: { "ch-1": { name: "Kick", voice: "kick" } },
        // `toString` exists on Object.prototype: a `record[id] !== undefined`
        // membership test says yes to every one of these.
        channelOrder: ["toString", "ch-1", "valueOf"],
        patterns: { "pat-1": { name: "P", notes: { "n-1": { channelId: "toString" } } } },
        patternOrder: ["hasOwnProperty", "pat-1"],
        playlistTracks: { "trk-1": { name: "T" } },
        playlistTrackOrder: ["trk-1"],
        clips: {
          "clip-1": { trackId: "trk-1", patternId: "constructor", startTick: 0 },
          "clip-2": { trackId: "toString", patternId: "pat-1", startTick: 0 },
          "clip-3": { trackId: "trk-1", patternId: "pat-1", startTick: 0 },
        },
        mixerTracks: {},
        activePatternId: "toString",
      },
    });

    const project = deserializeProject(hostile);

    expect(project).not.toBeNull();
    expect(project!.channelOrder).toEqual(["ch-1"]);
    expect(project!.patternOrder).toEqual(["pat-1"]);
    // A note whose channel is "toString" is an orphan and is dropped.
    expect(Object.keys(project!.patterns["pat-1"]!.notes)).toEqual([]);
    // Only the clip with two real referents survives.
    expect(Object.keys(project!.clips)).toEqual(["clip-3"]);
    // An `activePatternId` naming an inherited key is invalid, not valid.
    expect(project!.activePatternId).toBe("pat-1");
  });

  it("rejects a save whose only 'pattern' is a forbidden key", () => {
    const hostile = `{
      "schemaVersion": ${CURRENT_SCHEMA_VERSION},
      "project": {
        "channels": {},
        "patterns": { "__proto__": { "name": "not a pattern", "notes": {} } },
        "mixerTracks": {}
      }
    }`;

    expect(deserializeProject(hostile)).toBeNull();
  });

  it("drops a note or a channel routed through a forbidden key", () => {
    const project = readProject(
      JSON.parse(`{
        "channels": {
          "ch-1": { "name": "Kick", "voice": "kick", "routedToMixerTrackId": "toString" }
        },
        "channelOrder": ["ch-1"],
        "patterns": {
          "pat-1": {
            "name": "P",
            "notes": { "__proto__": { "channelId": "ch-1" }, "n-1": { "channelId": "ch-1" } }
          }
        },
        "patternOrder": ["pat-1"],
        "mixerTracks": {}
      }`),
    );

    expect(project).not.toBeNull();
    // An inherited mixer id is not a real strip, so the channel falls to Master.
    expect(project!.channels["ch-1"]!.routedToMixerTrackId).toBe(MASTER_MIXER_TRACK_ID);
    expect(Object.keys(project!.patterns["pat-1"]!.notes)).toEqual(["n-1"]);
  });

  /*
   * `""` is the UI's spelling of "no entity" — the piano roll's target channel
   * is `ui.channelId ?? channelOrder[0] ?? ""` and its "is there a channel to
   * write into" guard is `channelId !== ""`. A file that defines an entity
   * actually keyed `""` would make that guard lie: a channel the roll lists,
   * shows ghost notes for, and then refuses to draw into or audition. Ids are
   * minted `<prefix>-<counter>` (`domain/ids.ts`), so `""` is never legitimate
   * and is dropped here instead — absence gets one spelling.
   */
  it("drops entities keyed by the empty string, and whatever pointed at them", () => {
    const project = readProject(
      JSON.parse(`{
        "channels": {
          "": { "name": "Nameless", "voice": "kick" },
          "ch-1": { "name": "Kick", "voice": "kick", "routedToMixerTrackId": "" }
        },
        "channelOrder": ["", "ch-1"],
        "patterns": {
          "": { "name": "Nameless", "notes": {} },
          "pat-1": {
            "name": "P",
            "notes": {
              "": { "channelId": "ch-1" },
              "n-orphan": { "channelId": "" },
              "n-1": { "channelId": "ch-1" }
            }
          }
        },
        "patternOrder": ["", "pat-1"],
        "playlistTracks": { "": { "name": "T" }, "trk-1": { "name": "T" } },
        "playlistTrackOrder": ["", "trk-1"],
        "clips": {
          "": { "trackId": "trk-1", "patternId": "pat-1", "startTick": 0 },
          "clip-orphan": { "trackId": "", "patternId": "pat-1", "startTick": 0 },
          "clip-1": { "trackId": "trk-1", "patternId": "pat-1", "startTick": 0 }
        },
        "mixerTracks": { "": { "name": "Nowhere" } },
        "activePatternId": ""
      }`),
    );

    expect(project).not.toBeNull();
    expect(Object.keys(project!.channels)).toEqual(["ch-1"]);
    expect(project!.channelOrder).toEqual(["ch-1"]);
    expect(Object.keys(project!.patterns)).toEqual(["pat-1"]);
    expect(project!.patternOrder).toEqual(["pat-1"]);
    expect(Object.keys(project!.playlistTracks)).toEqual(["trk-1"]);
    expect(Object.keys(project!.mixerTracks)).toEqual([MASTER_MIXER_TRACK_ID]);
    // The note keyed "" is gone, and so is the one routed to the "" channel.
    expect(Object.keys(project!.patterns["pat-1"]!.notes)).toEqual(["n-1"]);
    // The clip keyed "" is gone, and so is the one on the "" track.
    expect(Object.keys(project!.clips)).toEqual(["clip-1"]);
    // "" is not a mixer strip either, so the routing falls back to Master.
    expect(project!.channels["ch-1"]!.routedToMixerTrackId).toBe(MASTER_MIXER_TRACK_ID);
    // …and an `activePatternId` of "" is invalid, not "the nameless pattern".
    expect(project!.activePatternId).toBe("pat-1");
  });

  it("rejects a save whose only 'pattern' is keyed by the empty string", () => {
    expect(
      deserializeProject(
        `{"schemaVersion": ${CURRENT_SCHEMA_VERSION},
          "project": { "channels": {}, "patterns": { "": { "name": "X", "notes": {} } },
          "mixerTracks": {} }}`,
      ),
    ).toBeNull();
  });

  it("will not run a migration off an inherited schemaVersion key", () => {
    // `MIGRATIONS["constructor"]` is a function — a bare lookup would call it.
    expect(migrate({ schemaVersion: 2, project: {} })).toBeNull();
    expect(MIGRATIONS[1]).toBeTypeOf("function");
  });
});
