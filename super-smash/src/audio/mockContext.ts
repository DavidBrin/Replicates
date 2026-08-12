/**
 * A fake Web Audio graph, for tests.
 *
 * jsdom implements no audio at all, so this exists to answer two questions the
 * real API cannot be asked in a test runner: *was the right graph built*, and
 * *was it taken down afterwards*. The second is the one that matters. A leaked
 * oscillator is inaudible and costs nothing measurable — until eight minutes of
 * hits have leaked a thousand of them and the audio thread starts glitching on
 * a machine that is also running the game. That failure is invisible in
 * development and obvious in a real match, which is exactly the kind of bug a
 * test should be holding down.
 *
 * Time is manual: `advance(seconds)` moves `currentTime` and fires `onended`
 * for every source whose stop time has passed, which is what the real context
 * does and what the teardown in `synth.ts` hangs off.
 *
 * Not a `*.test.ts` file because three test files share it; not shipped
 * anywhere, because nothing in `src/audio` imports it.
 */

export interface ParamEvent {
  readonly method:
    | "setValueAtTime"
    | "linearRampToValueAtTime"
    | "exponentialRampToValueAtTime"
    | "setTargetAtTime"
    | "cancelScheduledValues";
  readonly value: number;
  readonly time: number;
}

export class MockAudioParam {
  value: number;
  readonly events: ParamEvent[] = [];

  constructor(initial: number) {
    this.value = initial;
  }

  setValueAtTime(value: number, time: number): this {
    this.events.push({ method: "setValueAtTime", value, time });
    this.value = value;
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    this.events.push({ method: "linearRampToValueAtTime", value, time });
    this.value = value;
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    if (value === 0) throw new RangeError("exponentialRampToValueAtTime cannot target zero");
    this.events.push({ method: "exponentialRampToValueAtTime", value, time });
    this.value = value;
    return this;
  }

  setTargetAtTime(value: number, time: number): this {
    this.events.push({ method: "setTargetAtTime", value, time });
    return this;
  }

  cancelScheduledValues(time: number): this {
    this.events.push({ method: "cancelScheduledValues", value: this.value, time });
    return this;
  }

  /** Every value this parameter was ever asked to reach, in order. */
  get valuePath(): number[] {
    return this.events
      .filter((e) => e.method !== "cancelScheduledValues")
      .map((e) => e.value);
  }
}

export class MockAudioNode {
  readonly outputs: (MockAudioNode | MockAudioParam)[] = [];
  connectCount = 0;
  disconnectCount = 0;

  constructor(readonly kind: string) {}

  connect<T extends MockAudioNode | MockAudioParam>(destination: T): T {
    this.outputs.push(destination);
    this.connectCount++;
    return destination;
  }

  disconnect(): void {
    this.outputs.length = 0;
    this.disconnectCount++;
  }

  /** True once the node has been let go of. */
  get released(): boolean {
    return this.connectCount === 0 || this.disconnectCount > 0;
  }
}

export class MockScheduledSource extends MockAudioNode {
  onended: (() => void) | null = null;
  startTime: number | null = null;
  stopTime: number | null = null;
  ended = false;

  start(when = 0): void {
    if (this.startTime !== null) throw new Error("already started");
    this.startTime = when;
  }

  stop(when = 0): void {
    if (this.startTime === null) throw new Error("cannot stop before start");
    // The real API keeps the earliest stop, which is what lets a voice be cut
    // short after its natural end was already scheduled.
    this.stopTime = this.stopTime === null ? when : Math.min(this.stopTime, when);
  }
}

export class MockOscillator extends MockScheduledSource {
  type: OscillatorType = "sine";
  readonly frequency = new MockAudioParam(440);
  readonly detune = new MockAudioParam(0);

  constructor() {
    super("oscillator");
  }
}

export class MockBufferSource extends MockScheduledSource {
  buffer: MockAudioBuffer | null = null;
  loop = false;
  readonly playbackRate = new MockAudioParam(1);

