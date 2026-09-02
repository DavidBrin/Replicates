/**
 * Voice pools, FIFO stealing and cross-channel choke groups (SPEC.md §3.3, §7:
 * "voice pools steal oldest and always ramp before stop").
 */

import { describe, expect, it } from "vitest";

import {
  asBaseContext,
  createStubContext,
  StubGainNode,
  type StubAudioContext,
} from "./testing/audioStub";
import type { ActiveVoice } from "./types";
import { CHOKE_RELEASE_SEC, STEAL_RELEASE_SEC, VoiceManager, VOICES_PER_CHANNEL } from "./voicePool";

function manager(ctx: StubAudioContext, options = {}): VoiceManager {
  return new VoiceManager(asBaseContext(ctx), options);
}

function hit(
  pool: VoiceManager,
  ctx: StubAudioContext,
  channelId: string,
  time: number,
  extra: { chokeGroup?: string; kind?: "kick" | "hatOpen" | "hatClosed" | "lead" } = {},
): ActiveVoice {
  return pool.trigger({
    channelId,
    kind: extra.kind ?? "kick",
    chokeGroup: extra.chokeGroup,
    destination: ctx.createGain() as unknown as AudioNode,
    time,
    pitch: 60,
    velocity: 1,
    durationSec: 0.2,
  });
}

/** Every release ramp the voice's own output gain recorded. */
function releaseRamps(voice: ActiveVoice) {
  return (voice.output as unknown as StubGainNode).gain.callsTo("linearRampToValueAtTime");
}

describe("VoiceManager — pool size and stealing", () => {
  it("holds up to eight simultaneous voices on one channel", () => {
    const ctx = createStubContext();
    const pool = manager(ctx);
    for (let i = 0; i < VOICES_PER_CHANNEL; i += 1) hit(pool, ctx, "ch-lead", 0, { kind: "lead" });
    expect(pool.activeCount("ch-lead")).toBe(VOICES_PER_CHANNEL);
    expect(pool.activeVoices("ch-lead").every((v) => !v.released)).toBe(true);
  });

  it("steals the OLDEST voice, not the newest, at the ninth note", () => {
    const ctx = createStubContext();
    const pool = manager(ctx);
    const voices = Array.from({ length: VOICES_PER_CHANNEL }, () =>
      hit(pool, ctx, "ch-lead", 0, { kind: "lead" }),
    );
    hit(pool, ctx, "ch-lead", 0, { kind: "lead" });

    expect(voices[0]?.released).toBe(true);
    expect(voices.slice(1).every((v) => !v.released)).toBe(true);
    expect(pool.activeCount("ch-lead")).toBe(VOICES_PER_CHANNEL);
  });

  it("steals with a ramp to zero, never a hard cut", () => {
    const ctx = createStubContext();
    const pool = manager(ctx);
    const oldest = hit(pool, ctx, "ch-lead", 0, { kind: "lead" });
    for (let i = 1; i <= VOICES_PER_CHANNEL; i += 1) hit(pool, ctx, "ch-lead", 0, { kind: "lead" });

    const ramp = releaseRamps(oldest).at(-1);
    expect(ramp?.args[0]).toBe(0);
    expect(ramp?.args[1]).toBeCloseTo(STEAL_RELEASE_SEC, 6);
    const methods = (oldest.output as unknown as StubGainNode).gain.methods;
    expect(methods.indexOf("setValueAtTime")).toBeLessThan(
      methods.lastIndexOf("linearRampToValueAtTime"),
    );
  });

  it("honours a smaller configured pool", () => {
    const ctx = createStubContext();
    const pool = manager(ctx, { voicesPerChannel: 2 });
    const a = hit(pool, ctx, "ch", 0, { kind: "lead" });
    hit(pool, ctx, "ch", 0, { kind: "lead" });
    hit(pool, ctx, "ch", 0, { kind: "lead" });
    expect(a.released).toBe(true);
    expect(pool.activeCount("ch")).toBe(2);
  });

  it("keeps pools per channel — a busy lead never steals the kick", () => {
    const ctx = createStubContext();
    const pool = manager(ctx);
    const kick = hit(pool, ctx, "ch-kick", 0);
    for (let i = 0; i <= VOICES_PER_CHANNEL; i += 1) hit(pool, ctx, "ch-lead", 0, { kind: "lead" });
    expect(kick.released).toBe(false);
    expect(pool.activeCount("ch-kick")).toBe(1);
  });

  it("prunes voices whose scheduled end has passed", () => {
    const ctx = createStubContext();
    const pool = manager(ctx);
    const first = hit(pool, ctx, "ch-kick", 0);
    expect(pool.activeCount("ch-kick")).toBe(1);
    hit(pool, ctx, "ch-kick", first.endTime + 0.001);
    expect(pool.activeCount("ch-kick")).toBe(1); // the first one aged out
    expect(first.released).toBe(false); // aged out ≠ stolen
  });

  it("does not prune a voice that is still ringing", () => {
    const ctx = createStubContext();
    const pool = manager(ctx);
    const first = hit(pool, ctx, "ch-hat", 0, { kind: "hatOpen" });
    hit(pool, ctx, "ch-hat", first.endTime / 2, { kind: "hatOpen" });
    expect(pool.activeCount("ch-hat")).toBe(2);
  });
});

