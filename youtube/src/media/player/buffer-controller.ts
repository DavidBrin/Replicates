/**
 * The buffer controller: everything that touches a `SourceBuffer`.
 *
 * Two things make this module worth isolating. The first is that MSE's append
 * and remove operations are asynchronous behind a *synchronous* flag —
 * `appendBuffer()` sets `updating = true` immediately and every further call
 * throws `InvalidStateError` until `updateend` fires (research §1). There is no
 * promise to await, so a serial queue is not a nicety here; a player without one
 * throws on its second segment. Every operation below goes through
 * `runExclusive`, and the invariant "we never call into the buffer while
 * `updating` is true" is asserted directly in the tests.
 *
 * The second is `QuotaExceededError`, which research §4 is emphatic is a real
 * event rather than a theoretical one — and which **Safari has historically not
 * thrown at all**, so the reactive recovery below cannot be the only defence.
 * The proactive half is `evictBackBuffer` plus the targets in `BUFFER_TARGETS`,
 * which bound growth whether or not the engine ever tells us we have overrun.
 *
 * The controller is typed against `SourceBufferLike`, not `SourceBuffer`, for
 * the same reason the muxer is typed against plain structs rather than WebCodecs
 * types (`DECISIONS.md` D4): a `SourceBuffer` cannot be constructed in Node, so
 * code typed against it can only ever be tested in a browser. A real
 * `SourceBuffer` and a real `ManagedSourceBuffer` both satisfy this interface
 * structurally — `__tests__/buffer-controller.test.ts` asserts the first of those
 * at compile time.
 *
 * **What a fake proves and what it does not.** Everything here is logic: queue
 * ordering, recovery sequencing, which byte ranges get removed. A fake
 * `SourceBuffer` proves all of that and none of whether a real decoder accepts
 * the bytes we hand it. That belongs in Playwright.
 */

/* ------------------------------------------------------------- the shapes -- */

/** The `TimeRanges` surface we read. `TimeRanges` satisfies it. */
export interface TimeRangesLike {
  readonly length: number;
  start(index: number): number;
  end(index: number): number;
}

/**
 * What `appendBuffer` accepts here.
 *
 * Wider than the DOM's `BufferSource`, which since TypeScript 5.7 is pinned to
 * `ArrayBufferView<ArrayBuffer>` and therefore excludes the plain
 * `Uint8Array<ArrayBufferLike>` that `fetch` and our own muxer both produce.
 * Narrowing at every call site would mean a cast per append; widening once here
 * costs nothing, because a real `SourceBuffer` still satisfies this interface —
 * method parameters are compared bivariantly.
 */
export type AppendableBuffer = ArrayBufferView | ArrayBufferLike;

