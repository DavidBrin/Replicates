// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  BUFFER_TARGETS,
  BufferController,
  BufferQuotaError,
  SourceBufferAppendError,
  bufferedAhead,
  isQuotaExceededError,
  rangeContaining,
  toRanges,
  totalBuffered,
  type AppendableBuffer,
  type BufferedRange,
  type SourceBufferLike,
  type TimeRangesLike,
} from "../buffer-controller";

/**
 * A fake `SourceBuffer` that behaves like the spec in the two ways that matter.
 *
 * First, **it throws if it is touched while `updating` is true.** That is the
 * real behaviour (`InvalidStateError`, research §1) and it is the single easiest
 * thing for a player to get wrong, because the flag is set synchronously and
 * cleared asynchronously and there is no promise to await. Making the fake
 * hostile about it means the invariant is checked by every test in this file
 * rather than by one test about it.
 *
 * Second, `updating` really is true across a microtask, so a controller that
 * "waits" by doing nothing fails here exactly as it would in a browser.
 *
 * **What this cannot prove**, and the reason it is worth saying out loud: a fake
 * proves the controller's logic — the queue order, the recovery sequence, which
 * ranges are removed — and proves nothing about whether a real decoder accepts
 * the bytes. Byte acceptance is a Playwright question and this file does not
 * pretend to answer it.
 */
class FakeSourceBuffer implements SourceBufferLike {
  updating = false;
  readonly calls: string[] = [];
  /** Ranges the fake reports, mutated by appends and removes. */
  ranges: BufferedRange[] = [];
  /** What the next successful append adds to `ranges`. */
  nextRange: BufferedRange | null = null;
  /** Appends left to reject with a quota error. `Infinity` never stops. */
  quotaFailuresRemaining = 0;
  /** Fire `error` instead of `updateend` on the next operation. */
  failNext = false;
  abortThrows = false;

  private readonly listeners = new Map<string, Set<() => void>>();

  get buffered(): TimeRangesLike {
    const snapshot = [...this.ranges].sort((a, b) => a.start - b.start);
    return {
      length: snapshot.length,
      start: (index: number) => snapshot[index]?.start ?? 0,
      end: (index: number) => snapshot[index]?.end ?? 0,
    };
  }

  addEventListener(type: string, listener: () => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  /** Every listener attached at the moment of firing, so removal mid-dispatch is safe. */
  private fire(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }

  /** Lets a test finish an operation it started by setting `updating` directly. */
  dispatchUpdateEnd(): void {
    this.fire("updateend");
  }

  private guard(operation: string): void {
    if (this.updating) {
      throw Object.assign(
        new Error(`${operation} while updating — a real SourceBuffer throws InvalidStateError`),
        { name: "InvalidStateError" },
      );
    }
  }

  private settle(): void {
    this.updating = true;
    queueMicrotask(() => {
      this.updating = false;
      if (this.failNext) {
        this.failNext = false;
        this.fire("error");
        return;
      }
      this.fire("updateend");
    });
  }

  appendBuffer(data: AppendableBuffer): void {
    this.guard("appendBuffer");
    this.calls.push(`append:${data.byteLength}`);
    if (this.quotaFailuresRemaining > 0) {
      this.quotaFailuresRemaining -= 1;
      // A DOMException in the browser; the name is the part that is load-bearing.
      throw Object.assign(new Error("The buffer is full"), {
        name: "QuotaExceededError",
        code: 22,
      });
    }
    if (this.nextRange !== null) {
      this.mergeRange(this.nextRange);
      this.nextRange = null;
    }
    this.settle();
  }

  remove(start: number, end: number): void {
    this.guard("remove");
    if (!(end > start)) throw new TypeError("remove() needs end > start");
    this.calls.push(`remove:${start}-${end}`);
    this.ranges = this.ranges
      .flatMap((range): BufferedRange[] => {
        if (end <= range.start || start >= range.end) return [range];
        const kept: BufferedRange[] = [];
        if (range.start < start) kept.push({ start: range.start, end: start });
        if (range.end > end) kept.push({ start: end, end: range.end });
        return kept;
      })
      .filter((range) => range.end > range.start);
    this.settle();
  }

  abort(): void {
    this.calls.push("abort");
    if (this.abortThrows) {
      throw Object.assign(new Error("The MediaSource is not open"), {
        name: "InvalidStateError",
      });
    }
    if (!this.updating) return;
    this.updating = false;
    this.fire("abort");
    this.fire("updateend");
  }

  /**
   * Synchronous, and emphatically **no `updateend`**.
   *
   * This called `settle()`, which fires `updateend` like every other operation
   * here — and no real `SourceBuffer` does. MSE specifies `changeType()` as a
   * fully synchronous state change: it resets the parser and sets the new MIME
   * type in the calling task, never sets `updating`, and therefore has no
   * completion event to emit.
   *
   * The controller was awaiting one, so a codec-changing rendition switch
   * hung the buffer queue forever against a real browser and passed here. A
   * double that is more generous than the API it stands for makes the one
   * interesting case the one case nothing tests, so this now models the real
   * behaviour and the controller no longer waits.
   */
  changeType(type: string): void {
    this.guard("changeType");
    this.calls.push(`changeType:${type}`);
  }

  /** `buffered` is spec-normalised: sorted, non-overlapping, contiguous ranges coalesced. */
  private mergeRange(added: BufferedRange): void {
    const all = [...this.ranges, added].sort((a, b) => a.start - b.start);
    const merged: BufferedRange[] = [];
    for (const range of all) {
      const last = merged[merged.length - 1];
      if (last !== undefined && range.start <= last.end + 1e-9) {
        merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, range.end) };
      } else {
        merged.push({ ...range });
      }
    }
    this.ranges = merged;
  }
}