  constructor() {
    super("bufferSource");
  }
}

export class MockGain extends MockAudioNode {
  readonly gain = new MockAudioParam(1);
  constructor() {
    super("gain");
  }
}

export class MockBiquadFilter extends MockAudioNode {
  type: BiquadFilterType = "lowpass";
  readonly frequency = new MockAudioParam(350);
  readonly Q = new MockAudioParam(1);
  readonly gain = new MockAudioParam(0);
  constructor() {
    super("filter");
  }
}

export class MockAudioBuffer {
  private readonly channels: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(index: number): Float32Array {
    return this.channels[index];
  }
  get duration(): number {
    return this.length / this.sampleRate;
  }
}

export class MockAudioContext {
  currentTime = 0;
  sampleRate = 48_000;
  state: AudioContextState = "suspended";
  readonly destination = new MockAudioNode("destination");
  readonly created: MockAudioNode[] = [];
  closed = false;

  createOscillator(): MockOscillator {
    return this.track(new MockOscillator());
  }
  createGain(): MockGain {
    return this.track(new MockGain());
  }
  createBiquadFilter(): MockBiquadFilter {
    return this.track(new MockBiquadFilter());
  }
  createBufferSource(): MockBufferSource {
    return this.track(new MockBufferSource());
  }
  createBuffer(channels: number, length: number, sampleRate: number): MockAudioBuffer {
    return new MockAudioBuffer(channels, length, sampleRate);
  }

  async resume(): Promise<void> {
    this.state = "running";
  }
  async suspend(): Promise<void> {
    this.state = "suspended";
  }
  async close(): Promise<void> {
    this.state = "closed";
    this.closed = true;
  }

  /**
   * Move time forward and end every source whose stop time has passed.
   *
   * This is what makes the teardown assertions honest: `onended` is the hook
   * `synth.ts` disconnects from, and firing it only when a source's scheduled
   * stop has genuinely elapsed means a test cannot pass by tearing down early.
   */
  advance(seconds: number): void {
    this.currentTime += seconds;
    for (const node of this.created) {
      if (!(node instanceof MockScheduledSource)) continue;
      if (node.ended || node.stopTime === null) continue;
      if (node.stopTime > this.currentTime) continue;
      node.ended = true;
      node.onended?.();
    }
  }

  /** Every node created that is still wired into something. */
  get liveNodes(): MockAudioNode[] {
    return this.created.filter((node) => node.outputs.length > 0);
  }

  nodesOfKind(kind: string): MockAudioNode[] {
    return this.created.filter((node) => node.kind === kind);
  }

  get oscillators(): MockOscillator[] {
    return this.created.filter((n): n is MockOscillator => n instanceof MockOscillator);
  }

  get filters(): MockBiquadFilter[] {
    return this.created.filter((n): n is MockBiquadFilter => n instanceof MockBiquadFilter);
  }

  get sources(): MockScheduledSource[] {
    return this.created.filter((n): n is MockScheduledSource => n instanceof MockScheduledSource);
  }

  private track<T extends MockAudioNode>(node: T): T {
    this.created.push(node);
    return node;
  }
}

/** The mock, typed as the real thing, for handing to production code. */
export function asAudioContext(mock: MockAudioContext): AudioContext {
  return mock as unknown as AudioContext;
}

/** Likewise for a single parameter, which is what `envelope` takes. */
export function asAudioParam(mock: MockAudioParam): AudioParam {
  return mock as unknown as AudioParam;
}

/** A `SynthContext` over a fresh mock, which is what most tests want. */
export function mockSynthContext(): {
  mock: MockAudioContext;
  sc: { ctx: BaseAudioContext; destination: AudioNode };
} {
  const mock = new MockAudioContext();
  return {
    mock,
    sc: {
      ctx: mock as unknown as BaseAudioContext,
      destination: mock.destination as unknown as AudioNode,
    },
  };
}