/** The `SourceBuffer` surface we touch. `SourceBuffer`/`ManagedSourceBuffer` satisfy it. */
export interface SourceBufferLike {
  readonly updating: boolean;
  readonly buffered: TimeRangesLike;
  appendBuffer(data: AppendableBuffer): void;
  remove(start: number, end: number): void;
  abort(): void;
  changeType(type: string): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface BufferedRange {
  readonly start: number;
  readonly end: number;
}

/* ------------------------------------------------------------ the targets -- */

export interface BufferTargets {
  /**
   * Steady-state forward runway to maintain, in seconds.
   *
   * research §4 recommends 20–30s, matching hls.js's `maxBufferLength = 30` and
   * dash.js's `bufferTimeAtTopQuality = 30`. 24 is inside that band and is
   * exactly twelve of our 2s segments, so the fetch loop's decisions land on
   * segment boundaries instead of half a segment past one.
   */
  readonly forwardSeconds: number;
  /**
   * Runway to reach before the first frame is expected to play.
   *
   * research §4: 4–8s, i.e. 2–4 segments. Six seconds is three segments — enough
   * that the ABR selector's `bufferLowSeconds` floor is satisfied the moment
   * playback starts, so the player does not begin its life pinned to the lowest
   * rung by its own safety rule.
   */
  readonly startupSeconds: number;
  /**
   * How much played-out data to keep behind `currentTime`.
   *
   * research §4: 10–20s, "enough for scrub-back without a network round trip".
   * hls.js's own `backBufferLength` default is `Infinity` — it does not evict at
   * all and leans on the browser — and §4 says explicitly not to copy that,
   * because the browser's eviction is silent on Safari.
   */
  readonly backSeconds: number;
  /**
   * Byte ceiling across everything buffered. hls.js's `maxBufferSize` default
   * (research §4), which exists so a high-bitrate ladder cannot blow past a
   * seconds-based target.
   */
  readonly maxBytes: number;
  /**
   * A window around `currentTime` that eviction never touches.
   *
   * research §4 says "never touch the currently-playing GOP or a small guard
   * window around `currentTime`" without naming a value. Two segments is
   * **assumed, not measured**: one would be the minimum defensible number, and
   * the spec's range removal works on coded frame *groups* whose boundaries an
   * implementation may round outward past the range we asked for.
   */
  readonly evictionGuardSeconds: number;
}

export const BUFFER_TARGETS: BufferTargets = {
  forwardSeconds: 24,
  startupSeconds: 6,
  backSeconds: 15,
  maxBytes: 60_000_000,
  evictionGuardSeconds: 4,
};

/* -------------------------------------------------------- pure range math -- */

export function toRanges(ranges: TimeRangesLike): readonly BufferedRange[] {
  const out: BufferedRange[] = [];
  for (let index = 0; index < ranges.length; index += 1) {
    out.push({ start: ranges.start(index), end: ranges.end(index) });
  }
  return out;
}

/**
 * Small enough to be inside a range's edge without being past it.
 *
 * `buffered` boundaries carry the rounding of a media timescale, so a
 * `currentTime` that is conceptually "exactly at the start of the buffer" can
 * read a few microseconds below `start(0)`. Treating that as unbuffered is how a
 * player decides it needs to fetch a segment it already has.
 */
const RANGE_EPSILON_SECONDS = 1 / 1000;

export function rangeContaining(
  ranges: readonly BufferedRange[],
  time: number,
): BufferedRange | null {
  for (const range of ranges) {
    if (time >= range.start - RANGE_EPSILON_SECONDS && time < range.end) return range;
  }
  return null;
}

/**
 * Forward runway from `time`, in seconds — **zero when `time` sits in a gap.**
 *
 * This function is the whole of research §5's stall bug, in one place. The
 * natural implementation is "the end of the last buffered range minus
 * `currentTime`", which after a seek into an unbuffered hole reports a large,
 * comfortable number computed from data that lives somewhere the playhead is
 * not. The fetch loop then decides it has plenty of runway, fetches nothing, and
 * the element sits at `HAVE_METADATA` forever with **no error and often no
 * `stalled` or `waiting` event**, because native stall detection is heuristic
 * and can miss a gap the app already knows about.
 *
 * Measuring from the range *containing* `time`, and returning 0 when there is
 * none, makes that state look exactly like the empty buffer it effectively is —
 * which is what makes the engine's ordinary "buffer is low, fetch" path handle a
 * seek correctly instead of needing to be told about it.
 */
export function bufferedAhead(ranges: readonly BufferedRange[], time: number): number {
  const range = rangeContaining(ranges, time);
  return range === null ? 0 : Math.max(0, range.end - time);
}

/** Total buffered seconds across every range. Used for the byte-ceiling estimate. */
export function totalBuffered(ranges: readonly BufferedRange[]): number {
  return ranges.reduce((sum, range) => sum + (range.end - range.start), 0);
}

/* --------------------------------------------------------------- failures -- */

/**
 * Recovery ran out of things to evict.
 *
 * Distinct from a generic append failure because the caller's response is
 * different and specific: research §4's last two steps are "force a downswitch
 * to a lower-bitrate rendition (smaller segments)" and then "surface a real
 * out-of-memory error to the UI rather than looping".
 */
export class BufferQuotaError extends Error {
  readonly attempts: number;

  constructor(message: string, attempts: number) {
    super(message);
    this.name = "BufferQuotaError";
    this.attempts = attempts;
  }
}

/** A `SourceBuffer` `error` event, which carries no detail of its own. */
export class SourceBufferAppendError extends Error {
  constructor(operation: string) {
    super(
      `The SourceBuffer fired "error" during ${operation}. MSE gives no reason with ` +
        "this event; the usual causes are a malformed segment or an append that " +
        "does not match the initialization segment currently in force.",
    );
    this.name = "SourceBufferAppendError";
  }
}

/**
 * Is this the quota exception, however the engine chose to spell it?
 *
 * Chrome and Firefox throw a `DOMException` named `QuotaExceededError`; the
 * legacy numeric `code` 22 is the same thing on older engines. Safari, per
 * research §4, may throw nothing at all — which is why `evictBackBuffer` exists
 * and is not merely an optimisation.
 */
export function isQuotaExceededError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return candidate.name === "QuotaExceededError" || candidate.code === 22;
}