function bytes(count: number): Uint8Array {
  return new Uint8Array(count);
}

interface Harness {
  readonly buffer: FakeSourceBuffer;
  readonly controller: BufferController;
  setTime(seconds: number): void;
}

function harness(
  options: { ranges?: BufferedRange[]; targets?: Partial<typeof BUFFER_TARGETS> } = {},
): Harness {
  const buffer = new FakeSourceBuffer();
  buffer.ranges = options.ranges ?? [];
  let time = 0;
  const controller = new BufferController({
    sourceBuffer: buffer,
    currentTime: () => time,
    targets: options.targets,
    label: "video",
  });
  return {
    buffer,
    controller,
    setTime(seconds) {
      time = seconds;
    },
  };
}

/* ------------------------------------------------------------- structural -- */

describe("the SourceBufferLike surface", () => {
  it("is satisfied structurally by a real SourceBuffer", () => {
    // A compile-time assertion wearing a runtime test's clothes. If the DOM's
    // SourceBuffer ever stops matching — or if this interface grows a method the
    // platform does not have — this stops compiling, which is the point. There is
    // no way to construct one in Node to check at runtime.
    const asLike = (real: SourceBuffer): SourceBufferLike => real;
    const rangesAsLike = (real: TimeRanges): TimeRangesLike => real;
    expect(typeof asLike).toBe("function");
    expect(typeof rangesAsLike).toBe("function");
  });
});

/* ------------------------------------------------------------- range math -- */

describe("buffered range arithmetic", () => {
  const ranges: readonly BufferedRange[] = [
    { start: 0, end: 20 },
    { start: 60, end: 90 },
  ];

  it("reports runway from the range containing the playhead", () => {
    expect(bufferedAhead(ranges, 5)).toBe(15);
    expect(bufferedAhead(ranges, 70)).toBe(20);
  });

  it("reports ZERO runway when the playhead sits in a gap", () => {
    // research §5's stall bug lives here. The natural implementation — "the end
    // of the last range minus currentTime" — would report 50 seconds of runway at
    // t=40, computed entirely from data that lives 20 seconds behind the playhead
    // and 20 seconds ahead of it, and the fetch loop would decide it had nothing
    // to do. The element then sits at HAVE_METADATA forever with no error.
    expect(bufferedAhead(ranges, 40)).toBe(0);
    expect(bufferedAhead(ranges, 95)).toBe(0);
    expect(bufferedAhead([], 0)).toBe(0);
  });

  it("tolerates a playhead a rounding error before a range's start", () => {
    // Media-timescale rounding can put currentTime microseconds below start(0),
    // and treating that as unbuffered makes a player re-fetch what it already has.
    expect(bufferedAhead([{ start: 10, end: 20 }], 9.9997)).toBeGreaterThan(0);
    expect(bufferedAhead([{ start: 10, end: 20 }], 9.9)).toBe(0);
  });

  it("treats a range's exclusive end as outside it", () => {
    expect(rangeContaining(ranges, 20)).toBeNull();
    expect(rangeContaining(ranges, 19.999)).not.toBeNull();
  });

  it("converts a TimeRanges and sums it", () => {
    const buffer = new FakeSourceBuffer();
    buffer.ranges = [...ranges];
    expect(toRanges(buffer.buffered)).toEqual(ranges);
    expect(totalBuffered(ranges)).toBe(50);
  });
});

/* ------------------------------------------------------- the append queue -- */

