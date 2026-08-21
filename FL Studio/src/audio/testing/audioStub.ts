/**
 * A hand-rolled Web Audio stub (SPEC.md §7 "Unit — audio").
 *
 * jsdom implements no part of the Web Audio API, and nothing in this project's
 * unit tests renders real sound. What the audio tests actually assert is
 * *decisions*: which events get scheduled, that swing lands at schedule time,
 * that a pool steals the oldest voice and always ramps before `stop()`, and
 * that the mixer graph wires channel → track → master → limiter → destination.
 * All of that is observable from a graph of fake nodes that record their
 * connections and their `AudioParam` automation calls.
 *
 * This module is deliberately *not* installed globally in `vitest.setup.ts`:
 * every existing suite runs without Web Audio today, and a global shim would
 * change what those suites see. Tests construct a context explicitly and cast
 * it — `createStubContext() as unknown as BaseAudioContext` — which keeps the
 * production code typed against the real DOM lib.
 */

export interface ParamCall {
  method: string;
  args: number[];
}

/** Records automation instead of rendering it; `value` tracks the last target. */
export class StubAudioParam {
  value: number;
  readonly calls: ParamCall[] = [];

  constructor(value = 0) {
    this.value = value;
  }

  private record(method: string, args: number[]): this {
    this.calls.push({ method, args });
    return this;
  }

  setValueAtTime(value: number, time: number): this {
    this.value = value;
    return this.record("setValueAtTime", [value, time]);
  }

  linearRampToValueAtTime(value: number, time: number): this {
    this.value = value;
    return this.record("linearRampToValueAtTime", [value, time]);
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    this.value = value;
    return this.record("exponentialRampToValueAtTime", [value, time]);
  }

  setTargetAtTime(value: number, time: number, constant: number): this {
    this.value = value;
    return this.record("setTargetAtTime", [value, time, constant]);
  }

  cancelScheduledValues(time: number): this {
    return this.record("cancelScheduledValues", [time]);
  }

  cancelAndHoldAtTime(time: number): this {
    return this.record("cancelAndHoldAtTime", [time]);
  }

  /** Method names in call order — the shape most assertions want. */
  get methods(): string[] {
    return this.calls.map((call) => call.method);
  }

  /** Every call of one method, oldest first. */
  callsTo(method: string): ParamCall[] {
    return this.calls.filter((call) => call.method === method);
  }
}

export type StubNodeKind =
  | "gain"
  | "panner"
  | "filter"
  | "oscillator"
  | "bufferSource"
  | "compressor"
  | "analyser"
  | "destination";

export class StubAudioNode {
  readonly outputs: StubAudioNode[] = [];
  readonly inputs: StubAudioNode[] = [];
  disconnectCount = 0;

  constructor(
    readonly kind: StubNodeKind,
    readonly context: StubAudioContext,
  ) {}

  connect<T extends StubAudioNode>(destination: T): T {
    this.outputs.push(destination);
    destination.inputs.push(this);
    return destination;
  }

  disconnect(): void {
    this.disconnectCount += 1;
    for (const out of this.outputs) {
      const at = out.inputs.indexOf(this);
      if (at >= 0) out.inputs.splice(at, 1);
    }
    this.outputs.length = 0;
  }
}

export class StubGainNode extends StubAudioNode {
  readonly gain = new StubAudioParam(1);
  constructor(context: StubAudioContext) {
    super("gain", context);
  }
}

export class StubStereoPannerNode extends StubAudioNode {
  readonly pan = new StubAudioParam(0);
  constructor(context: StubAudioContext) {
    super("panner", context);
  }
}

export class StubBiquadFilterNode extends StubAudioNode {
  type: BiquadFilterType = "lowpass";
  readonly frequency = new StubAudioParam(350);
  readonly Q = new StubAudioParam(1);
  readonly gain = new StubAudioParam(0);
  readonly detune = new StubAudioParam(0);
  constructor(context: StubAudioContext) {
    super("filter", context);
  }
}

/** Common surface of the two scheduled-source node stubs. */
export class StubScheduledSource extends StubAudioNode {
  startTime: number | null = null;
  stopTime: number | null = null;
  onended: (() => void) | null = null;

  start(when = 0): void {
    this.startTime = when;
  }

  stop(when = 0): void {
    // The real node keeps the earliest stop; mirroring that keeps a
    // double-stop (steal after a natural end) from looking like a bug.
    this.stopTime = this.stopTime === null ? when : Math.min(this.stopTime, when);
  }
}

export class StubOscillatorNode extends StubScheduledSource {
  type: OscillatorType = "sine";
  readonly frequency = new StubAudioParam(440);
  readonly detune = new StubAudioParam(0);
  constructor(context: StubAudioContext) {
    super("oscillator", context);
  }
}

export class StubAudioBuffer {
  readonly #channels: Float32Array[];

  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.#channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  get duration(): number {
    return this.length / this.sampleRate;
  }

  getChannelData(channel: number): Float32Array {
    const data = this.#channels[channel];
    if (data === undefined) throw new RangeError(`no channel ${channel}`);
    return data;
  }
}