/* ------------------------------------------------------------- controller -- */

export interface BufferControllerOptions {
  readonly sourceBuffer: SourceBufferLike;
  /** Reads the playhead. Eviction is always relative to where playback actually is. */
  readonly currentTime: () => number;
  readonly targets?: Partial<BufferTargets>;
  /** Labels errors and log lines. `"video"` or `"audio"`. */
  readonly label?: string;
}

export class BufferController {
  private readonly sourceBuffer: SourceBufferLike;
  private readonly currentTime: () => number;
  private readonly label: string;
  readonly targets: BufferTargets;

  /** Serialises every operation. See `runExclusive`. */
  private chain: Promise<unknown> = Promise.resolve();
  private destroyed = false;

  /** Set once an initialization segment has been appended for the current type. */
  private primed = false;

  private appendedBytes = 0;
  private appendedSeconds = 0;

  /** research §8 wants this to be zero on a steady-state trace. */
  quotaExceededCount = 0;
  evictionCount = 0;

  constructor(options: BufferControllerOptions) {
    this.sourceBuffer = options.sourceBuffer;
    this.currentTime = options.currentTime;
    this.label = options.label ?? "media";
    this.targets = { ...BUFFER_TARGETS, ...options.targets };
  }

  get isPrimed(): boolean {
    return this.primed;
  }

  get ranges(): readonly BufferedRange[] {
    return toRanges(this.sourceBuffer.buffered);
  }

  bufferedAhead(time = this.currentTime()): number {
    return bufferedAhead(this.ranges, time);
  }

  hasDataAt(time: number): boolean {
    return rangeContaining(this.ranges, time) !== null;
  }

  /**
   * Bytes currently held, estimated.
   *
   * There is no way to ask MSE this. What we know exactly is how many bytes we
   * appended and how many seconds of media those bytes represented; scaling that
   * ratio by what is still buffered is an approximation that is wrong in
   * proportion to how much the bitrate has varied across a switch — which is
   * acceptable for a ceiling whose job is to stop a 4K ladder from running away,
   * and would not be acceptable for anything a viewer can see.
   */
  get estimatedBytes(): number {
    if (this.appendedSeconds <= 0) return 0;
    const bytesPerSecond = this.appendedBytes / this.appendedSeconds;
    return Math.round(bytesPerSecond * totalBuffered(this.ranges));
  }

  /* ------------------------------------------------------------ operations -- */

  /**
   * Run one `SourceBuffer` operation with the buffer to itself.
   *
   * The chain is the queue: each operation waits on the previous one's
   * settlement before it even looks at `updating`. `chain` swallows rejections
   * so that one failed append does not poison every operation behind it — the
   * *caller* still sees the rejection through the returned promise.
   */
  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.chain.then(operation, operation);
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  /** Resolves once `updating` is false — the queue's own precondition. */
  private whenIdle(): Promise<void> {
    if (!this.sourceBuffer.updating) return Promise.resolve();
    return new Promise((resolve) => {
      const done = (): void => {
        this.sourceBuffer.removeEventListener("updateend", done);
        resolve();
      };
      this.sourceBuffer.addEventListener("updateend", done);
    });
  }

  /**
   * Invoke a `SourceBuffer` method and wait for its `updateend`.
   *
   * `abort()` is worth understanding here: it fires `abort` *and then*
   * `updateend`, so a pending operation resolves rather than hanging — which is
   * exactly what the seek and rendition-switch paths want (research §3, §5).
   */
  private async invoke(name: string, call: () => void): Promise<void> {
    await this.whenIdle();
    if (this.destroyed) {
      throw new Error(`The ${this.label} buffer controller was destroyed mid-queue`);
    }

    return new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        this.sourceBuffer.removeEventListener("updateend", onEnd);
        this.sourceBuffer.removeEventListener("error", onError);
      };
      const onEnd = (): void => {
        cleanup();
        resolve();
      };
      const onError = (): void => {
        cleanup();
        reject(new SourceBufferAppendError(`${this.label} ${name}`));
      };

      this.sourceBuffer.addEventListener("updateend", onEnd);
      this.sourceBuffer.addEventListener("error", onError);

