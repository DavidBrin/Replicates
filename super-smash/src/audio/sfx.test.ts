/**
 * The recipes, checked against the claims made about them.
 *
 * These tests read the scheduled parameter values back out of the mock graph,
 * so a recipe cannot drift from the description in `sfx.ts` without a test
 * noticing. What they cannot check is whether it sounds good — but they can
 * check the properties that make it sound *like the thing it is meant to be*:
 * a heavy hit longer and lower than a light one, a KO closing its filter as it
 * falls, a confirm rising where a back falls.
 */

import { describe, expect, it } from "vitest";

import { MockBufferSource, MockGain, MockOscillator, mockSynthContext } from "./mockContext";
import * as sfx from "./sfx";

function oscillators(mock: ReturnType<typeof mockSynthContext>["mock"]): MockOscillator[] {
  return mock.oscillators;
}

describe("the light hit", () => {
  it("falls 400 to 150 in fifty milliseconds", () => {
    const { mock, sc } = mockSynthContext();
    sfx.lightHit(sc);
    const body = oscillators(mock)[0];
    expect(body.type).toBe("triangle");
    expect(body.frequency.valuePath).toEqual([400, 150]);
    expect(body.frequency.events[1].time).toBeCloseTo(0.05, 5);
  });

  it("layers a click on top, one and a half milliseconds long", () => {
    // Without the transient the hit arrives late even when it is sample
    // accurate. This is the whole difference between landing and reporting.
    const { mock, sc } = mockSynthContext();
    sfx.lightHit(sc);
    const click = oscillators(mock)[1];
    expect(click.type).toBe("square");
    expect(click.frequency.value).toBe(1800);
    expect(click.stopTime).toBeLessThan(0.01);
  });
});

describe("the heavy hit", () => {
  it("is longer and lower than the light one, which is how weight reads", () => {
    // Not louder. If the only difference were volume the game would read as
    // "quiet hit" and "loud hit" rather than "fast" and "heavy".
    const light = mockSynthContext();
    const heavy = mockSynthContext();
    sfx.lightHit(light.sc);
    sfx.heavyHit(heavy.sc);

    const lightBody = oscillators(light.mock)[0];
    const heavyBody = oscillators(heavy.mock)[0];

    expect(heavyBody.frequency.valuePath[0]).toBeLessThan(lightBody.frequency.valuePath[0]);
    expect(heavyBody.stopTime!).toBeGreaterThan(lightBody.stopTime! * 3);
  });

  it("cracks through a bandpass with a lowpass closing over it", () => {
    const { mock, sc } = mockSynthContext();
    sfx.heavyHit(sc);
    const [band, sweep] = mock.filters;
    expect(band.type).toBe("bandpass");
    expect(band.frequency.value).toBe(2000);
    expect(sweep.type).toBe("lowpass");
    expect(sweep.frequency.valuePath).toEqual([4000, 500]);
  });

  it("keeps the crack far shorter than the thump", () => {
    const { mock, sc } = mockSynthContext();
    sfx.heavyHit(sc);
    const thump = mock.oscillators[0];
    const crack = mock.created.find((n) => n instanceof MockBufferSource) as MockBufferSource;
    expect(crack.stopTime!).toBeLessThan(thump.stopTime! / 5);
  });
});

describe("the shield", () => {
  it("hums on two detuned oscillators through a wobbling lowpass", () => {
    const { mock, sc } = mockSynthContext();
    sfx.shieldVoice(sc);

    const all = mock.oscillators;
    const lfo = all.find((o) => o.frequency.value === 2)!;
    const voices = all.filter((o) => o !== lfo).map((o) => o.frequency.value);
    expect(voices.sort()).toEqual([220, 224]);
    expect(mock.filters[0].type).toBe("lowpass");
  });

  it("keeps sounding until it is released", () => {
    const { mock, sc } = mockSynthContext();
    const voice = sfx.shieldVoice(sc);
    mock.advance(5);
    expect(mock.liveNodes.length).toBeGreaterThan(0);

    voice.stop();
    mock.advance(1);
    expect(mock.liveNodes).toEqual([]);
  });

  it("sparks brightly on a perfect shield", () => {
    const { mock, sc } = mockSynthContext();
    sfx.perfectShield(sc);
    expect(mock.filters.some((f) => f.type === "highpass" && f.frequency.value >= 3000)).toBe(true);
    // Rising, not falling — a parry is a reward.
    expect(mock.oscillators[0].frequency.valuePath).toEqual([1200, 2400]);
  });
});

describe("the KO blast", () => {
  it("cracks, falls, and recedes", () => {
    const { mock, sc } = mockSynthContext();
    sfx.koBlast(sc);

    // The crack: fifteen milliseconds, and first. (Plus the half-millisecond
    // attack — a source outlives its envelope, never the other way round.)
    const sources = mock.created.filter((n) => n instanceof MockBufferSource) as MockBufferSource[];
    expect(sources[0].stopTime).toBeCloseTo(0.0155, 4);

    // The fall: 800 down to 30 over half a second.
    const body = mock.oscillators[0];
    expect(body.frequency.valuePath).toEqual([800, 30]);
    expect(body.frequency.events[1].time).toBeCloseTo(0.5, 5);

    // The distance: the lowpass closing is what separates this from a slide
    // whistle. Air absorbs high frequencies first.
    const closing = mock.filters.find((f) => f.type === "lowpass")!;
    expect(closing.frequency.valuePath).toEqual([8000, 200]);
  });

  it("is the longest sound in the game", () => {
    const { mock: koMock, sc: koSc } = mockSynthContext();
    const { mock: hitMock, sc: hitSc } = mockSynthContext();
    sfx.koBlast(koSc);
    sfx.heavyHit(hitSc);
    const longest = (m: typeof koMock) => Math.max(...m.sources.map((s) => s.stopTime ?? 0));
    expect(longest(koMock)).toBeGreaterThan(longest(hitMock) * 2);
  });
});

