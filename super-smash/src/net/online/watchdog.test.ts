import { describe, expect, it } from "vitest";

import { AWAY_LOST_MS, ConnectionWatchdog, SILENCE_LOST_MS, SILENCE_WAITING_MS } from "./watchdog";

describe("ConnectionWatchdog", () => {
  it("is ok while packets keep arriving", () => {
    const dog = new ConnectionWatchdog(0);
    dog.heard(500);
    expect(dog.check(900)).toBe("ok");
  });

  it("restarts the silence clock each time a packet arrives", () => {
    const dog = new ConnectionWatchdog(0);
    dog.heard(9_000);
    // 10.5 s after the start but only 1.5 s after the last packet: without the
    // reset this would already be lost.
    expect(dog.check(10_500)).toBe("waiting");
  });

  it("shows the player it is waiting after a second of silence", () => {
    const dog = new ConnectionWatchdog(0);
    expect(dog.check(SILENCE_WAITING_MS - 1)).toBe("ok");
    expect(dog.check(SILENCE_WAITING_MS)).toBe("waiting");
  });

  it("gives up after ten seconds of silence", () => {
    const dog = new ConnectionWatchdog(0);
    expect(dog.check(SILENCE_LOST_MS - 1)).toBe("waiting");
    expect(dog.check(SILENCE_LOST_MS)).toBe("lost");
  });

  it("gives a backgrounded opponent a minute, not ten seconds", () => {
    const dog = new ConnectionWatchdog(0);
    dog.setPeerAway(true, 1_000);
    expect(dog.peerAway).toBe(true);
    expect(dog.check(1_000 + 30_000)).toBe("waiting");
    expect(dog.check(1_000 + AWAY_LOST_MS - 1)).toBe("waiting");
    expect(dog.check(1_000 + AWAY_LOST_MS)).toBe("lost");
  });

  it("is ok again the moment they come back", () => {
    const dog = new ConnectionWatchdog(0);
    dog.setPeerAway(true, 0);
    dog.setPeerAway(false, 40_000);
    expect(dog.check(40_100)).toBe("ok");
  });

  it("keeps waiting while away even when packets arrive, until they say they are back", () => {
    const dog = new ConnectionWatchdog(0);
    dog.setPeerAway(true, 0);
    dog.heard(500);
    expect(dog.check(600)).toBe("waiting");
    dog.setPeerAway(false, 700);
    expect(dog.check(800)).toBe("ok");
  });

  it("does not latch lost: hearing from them again makes it ok", () => {
    // Giving up for good is the caller's job (it ends the session on the first
    // "lost"); the watchdog only reports how long it has been quiet.
    const dog = new ConnectionWatchdog(0);
    expect(dog.check(SILENCE_LOST_MS)).toBe("lost");
    dog.heard(SILENCE_LOST_MS + 5_000);
    expect(dog.check(SILENCE_LOST_MS + 5_100)).toBe("ok");
  });
});