      try {
        call();
      } catch (error) {
        // `appendBuffer` throws QuotaExceededError *synchronously*, before
        // `updating` is ever set, so no event is coming and the listeners have
        // to come off here or they leak onto the next operation's updateend.
        cleanup();
        reject(error);
      }
    });
  }

  /**
   * Append an initialization segment and mark the buffer primed.
   *
   * Kept separate from `append` because the distinction is load-bearing on every
   * rendition switch (research §3): the `moov` box carries the decoder
   * configuration — SPS/PPS for AVC, the VP9 config record, sample dimensions —
   * for *that specific rendition*, and a 720p encode's configuration differs from
   * 360p's even within one codec family. `changeType()` alone declares the MIME
   * type of what follows and does not supply any of that, so **the init segment
   * must be re-appended on every switch, always.**
   */
  appendInitSegment(data: AppendableBuffer): Promise<void> {
    return this.runExclusive(async () => {
      await this.invoke("init append", () => this.sourceBuffer.appendBuffer(data));
      this.primed = true;
    });
  }

  /**
   * Append a media segment, recovering from a quota failure.
   *
   * `durationSeconds` is only used to keep the bytes-per-second estimate honest;
   * passing 0 leaves the estimate alone rather than corrupting it.
   */
  append(data: AppendableBuffer, durationSeconds = 0): Promise<void> {
    return this.runExclusive(async () => {
      await this.appendWithRecovery(data, 0);
      this.appendedBytes += data.byteLength;
      this.appendedSeconds += durationSeconds;
    });
  }

  /**
   * research §4's recovery procedure, as an escalating ladder.
   *
   * Each rung frees strictly more than the last, and the sequence stops as soon
   * as an append succeeds. The steps are: evict back-buffer down to the target,
   * then evict *all* back-buffer up to the guard window, then discard forward
   * buffer beyond the steady-state target, then give up.
   *
   * §4's step 5 also suggests retrying with a smaller byte slice of the same
   * segment. **That step is deliberately not implemented.** Splitting an append
   * changes how many bytes cross the boundary at once, not how many bytes end up
   * resident — the segment parser accumulates them all the same — so it cannot
   * fix a genuine capacity problem, only a hypothetical allocator one. The rung
   * that actually helps is the next one: `BufferQuotaError` tells the engine to
   * force a downswitch, and lower-bitrate segments are genuinely fewer bytes.
   */
  private async appendWithRecovery(
    data: AppendableBuffer,
    fromRung: number,
    attempt = 1,
  ): Promise<void> {
    try {
      await this.invoke("append", () => this.sourceBuffer.appendBuffer(data));
      return;
    } catch (error) {
      if (!isQuotaExceededError(error)) throw error;
      this.quotaExceededCount += 1;

      const now = this.currentTime();
      const used = await this.freeSpace(fromRung, now);
      if (used === null) {
        throw new BufferQuotaError(
          `The ${this.label} buffer is full and there is nothing left to evict outside the ` +
            `${this.targets.evictionGuardSeconds}s guard around ${now.toFixed(2)}s. ` +
            "The engine should force a downswitch before retrying.",
          attempt,
        );
      }
      await this.appendWithRecovery(data, used + 1, attempt + 1);
    }
  }

  /** How many rungs `evictAtRung` knows about. */
  private static readonly RECOVERY_RUNGS = 3;

  /**
   * Free space, starting at `fromRung` and climbing until something is actually
   * removed. Returns the rung that worked, or `null` if none did.
   *
   * Climbing rather than trying one rung per append is the whole correctness
   * point here, and it was a bug first: a rung that frees *nothing* — a buffer
   * with less back-buffer than the target, say — must not end the recovery, or
   * the next rung that would have freed plenty is never reached and playback
   * fails with a full buffer and 30 seconds of evictable data sitting in it.
   *
   * research §4 step 1 is `sourceBuffer.abort()`. It is called inside a `try`
   * because it is genuinely optional in this situation and can itself throw: the
   * spec runs coded frame eviction *inside* `appendBuffer` and throws before
   * setting `updating`, so there is no partial append to reset — but an engine
   * that sets the flag first would leave one, and `abort()` throws
   * `InvalidStateError` if the `MediaSource` is no longer open. Belt and braces,
   * loudly commented so nobody later removes it as dead code or "fixes" the
   * swallowed exception.
   */
  private async freeSpace(fromRung: number, now: number): Promise<number | null> {
    try {
      this.sourceBuffer.abort();
    } catch {
      /* nothing to reset, or the source has already closed. Either is fine. */
    }

    for (let rung = fromRung; rung < BufferController.RECOVERY_RUNGS; rung += 1) {
      if (await this.evictAtRung(rung, now)) return rung;
    }
    return null;
  }

  /** One rung of the ladder, each freeing strictly more than the last. */
  private async evictAtRung(rung: number, now: number): Promise<boolean> {
    const ranges = this.ranges;
    const first = ranges[0];
    const last = ranges[ranges.length - 1];
    if (first === undefined || last === undefined) return false;

    const guard = now - this.targets.evictionGuardSeconds;

    switch (rung) {
      case 0:
        // Played-out data beyond the back-buffer target: the cheapest thing to
        // lose, because it is what steady-state eviction would take anyway.
        return this.removeIfAny(first.start, Math.min(now - this.targets.backSeconds, guard));
      case 1:
        // The rest of the back buffer, up to the guard. Costs a scrub-back.
        return this.removeIfAny(first.start, guard);
      case 2:
        // Forward buffer beyond the steady-state target is data we would have
        // fetched again anyway; dropping it is cheaper than failing playback.
        return this.removeIfAny(now + this.targets.forwardSeconds, last.end);
      default:
        return false;
    }
  }

  private async removeIfAny(start: number, end: number): Promise<boolean> {
    // `remove()` throws TypeError on a non-positive range, and a zero-width
    // removal would spend an updateend to accomplish nothing.
    if (!(end > start)) return false;
    await this.invoke("remove", () => this.sourceBuffer.remove(start, end));
    this.evictionCount += 1;
    return true;
  }

  /**
   * Drop played-out data beyond the back-buffer target.
   *
   * Proactive, and called on a timer rather than only on quota, because research
   * §4 records that Safari does not reliably throw `QuotaExceededError` at all —
   * so a player that only evicts reactively evicts never, on the one engine with
   * the largest buffer budget and the least tolerance for being wrong about it.
   */
  evictBackBuffer(time = this.currentTime()): Promise<boolean> {
    return this.runExclusive(async () => {
      const ranges = this.ranges;
      const first = ranges[0];
      if (first === undefined) return false;
      const to = Math.min(time - this.targets.backSeconds, time - this.targets.evictionGuardSeconds);
      return this.removeIfAny(first.start, to);
    });
  }

  /**
   * Discard forward buffer from `time` onward.
   *
   * research §3 step 2: used for an aggressive "replace what is already buffered"
   * switch, and by the engine when a manual quality pick lands on a rendition
   * that is not what is buffered ahead. Not used for a routine ABR step at a
   * segment boundary, where there is nothing forward to remove yet.
   */
  removeForward(time: number): Promise<boolean> {
    return this.runExclusive(async () => {
      const ranges = this.ranges;
      const last = ranges[ranges.length - 1];
      if (last === undefined) return false;
      return this.removeIfAny(time, last.end);
    });
  }

  /**
   * `changeType`, for a switch whose codec string differs from what the buffer
   * currently expects.
   *
   * research §3 says to treat "the codec string differs at all" as the trigger
   * rather than "the codec family differs", because our packager gives each rung
   * its own `avc1.PPCCLL` — a 360p and a 720p encode legitimately carry different
   * levels — and skipping the call when you should not have is a silent-corruption
   * bug rather than a loud one. Priming is cleared because the parser is reset to
   * "expects an initialization segment".
   */
  changeType(mimeType: string): Promise<void> {
    return this.runExclusive(async () => {
      await this.invoke("changeType", () => this.sourceBuffer.changeType(mimeType));
      this.primed = false;
    });
  }

  /**
   * Abort an in-flight append and reset the parser.
   *
   * research §3 step 1 and §5 step (b). After this the parser expects an
   * initialization segment again and the append window is back to
   * `[0, +Infinity)`, so `primed` is false — a switch or seek path that skips the
   * init re-append after calling this appends `moof` boxes into a parser that has
   * no `moov` to interpret them with.
   */
  abort(): void {
    if (!this.sourceBuffer.updating) return;
    try {
      this.sourceBuffer.abort();
      this.primed = false;
    } catch {
      /* The MediaSource closed underneath us; there is nothing left to abort. */
    }
  }

  /**
   * Is there room and reason to fetch more?
   *
   * Both halves are needed: seconds alone let a high-bitrate ladder overshoot the
   * memory budget, and bytes alone would keep fetching a 144p stream long past
   * any useful runway.
   */
  wantsMoreData(target: number, time = this.currentTime()): boolean {
    if (this.estimatedBytes >= this.targets.maxBytes) return false;
    return this.bufferedAhead(time) < target;
  }

  destroy(): void {
    this.destroyed = true;
    this.abort();
  }
}
