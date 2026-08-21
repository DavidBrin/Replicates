/**
 * A fake `tone` module for the engine's tests — the loader half of
 * `src/audio/testing`, next to the Web Audio half in `audioStub.ts`.
 *
 * Shared rather than redeclared per suite because two suites now need it: the
 * engine's own lifecycle tests, and the shell test that drives a REAL engine
 * through the mounted app to prove the wiring's call order (a mode flip while
 * playing has to reach `engine.setMode` before the store write syncs the new
 * mode in, or the engine sees nothing to do).
 */

import { __setToneLoaderForTests, type ToneLike } from "../engine";
import type { TransportLike } from "../scheduler";
import { createStubContext, type StubAudioContext } from "./audioStub";

export interface FakeTone extends ToneLike {
  ctx: StubAudioContext;
  transport: FakeTransport;
  startCalls: number;
}

export interface FakeTransport extends TransportLike {
  scheduled: { time: string | number; callback: (time: number) => void }[];
  cancelCalls: number;
  startCalls: number;
  stopCalls: number;
}

export function makeFakeTone(): FakeTone {
  const ctx = createStubContext();
  const transport: FakeTransport = {
    PPQ: 192,
    bpm: { value: 120 },
    loop: false,
    loopStart: 0,
    loopEnd: 0,
    ticks: 0,
    state: "stopped",
    scheduled: [],
    cancelCalls: 0,
    startCalls: 0,
    stopCalls: 0,
    schedule(callback, time) {
      this.scheduled.push({ time, callback });
      return this.scheduled.length - 1;
    },
    cancel() {
      this.cancelCalls += 1;
      this.scheduled = [];
      return this;
    },
    start() {
      this.startCalls += 1;
      this.state = "started";
      return this;
    },
    stop() {
      this.stopCalls += 1;
      this.state = "stopped";
      return this;
    },
  };
  const tone: FakeTone = {
    ctx,
    transport,
    startCalls: 0,
    async start() {
      tone.startCalls += 1;
      ctx.state = "running";
    },
    getContext: () => ({ rawContext: ctx as unknown as BaseAudioContext }),
    getTransport: () => transport,
  };
  return tone;
}

/** Install a fake Tone and return it, along with a loader call counter. */
export function installTone(): { tone: FakeTone; loads: () => number } {
  const tone = makeFakeTone();
  let loads = 0;
  __setToneLoaderForTests(async () => {
    loads += 1;
    return tone;
  });
  return { tone, loads: () => loads };
}