export class StubAudioBufferSourceNode extends StubScheduledSource {
  buffer: StubAudioBuffer | null = null;
  loop = false;
  readonly playbackRate = new StubAudioParam(1);
  readonly detune = new StubAudioParam(0);
  constructor(context: StubAudioContext) {
    super("bufferSource", context);
  }
}

export class StubDynamicsCompressorNode extends StubAudioNode {
  readonly threshold = new StubAudioParam(-24);
  readonly knee = new StubAudioParam(30);
  readonly ratio = new StubAudioParam(12);
  readonly attack = new StubAudioParam(0.003);
  readonly release = new StubAudioParam(0.25);
  readonly reduction = 0;
  constructor(context: StubAudioContext) {
    super("compressor", context);
  }
}

export class StubAnalyserNode extends StubAudioNode {
  fftSize = 2048;
  smoothingTimeConstant = 0.8;
  constructor(context: StubAudioContext) {
    super("analyser", context);
  }
  get frequencyBinCount(): number {
    return this.fftSize / 2;
  }
  getFloatTimeDomainData(array: Float32Array): void {
    array.fill(0);
  }
  getByteFrequencyData(array: Uint8Array): void {
    array.fill(0);
  }
}

export class StubAudioContext {
  currentTime = 0;
  state: AudioContextState = "suspended";
  resumeCount = 0;
  closeCount = 0;
  readonly destination: StubAudioNode;
  /** Every node this context ever made, in creation order. */
  readonly created: StubAudioNode[] = [];

  constructor(readonly sampleRate = 44100) {
    this.destination = new StubAudioNode("destination", this);
  }

  #track<T extends StubAudioNode>(node: T): T {
    this.created.push(node);
    return node;
  }

  createGain(): StubGainNode {
    return this.#track(new StubGainNode(this));
  }
  createStereoPanner(): StubStereoPannerNode {
    return this.#track(new StubStereoPannerNode(this));
  }
  createBiquadFilter(): StubBiquadFilterNode {
    return this.#track(new StubBiquadFilterNode(this));
  }
  createOscillator(): StubOscillatorNode {
    return this.#track(new StubOscillatorNode(this));
  }
  createBufferSource(): StubAudioBufferSourceNode {
    return this.#track(new StubAudioBufferSourceNode(this));
  }
  createDynamicsCompressor(): StubDynamicsCompressorNode {
    return this.#track(new StubDynamicsCompressorNode(this));
  }
  createAnalyser(): StubAnalyserNode {
    return this.#track(new StubAnalyserNode(this));
  }
  createBuffer(channels: number, length: number, sampleRate: number): StubAudioBuffer {
    return new StubAudioBuffer(channels, length, sampleRate);
  }

  async resume(): Promise<void> {
    this.resumeCount += 1;
    this.state = "running";
  }

  async close(): Promise<void> {
    this.closeCount += 1;
    this.state = "closed";
  }

  /** Nodes of one kind, creation order — `ctx.nodesOfKind("oscillator")`. */
  nodesOfKind(kind: StubNodeKind): StubAudioNode[] {
    return this.created.filter((node) => node.kind === kind);
  }
}

/** An `OfflineAudioContext` stub: same factories plus `startRendering()`. */
export class StubOfflineAudioContext extends StubAudioContext {
  renderCount = 0;

  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    sampleRate = 44100,
  ) {
    super(sampleRate);
    this.state = "suspended";
  }

  async startRendering(): Promise<StubAudioBuffer> {
    this.renderCount += 1;
    this.state = "closed";
    const buffer = new StubAudioBuffer(this.numberOfChannels, this.length, this.sampleRate);
    // A recognisable non-silent ramp, so WAV encoding assertions see real data.
    for (let c = 0; c < this.numberOfChannels; c += 1) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.sin((i / data.length) * Math.PI);
    }
    return buffer;
  }
}

export function createStubContext(sampleRate = 44100): StubAudioContext {
  return new StubAudioContext(sampleRate);
}

/** The cast every test needs, in one named place. */
export function asBaseContext(ctx: StubAudioContext): BaseAudioContext {
  return ctx as unknown as BaseAudioContext;
}

/** Follow `connect()` edges from `from`; true when `to` is reachable. */
export function isConnected(from: StubAudioNode, to: StubAudioNode): boolean {
  return pathBetween(from, to) !== null;
}

/**
 * The kinds along the first path from `from` to `to`, inclusive — the readable
 * form of a chain assertion (`["gain", "panner", "gain", "compressor"]`).
 */
export function pathBetween(from: StubAudioNode, to: StubAudioNode): StubNodeKind[] | null {
  const seen = new Set<StubAudioNode>();
  const walk = (node: StubAudioNode, trail: StubNodeKind[]): StubNodeKind[] | null => {
    if (node === to) return [...trail, node.kind];
    if (seen.has(node)) return null;
    seen.add(node);
    for (const next of node.outputs) {
      const found = walk(next, [...trail, node.kind]);
      if (found !== null) return found;
    }
    return null;
  };
  return walk(from, []);
}