describe("the append queue", () => {
  it("never touches the buffer while `updating` is true", async () => {
    // The fake throws if this invariant is broken, so three fire-and-forget
    // appends either all succeed or the whole test fails.
    const { buffer, controller } = harness();
    await Promise.all([
      controller.append(bytes(100)),
      controller.append(bytes(200)),
      controller.append(bytes(300)),
    ]);
    expect(buffer.calls).toEqual(["append:100", "append:200", "append:300"]);
  });

  /**
   * The stall this whole pair of comments is about, as an assertion with a
   * deadline.
   *
   * `changeType` returning at all is the property. Awaiting it under the old
   * implementation never settles, so without a timeout the failure mode is a
   * hung suite rather than a red test — and a hung suite gets attributed to
   * the runner. `Promise.race` turns it into a value.
   */
  it("returns from changeType without waiting for an event", async () => {
    const { buffer, controller } = harness();
    const outcome = await Promise.race([
      controller.changeType('video/mp4; codecs="avc1.4d401f"').then(() => "settled"),
      new Promise((resolve) => setTimeout(() => resolve("hung"), 50)),
    ]);

    expect(outcome).toBe("settled");
    expect(buffer.calls).toEqual(['changeType:video/mp4; codecs="avc1.4d401f"']);

    // And the queue is still usable afterwards — a `changeType` that resolved
    // but left `runExclusive` holding its lock would be the same stall one
    // operation later.
    await controller.append(bytes(10));
    expect(buffer.calls).toContain("append:10");
  });

  it("serialises appends against removes and changeTypes too", async () => {
    const { buffer, controller } = harness({ ranges: [{ start: 0, end: 100 }] });
    const results = await Promise.all([
      controller.append(bytes(10)),
      controller.removeForward(50),
      controller.changeType('video/mp4; codecs="avc1.640028"'),
      controller.append(bytes(20)),
    ]);
    expect(results).toHaveLength(4);
    expect(buffer.calls).toEqual([
      "append:10",
      "remove:50-100",
      'changeType:video/mp4; codecs="avc1.640028"',
      "append:20",
    ]);
  });

  it("waits out an operation the engine started outside the queue", async () => {
    const { buffer, controller } = harness();
    // Something else set the flag — a ManagedSourceBuffer doing its own eviction,
    // for instance (research §2). Appending into that is an InvalidStateError.
    buffer.updating = true;
    const appended = controller.append(bytes(64));
    queueMicrotask(() => {
      buffer.updating = false;
      buffer.dispatchUpdateEnd();
    });
    await expect(appended).resolves.toBeUndefined();
  });

  it("lets a caller see a failure without poisoning the operations behind it", async () => {
    const { buffer, controller } = harness();
    buffer.failNext = true;
    await expect(controller.append(bytes(10))).rejects.toBeInstanceOf(SourceBufferAppendError);
    // The queue is still usable, which is what `chain`'s swallowed rejection buys.
    await expect(controller.append(bytes(20))).resolves.toBeUndefined();
  });

  it("marks the buffer primed only after an init segment lands", async () => {
    const { controller } = harness();
    expect(controller.isPrimed).toBe(false);
    await controller.append(bytes(10));
    expect(controller.isPrimed).toBe(false);
    await controller.appendInitSegment(bytes(700));
    expect(controller.isPrimed).toBe(true);
  });

  it("un-primes on changeType, because the parser is reset to expecting an init", async () => {
    const { controller } = harness();
    await controller.appendInitSegment(bytes(700));
    await controller.changeType('video/mp4; codecs="avc1.64001f"');
    expect(controller.isPrimed).toBe(false);
  });
});

/* ------------------------------------------------------- quota + recovery -- */

