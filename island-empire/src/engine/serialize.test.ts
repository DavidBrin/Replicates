import { describe, expect, it } from "vitest";
import { deserializeMap, deserializeState, serializeMap, serializeState } from "./serialize";
import { asciiMap } from "./testing/asciiMap";
import { END, at, move, run, stateFrom } from "./testing/fixtures";

const spec = {
  terrain: ["~~~~~~~", "~.....~", "~..g..~", "~.....~", "~~~~~~~", "~~~~~~~"],
  owners: [".......", ".00.11.", ".00.11.", ".......", ".......", "......."],
  objects: [".......", ".C1.C..", ".......", ".......", ".......", "......."],
};

describe("serialize (SPEC §4)", () => {
  it("round-trips a GameState through the v1 envelope", () => {
    const s = run(stateFrom(spec), move(at(2, 1), at(3, 1)), END);
    const json = serializeState(s);
    expect(JSON.parse(json).v).toBe(1);
    const back = deserializeState(json);
    expect(back).toEqual(s);
    expect(serializeState(back)).toBe(json);
  });

  it("round-trips a MapDefinition", () => {
    const map = asciiMap(spec);
    const back = deserializeMap(serializeMap(map));
    expect(back).toEqual(map);
  });

  it("rejects foreign envelopes and malformed payloads", () => {
    expect(() => deserializeState('{"v":2,"state":{}}')).toThrow(/unsupported version 2/);
    expect(() => deserializeState('{"v":1,"state":{"tiles":5}}')).toThrow(/malformed/);
    expect(() => deserializeState("[]")).toThrow();
    expect(() => deserializeMap('{"v":1}')).toThrow(/malformed/);
    expect(() => deserializeMap("null")).toThrow(/not an object/);
  });
});