describe("the menu", () => {
  it("blips at 550 for a move", () => {
    const { mock, sc } = mockSynthContext();
    sfx.menuMove(sc);
    expect(mock.oscillators).toHaveLength(1);
    expect(mock.oscillators[0].frequency.value).toBe(550);
  });

  it("rises to confirm and falls to go back", () => {
    // The universal grammar. Getting these the wrong way round makes a menu
    // feel subtly wrong in a way people notice without being able to say why.
    const confirm = mockSynthContext();
    const back = mockSynthContext();
    sfx.menuConfirm(confirm.sc);
    sfx.menuBack(back.sc);

    expect(confirm.mock.oscillators.map((o) => o.frequency.value)).toEqual([660, 880]);
    expect(back.mock.oscillators.map((o) => o.frequency.value)).toEqual([880, 660]);
  });

  it("schedules the second note after the first", () => {
    const { mock, sc } = mockSynthContext();
    mock.currentTime = 2;
    sfx.menuConfirm(sc);
    const [first, second] = mock.oscillators;
    expect(second.startTime!).toBeGreaterThan(first.startTime!);
  });
});

describe("the rest of the roster of sounds", () => {
  it("beeps the countdown and answers it an octave up", () => {
    const beep = mockSynthContext();
    const go = mockSynthContext();
    sfx.countdownBeep(beep.sc);
    sfx.goStinger(go.sc);
    expect(beep.mock.oscillators[0].frequency.valuePath).toEqual([880]);
    expect(go.mock.oscillators[0].frequency.valuePath).toEqual([880, 1760]);
  });

  it("rises through a scale when the Smash Ball breaks", () => {
    const { mock, sc } = mockSynthContext();
    sfx.smashBallBreak(sc);
    const starts = mock.oscillators.map((o) => o.frequency.valuePath[0]);
    expect(starts).toHaveLength(7);
    for (let i = 1; i < starts.length; i++) expect(starts[i]).toBeGreaterThan(starts[i - 1]);
    // …and each note begins after the one before it. An arpeggio, not a chord.
    const times = mock.oscillators.map((o) => o.startTime!);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
  });

  it("shatters a shield with a burst and three falling shards", () => {
    const { mock, sc } = mockSynthContext();
    sfx.shieldBreak(sc);
    const shards = mock.oscillators;
    expect(shards).toHaveLength(3);
    for (const shard of shards) {
      const [from, to] = shard.frequency.valuePath;
      expect(to).toBeLessThan(from);
    }
  });

  it("moves air for a dodge, and nothing tonal at all", () => {
    const { mock, sc } = mockSynthContext();
    sfx.dodge(sc);
    expect(mock.oscillators).toHaveLength(0);
    expect(mock.filters.some((f) => f.type === "highpass")).toBe(true);
  });

  it("gives land, grab, throw, clank and final smash each their own shape", () => {
    for (const play of [sfx.land, sfx.grab, sfx.throwRelease, sfx.clank, sfx.finalSmash]) {
      const { mock, sc } = mockSynthContext();
      play(sc);
      expect(mock.created.length).toBeGreaterThan(1);
      const gains = mock.created.filter((n) => n instanceof MockGain) as MockGain[];
      expect(gains.every((g) => g.outputs.length > 0)).toBe(true);
    }
  });
});

describe("every recipe", () => {
  const oneShots: [string, (sc: ReturnType<typeof mockSynthContext>["sc"]) => void][] = [
    ["lightHit", sfx.lightHit],
    ["heavyHit", sfx.heavyHit],
    ["shieldHit", sfx.shieldHit],
    ["perfectShield", sfx.perfectShield],
    ["shieldBreak", sfx.shieldBreak],
    ["jump", sfx.jump],
    ["land", sfx.land],
    ["koBlast", sfx.koBlast],
    ["clank", sfx.clank],
    ["dodge", sfx.dodge],
    ["grab", sfx.grab],
    ["throwRelease", sfx.throwRelease],
    ["smashBallBreak", sfx.smashBallBreak],
    ["finalSmash", sfx.finalSmash],
    ["menuMove", sfx.menuMove],
    ["menuConfirm", sfx.menuConfirm],
    ["menuBack", sfx.menuBack],
    ["countdownBeep", sfx.countdownBeep],
    ["goStinger", sfx.goStinger],
  ];

  it.each(oneShots)("%s reaches the destination and then lets go", (_name, play) => {
    const { mock, sc } = mockSynthContext();
    play(sc);

    // It got as far as the bus…
    expect(mock.destination.outputs.length + countInboundToDestination(mock)).toBeGreaterThan(0);
    // …and it was all released once it finished.
    mock.advance(5);
    expect(mock.liveNodes).toEqual([]);
  });

  it.each(oneShots)("%s survives a whole match's worth of retriggers", (_name, play) => {
    const { mock, sc } = mockSynthContext();
    for (let i = 0; i < 200; i++) {
      mock.currentTime = i * 0.1;
      play(sc);
    }
    mock.advance(10);
    expect(mock.liveNodes).toEqual([]);
  });
});

function countInboundToDestination(mock: ReturnType<typeof mockSynthContext>["mock"]): number {
  return mock.created.filter((node) => node.outputs.includes(mock.destination)).length;
}