describe("QuotaExceededError recovery", () => {
  it("recognises the exception however the engine spells it", () => {
    expect(isQuotaExceededError({ name: "QuotaExceededError" })).toBe(true);
    expect(isQuotaExceededError({ code: 22 })).toBe(true);
    expect(isQuotaExceededError(new Error("full"))).toBe(false);
    expect(isQuotaExceededError(null)).toBe(false);
    expect(isQuotaExceededError("QuotaExceededError")).toBe(false);
  });

  it("aborts, evicts played-out data, and retries — in that order", async () => {
    // research §4's procedure. The order is the assertion: an abort after the
    // remove would reset the parser mid-eviction, and a retry before the remove's
    // updateend is an InvalidStateError.
    const h = harness({ ranges: [{ start: 0, end: 120 }] });
    h.setTime(100);
    h.buffer.quotaFailuresRemaining = 1;
    h.buffer.nextRange = { start: 120, end: 122 };

    await h.controller.append(bytes(500_000), 2);

    expect(h.buffer.calls).toEqual([
      "append:500000",
      "abort",
      // Back-buffer target is 15s, so everything before t−15 goes.
      "remove:0-85",
      "append:500000",
    ]);
    expect(h.controller.quotaExceededCount).toBe(1);
    expect(h.controller.ranges).toEqual([{ start: 85, end: 122 }]);
  });

  it("never evicts inside the guard window around the playhead", async () => {
    // research §4: never touch the currently-playing GOP, nor a guard window
    // around currentTime. Ten seconds of back buffer is less than the 15s target,
    // so the first rung frees nothing and the second takes everything up to the
    // guard at t−4 — and stops there rather than removing the frames the decoder
    // is still holding.
    const h = harness({ ranges: [{ start: 90, end: 130 }] });
    h.setTime(100);
    h.buffer.quotaFailuresRemaining = Number.MAX_SAFE_INTEGER;

    await expect(h.controller.append(bytes(1000))).rejects.toBeInstanceOf(BufferQuotaError);

    const removes = h.buffer.calls.filter((call) => call.startsWith("remove:"));
    expect(removes).toEqual(["remove:90-96", "remove:124-130"]);
    // Whatever the escalation does, the window around the playhead survives it.
    expect(h.controller.hasDataAt(100)).toBe(true);
    expect(h.controller.hasDataAt(97)).toBe(true);
  });

  it("keeps the guard even when it is wider than the back-buffer target", async () => {
    // A deployment that tunes `backSeconds` below `evictionGuardSeconds` must not
    // end up removing under the playhead: `evictBackBuffer` takes the minimum of
    // the two boundaries rather than the target alone.
    const h = harness({
      ranges: [{ start: 0, end: 120 }],
      targets: { backSeconds: 1, evictionGuardSeconds: 10 },
    });
    h.setTime(100);
    await h.controller.evictBackBuffer();
    expect(h.buffer.calls).toEqual(["remove:0-90"]);
  });

  it("escalates through back buffer, then all of it, then forward buffer, then gives up", async () => {
    const h = harness({ ranges: [{ start: 0, end: 200 }] });
    h.setTime(100);
    h.buffer.quotaFailuresRemaining = Number.MAX_SAFE_INTEGER;

    const failure = await h.controller.append(bytes(1000)).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(BufferQuotaError);
    expect((failure as BufferQuotaError).attempts).toBe(4);

    expect(h.buffer.calls.filter((call) => call.startsWith("remove:"))).toEqual([
      "remove:0-85", // back buffer beyond the 15s target
      "remove:85-96", // the rest of the back buffer, up to the guard
      "remove:124-200", // forward buffer beyond the 24s steady-state target
    ]);
    // Four appends: the original and one retry per rung that freed something.
    expect(h.buffer.calls.filter((call) => call.startsWith("append:"))).toHaveLength(4);
  });

  it("gives up immediately when there is nothing buffered to evict", async () => {
    const h = harness();
    h.buffer.quotaFailuresRemaining = Number.MAX_SAFE_INTEGER;
    await expect(h.controller.append(bytes(10))).rejects.toThrow(/nothing left to evict/);
  });

  it("survives an abort() that throws because the MediaSource already closed", async () => {
    const h = harness({ ranges: [{ start: 0, end: 120 }] });
    h.setTime(100);
    h.buffer.abortThrows = true;
    h.buffer.quotaFailuresRemaining = 1;
    await expect(h.controller.append(bytes(10))).resolves.toBeUndefined();
  });

  it("passes a non-quota failure straight through rather than evicting over it", async () => {
    const h = harness({ ranges: [{ start: 0, end: 120 }] });
    h.buffer.failNext = true;
    await expect(h.controller.append(bytes(10))).rejects.toBeInstanceOf(SourceBufferAppendError);
    expect(h.buffer.calls).not.toContain("abort");
  });
});

/* ------------------------------------------------------------- eviction --- */