describe("VoiceManager — choke groups", () => {
  it("chokes a ringing open hat when the closed hat fires (the default project's rule)", () => {
    const ctx = createStubContext();
    const pool = manager(ctx);
    const open = hit(pool, ctx, "ch-hat-open", 0, { kind: "hatOpen", chokeGroup: "hats" });
    hit(pool, ctx, "ch-hat-closed", 0.05, { kind: "hatClosed", chokeGroup: "hats" });

    expect(open.released).toBe(true);
    const ramp = releaseRamps(open).at(-1);
    expect(ramp?.args[0]).toBe(0);
    expect(ramp?.args[1]).toBeCloseTo(0.05 + CHOKE_RELEASE_SEC, 6);
    expect(pool.activeCount("ch-hat-open")).toBe(0);
  });

  it("chokes in both directions — an open hat cuts a ringing closed hat too", () => {
    const ctx = createStubContext();
    const pool = manager(ctx);
    const closed = hit(pool, ctx, "ch-hat-closed", 0, { kind: "hatClosed", chokeGroup: "hats" });
    hit(pool, ctx, "ch-hat-open", 0.01, { kind: "hatOpen", chokeGroup: "hats" });
    expect(closed.released).toBe(true);
  });

  it("never chokes the triggering channel's own voices", () => {
    const ctx = createStubContext();
    const pool = manager(ctx);
    const first = hit(pool, ctx, "ch-hat-open", 0, { kind: "hatOpen", chokeGroup: "hats" });
    hit(pool, ctx, "ch-hat-open", 0.01, { kind: "hatOpen", chokeGroup: "hats" });
    expect(first.released).toBe(false);
    expect(pool.activeCount("ch-hat-open")).toBe(2);
  });

  it("leaves channels in a DIFFERENT group alone", () => {
    const ctx = createStubContext();
    const pool = manager(ctx);
    const other = hit(pool, ctx, "ch-crash", 0, { kind: "hatOpen", chokeGroup: "cymbals" });
    hit(pool, ctx, "ch-hat-closed", 0.01, { kind: "hatClosed", chokeGroup: "hats" });
    expect(other.released).toBe(false);
  });

  it("leaves ungrouped channels alone", () => {
    const ctx = createStubContext();
    const pool = manager(ctx);
    const kick = hit(pool, ctx, "ch-kick", 0);
    hit(pool, ctx, "ch-hat-closed", 0.01, { kind: "hatClosed", chokeGroup: "hats" });
    expect(kick.released).toBe(false);
  });

  it("an ungrouped channel chokes nothing", () => {
    const ctx = createStubContext();
    const pool = manager(ctx);
    const open = hit(pool, ctx, "ch-hat-open", 0, { kind: "hatOpen", chokeGroup: "hats" });
    hit(pool, ctx, "ch-kick", 0.01);
    expect(open.released).toBe(false);
  });

  it("drops a channel's stale group membership when its group changes", () => {
    const ctx = createStubContext();
    const pool = manager(ctx);
    hit(pool, ctx, "ch-a", 0, { kind: "hatOpen", chokeGroup: "hats" });
    // ch-a is retyped into another group; its old membership must not linger.
    const reGrouped = hit(pool, ctx, "ch-a", 0.01, { kind: "hatOpen", chokeGroup: "cymbals" });
    hit(pool, ctx, "ch-b", 0.02, { kind: "hatClosed", chokeGroup: "hats" });
    expect(reGrouped.released).toBe(false);
  });
});

describe("VoiceManager — teardown", () => {
  it("releaseAll ramps every ringing voice and empties the pools", () => {
    const ctx = createStubContext();
    const pool = manager(ctx);
    const a = hit(pool, ctx, "ch-kick", 0);
    const b = hit(pool, ctx, "ch-lead", 0, { kind: "lead" });
    pool.releaseAll(0.5);
    expect(a.released).toBe(true);
    expect(b.released).toBe(true);
    expect(pool.totalActive()).toBe(0);
    expect(releaseRamps(a).at(-1)?.args[0]).toBe(0);
  });

  it("forgetChannel releases only that channel and clears its group membership", () => {
    const ctx = createStubContext();
    const pool = manager(ctx);
    const gone = hit(pool, ctx, "ch-hat-open", 0, { kind: "hatOpen", chokeGroup: "hats" });
    const kept = hit(pool, ctx, "ch-kick", 0);
    pool.forgetChannel("ch-hat-open", 0.1);
    expect(gone.released).toBe(true);
    expect(kept.released).toBe(false);
    expect(pool.activeCount("ch-hat-open")).toBe(0);
  });
});
