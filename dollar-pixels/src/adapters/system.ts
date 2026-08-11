/**
 * The two smallest adapters: time and identity.
 *
 * Both exist so tests can be deterministic. A test that asserts a hold expires
 * should not depend on how long the test took to run, and a snapshot assertion
 * should not depend on a random id.
 */

import { nanoid } from "nanoid";
import type { Clock, IdGen } from "@/ports";

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** A clock you can move by hand. */
export class FixedClock implements Clock {
  private current: Date;

  constructor(start: Date | string = "2026-01-01T00:00:00.000Z") {
    this.current = typeof start === "string" ? new Date(start) : new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  set(to: Date | string): void {
    this.current = typeof to === "string" ? new Date(to) : new Date(to);
  }
}

/** `ord_V1StGXR8`, `clm_…` — the prefix makes a stray id readable in a log. */
export class NanoIdGen implements IdGen {
  next(prefix: string): string {
    return `${prefix}_${nanoid(12)}`;
  }
}

/** Deterministic ids for tests: `ord_1`, `ord_2`, … per prefix. */
export class SeqIdGen implements IdGen {
  private readonly counters = new Map<string, number>();

  next(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}_${n}`;
  }
}