describe("proactive eviction", () => {
  it("keeps the back-buffer target and drops what is behind it", async () => {
    // Proactive rather than reactive because research §4 records that Safari does
    // not reliably throw QuotaExceededError at all — so a player that only evicts
    // on the exception evicts never, on the engine with the largest budget.
    const h = harness({ ranges: [{ start: 0, end: 120 }] });
    h.setTime(100);
    await expect(h.controller.evictBackBuffer()).resolves.toBe(true);
    expect(h.buffer.calls).toEqual(["remove:0-85"]);
    expect(h.controller.ranges).toEqual([{ start: 85, end: 120 }]);
  });

  it("does nothing when there is less back buffer than the target", async () => {
    const h = harness({ ranges: [{ start: 90, end: 120 }] });
    h.setTime(100);
    await expect(h.controller.evictBackBuffer()).resolves.toBe(false);
    expect(h.buffer.calls).toEqual([]);
  });

  it("does nothing on an empty buffer", async () => {
    const h = harness();
    await expect(h.controller.evictBackBuffer(50)).resolves.toBe(false);
  });

  it("discards forward buffer for a fast switch, keeping the guard", async () => {
    const h = harness({ ranges: [{ start: 0, end: 120 }] });
    await expect(h.controller.removeForward(30)).resolves.toBe(true);
    expect(h.controller.ranges).toEqual([{ start: 0, end: 30 }]);
  });
});

/* ------------------------------------------------------------ fetch gate -- */

describe("wantsMoreData", () => {
  it("asks for data while the runway is under target", () => {
    const h = harness({ ranges: [{ start: 0, end: 10 }] });
    expect(h.controller.wantsMoreData(24, 0)).toBe(true);
    expect(h.controller.wantsMoreData(24, 0 + 9)).toBe(true);
    expect(h.controller.wantsMoreData(5, 0)).toBe(false);
  });

  it("asks for data after a seek into a gap, where the runway reads zero", () => {
    // The same structural fix as `bufferedAhead`: an end-of-buffer-relative gate
    // would answer "no" here and the player would stall forever.
    const h = harness({ ranges: [{ start: 0, end: 20 }] });
    expect(h.controller.wantsMoreData(24, 60)).toBe(true);
  });

  it("stops at the byte ceiling even when the seconds target is not met", async () => {
    // hls.js's `maxBufferSize` (research §4), which exists so a high-bitrate
    // ladder cannot blow past a seconds-based target.
    const h = harness({ targets: { maxBytes: 1000 } });
    h.buffer.nextRange = { start: 0, end: 2 };
    await h.controller.append(bytes(5000), 2);
    expect(h.controller.estimatedBytes).toBe(5000);
    expect(h.controller.wantsMoreData(24, 0)).toBe(false);
  });

  it("estimates zero bytes before anything with a duration has been appended", async () => {
    const h = harness();
    await h.controller.appendInitSegment(bytes(700));
    expect(h.controller.estimatedBytes).toBe(0);
  });
});

/* --------------------------------------------------------------- teardown -- */

describe("abort and destroy", () => {
  it("does not call abort() when nothing is in flight", () => {
    const h = harness();
    h.controller.abort();
    expect(h.buffer.calls).toEqual([]);
  });

  it("aborts an in-flight operation and un-primes the parser", async () => {
    const h = harness();
    await h.controller.appendInitSegment(bytes(700));
    h.buffer.updating = true;
    h.controller.abort();
    expect(h.buffer.calls).toContain("abort");
    expect(h.controller.isPrimed).toBe(false);
  });

  it("refuses queued work after destroy rather than touching a dead buffer", async () => {
    const h = harness();
    const queued = h.controller.append(bytes(10));
    h.controller.destroy();
    await queued.catch(() => undefined);
    await expect(h.controller.append(bytes(10))).rejects.toThrow(/destroyed mid-queue/);
  });
});

/* -------------------------------------------------------------- constants -- */

describe("the buffer targets", () => {
  it("sits inside the bands research §4 recommends", () => {
    // Not decoration: these are the numbers a deployment tunes, and a change that
    // leaves the documented band should have to say so here first.
    expect(BUFFER_TARGETS.forwardSeconds).toBeGreaterThanOrEqual(20);
    expect(BUFFER_TARGETS.forwardSeconds).toBeLessThanOrEqual(30);
    expect(BUFFER_TARGETS.startupSeconds).toBeGreaterThanOrEqual(4);
    expect(BUFFER_TARGETS.startupSeconds).toBeLessThanOrEqual(8);
    expect(BUFFER_TARGETS.backSeconds).toBeGreaterThanOrEqual(10);
    expect(BUFFER_TARGETS.backSeconds).toBeLessThanOrEqual(20);
    expect(BUFFER_TARGETS.maxBytes).toBe(60_000_000);
  });

  it("starts up with more runway than the ABR selector's own low-buffer floor", () => {
    // Otherwise the player begins its life below `bufferLowSeconds` and is pinned
    // to the lowest rung by its own safety rule for the first several segments.
    expect(BUFFER_TARGETS.startupSeconds).toBeGreaterThanOrEqual(6);
  });
});
