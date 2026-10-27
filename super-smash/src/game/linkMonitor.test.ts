import { describe, expect, it, vi } from "vitest";

import { fakeSession } from "@/net/online/testing";
import { AWAY_LOST_MS, SILENCE_LOST_MS, type LinkHealth } from "@/net/online/watchdog";
import { createEmitter } from "@/net/transport";
import { LINK_CHECK_MS, startLinkMonitor } from "./linkMonitor";

function harness({ hidden = false }: { hidden?: boolean } = {}) {
  let clock = 0;
  const ticks: (() => void)[] = [];
  const messages = createEmitter<[Uint8Array, string]>();
  const leaves = createEmitter<[string]>();
  const session = fakeSession("host");
  const health: [LinkHealth, boolean][] = [];
  const onLost = vi.fn();
  const listeners: (() => void)[] = [];
  const visibility = {
    hidden,
    addEventListener: (_type: "visibilitychange", cb: () => void) => {
      listeners.push(cb);
    },
    removeEventListener: (_type: "visibilitychange", cb: () => void) => {
      listeners.splice(listeners.indexOf(cb), 1);
    },
  };
  const stop = startLinkMonitor({
    transport: { onMessage: (cb) => messages.add(cb), onPeerLeave: (cb) => leaves.add(cb) },
    session: session.session,
    onHealth: (h, away) => health.push([h, away]),
    onLost,
    now: () => clock,
    visibility,
    every: (cb, ms) => {
      expect(ms).toBe(LINK_CHECK_MS);
      ticks.push(cb);
      return () => {
        ticks.length = 0;
      };
    },
  });
  const advance = (ms: number) => {
    clock += ms;
    for (const tick of [...ticks]) tick();
  };
  /** This tab going to the background, or coming back. */
  const setHidden = (next: boolean) => {
    visibility.hidden = next;
    for (const cb of [...listeners]) cb();
  };
  return { advance, messages, leaves, session, sent: session.sent, health, onLost, visibility, listeners, ticks, stop, setHidden };
}

describe("the online link monitor", () => {
  it("reports ok once and then stays quiet while packets flow", () => {
    const h = harness();
    for (let i = 0; i < 20; i++) {
      h.messages.emit(new Uint8Array([1]), "g1");
      h.advance(200);
    }
    expect(h.health).toEqual([["ok", false]]);
    expect(h.onLost).not.toHaveBeenCalled();
  });

  it("shows waiting after a second, then gives up after ten silent seconds", () => {
    const h = harness();
    h.advance(1_000);
    expect(h.health.at(-1)).toEqual(["waiting", false]);
    h.advance(SILENCE_LOST_MS);
    expect(h.onLost).toHaveBeenCalledTimes(1);
    h.advance(1_000);
    expect(h.onLost).toHaveBeenCalledTimes(1);
  });

  it("a backgrounded opponent gets a minute, not ten seconds", () => {
    const h = harness();
    h.session.emit({ type: "lobby", message: { kind: "away", away: true } });
    expect(h.health.at(-1)).toEqual(["waiting", true]);
    h.advance(30_000);
    expect(h.onLost).not.toHaveBeenCalled();
    h.advance(AWAY_LOST_MS);
    expect(h.onLost).toHaveBeenCalledTimes(1);
  });

  it("is ok again as soon as the opponent says it is back", () => {
    const h = harness();
    h.session.emit({ type: "lobby", message: { kind: "away", away: true } });
    h.advance(30_000);
    h.session.emit({ type: "lobby", message: { kind: "away", away: false } });
    expect(h.health.at(-1)).toEqual(["ok", false]);
  });

  it("treats the data channel closing as lost at once", () => {
    const h = harness();
    h.leaves.emit("g1");
    expect(h.onLost).toHaveBeenCalledTimes(1);
    expect(h.ticks).toHaveLength(0);
  });

  it("acts on the first lost only, and stops listening for packets", () => {
    const h = harness();
    h.advance(SILENCE_LOST_MS);
    expect(h.onLost).toHaveBeenCalledTimes(1);
    const reports = h.health.length;
    // A packet straggling in after the verdict revives nothing.
    expect(h.messages.size).toBe(0);
    h.messages.emit(new Uint8Array([1]), "g1");
    h.leaves.emit("g1");
    h.session.emit({ type: "lobby", message: { kind: "away", away: false } });
    h.advance(LINK_CHECK_MS);
    expect(h.onLost).toHaveBeenCalledTimes(1);
    expect(h.health).toHaveLength(reports);
  });

  it("tells the opponent when this tab is hidden and when it is back", () => {
    const h = harness();
    h.visibility.hidden = true;
    for (const cb of [...h.listeners]) cb();
    h.visibility.hidden = false;
    for (const cb of [...h.listeners]) cb();
    expect(h.sent).toEqual([
      { kind: "away", away: true },
      { kind: "away", away: false },
    ]);
  });

  it("says it is away at once when the match starts in a hidden tab", () => {
    const h = harness({ hidden: true });
    expect(h.sent).toEqual([{ kind: "away", away: true }]);
    h.setHidden(false);
    expect(h.sent).toEqual([
      { kind: "away", away: true },
      { kind: "away", away: false },
    ]);
  });

  it("says nothing at the start in a visible tab", () => {
    expect(harness().sent).toEqual([]);
  });

  it("does not call the opponent lost for this tab's own time in the background", () => {
    const h = harness();
    h.messages.emit(new Uint8Array([1]), "g1");
    h.advance(LINK_CHECK_MS);
    // Hidden, this tab's own clock and packets can stall; nothing it measures
    // in the meantime is about the opponent.
    h.setHidden(true);
    h.advance(30_000);
    expect(h.onLost).not.toHaveBeenCalled();
    h.setHidden(false);
    h.advance(LINK_CHECK_MS);
    expect(h.onLost).not.toHaveBeenCalled();
    expect(h.health).toEqual([["ok", false]]);
    // Back on screen, silence counts again, from the moment it returned.
    h.advance(SILENCE_LOST_MS);
    expect(h.onLost).toHaveBeenCalledTimes(1);
  });

  it("lets go of everything on stop", () => {
    const h = harness();
    h.stop();
    expect(h.listeners).toHaveLength(0);
    expect(h.ticks).toHaveLength(0);
    h.leaves.emit("g1");
    expect(h.onLost).not.toHaveBeenCalled();
  });
});
