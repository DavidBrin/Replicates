import { describe, expect, it, vi } from "vitest";

import { STRONG_COUNTER_DAMAGE } from "@/engine/counter";
import { fx } from "@/engine/fixed";
import { emptyEvents, type StepEvents } from "@/engine/types";
import { AudioEngine, STRONG_COUNTER_WINDOW } from "./index";
import { MockAudioContext, asAudioContext } from "./mockContext";

function makeEngine(options: { muted?: boolean } = {}) {
  const mock = new MockAudioContext();
  const engine = new AudioEngine({
    contextFactory: () => asAudioContext(mock),
    ...options,
  });
  return { mock, engine };
}

async function running() {
  const { mock, engine } = makeEngine();
  await engine.resume();
  return { mock, engine };
}

/**
 * A listener target with no jsdom underneath it.
 *
 * jsdom's `EventTarget` walks a document to build the event path, which a
 * detached one does not have. The engine only ever calls `addEventListener`
 * and `removeEventListener`, so a duck-typed target is both sufficient and a
 * better test — it shows exactly which listeners were registered and removed.
 */
function fakeTarget() {
  const listeners = new Map<string, () => void>();
  const target = {
    addEventListener(kind: string, handler: EventListenerOrEventListenerObject) {
      listeners.set(kind, handler as () => void);
    },
    removeEventListener(kind: string) {
      listeners.delete(kind);
    },
  };
  return {
    asEventTarget: target as unknown as EventTarget,
    kinds: () => [...listeners.keys()],
    fire: (kind: string) => listeners.get(kind)?.(),
  };
}

function hit(overrides: Partial<StepEvents["hits"][number]> = {}): StepEvents {
  const events = emptyEvents();
  events.hits.push({
    attacker: 0,
    victim: 1,
    damage: fx(3),
    x: 0,
    y: 0,
    contactX: 0,
    contactY: 0,
    knockback: fx(20),
    angle: 0, hitboxId: 0,
    ...overrides,
  });
  return events;
}

describe("the autoplay policy", () => {
  it("makes no sound before the context is running", () => {
    // A browser starts an AudioContext suspended and refuses to start it
    // without a gesture. Scheduling into it anyway would queue the whole match
    // up to blast out at once the moment somebody clicks.
    const { mock, engine } = makeEngine();
    engine.handleEvents(hit());
    engine.playUi("confirm");
    expect(engine.running).toBe(false);
    expect(mock.created).toHaveLength(0);
  });

  it("builds the graph and starts on resume", async () => {
    const { mock, engine } = await running();
    expect(engine.running).toBe(true);
    expect(mock.state).toBe("running");
    // Master and SFX buses, wired to the destination.
    expect(mock.created).toHaveLength(2);
    const [master, sfxBus] = mock.created;
    expect(sfxBus.outputs).toEqual([master]);
    expect(master.outputs).toEqual([mock.destination]);
  });

  it("starts on the first gesture of any kind, then unhooks itself", async () => {
    const { mock, engine } = makeEngine();
    const target = fakeTarget();
    engine.unlockOnGesture(target.asEventTarget);

    expect(target.kinds()).toEqual(["pointerdown", "keydown", "touchstart"]);
    target.fire("keydown");
    await Promise.resolve();

    expect(mock.state).toBe("running");
    expect(engine.running).toBe(true);
    expect(target.kinds()).toEqual([]);
  });

  it("can be unhooked before anybody touches anything", () => {
    const { mock, engine } = makeEngine();
    const target = fakeTarget();
    const remove = engine.unlockOnGesture(target.asEventTarget);
    remove();
    target.fire("pointerdown");
    expect(mock.state).toBe("suspended");
  });

  it("does nothing when handed something that cannot listen", () => {
    // Server rendering: `globalThis` has no `addEventListener`.
    const { engine } = makeEngine();
    expect(() => engine.unlockOnGesture({} as EventTarget)()).not.toThrow();
  });

  it("survives a browser with no Web Audio at all", () => {
    const engine = new AudioEngine({
      contextFactory: () => {
        throw new Error("no AudioContext here");
      },
    });
    expect(async () => {
      await engine.resume();
      engine.handleEvents(hit());
    }).not.toThrow();
    expect(engine.running).toBe(false);
  });

  it("resumes again after the tab was backgrounded", async () => {
    const { mock, engine } = await running();
    await mock.suspend();
    expect(engine.running).toBe(false);
    await engine.resume();
    expect(engine.running).toBe(true);
    // The graph was not rebuilt — only two bus nodes, still.
    expect(mock.created.filter((n) => n.kind === "gain")).toHaveLength(2);
  });
});

describe("driven by events, never by state", () => {
  it("plays one punch for one hit event", async () => {
    const { mock, engine } = await running();
    const before = mock.created.length;
    engine.handleEvents(hit());
    expect(mock.created.length).toBeGreaterThan(before);
  });

  it("plays nothing for a frame that reports nothing", async () => {
    // This is the property that makes a rollback silent. The session hands
    // over `emptyEvents()` for every frame it re-simulates, so eight replayed
    // frames of a punch produce one punch — the one the caller already heard.
    const { mock, engine } = await running();
    const before = mock.created.length;

    for (let i = 0; i < 8; i++) engine.handleEvents(emptyEvents());

    expect(mock.created.length).toBe(before);
  });

  it("plays one hit sound when four fighters connect on the same frame", async () => {
    // Four copies of one synthesised waveform is not four sounds; it is one
    // sound six decibels louder, and four times the node graph.
    const single = await running();
    single.engine.handleEvents(hit());
    const perHit = single.mock.created.length;

    const many = await running();
    const events = emptyEvents();
    for (let i = 0; i < 4; i++) {
      events.hits.push({ attacker: i, victim: 3 - i, damage: fx(3), x: 0, y: 0, contactX: 0, contactY: 0, knockback: fx(20), angle: 0, hitboxId: 0 });
    }
    many.engine.handleEvents(events);

    expect(many.mock.created.length).toBe(perHit);
  });

  it("picks the heavy recipe from the strongest hit on the frame", async () => {
    const light = await running();
    light.engine.handleEvents(hit({ knockback: fx(10), damage: fx(2) }));
    const lightNodes = light.mock.created.length;

    const heavy = await running();
    const events = hit({ knockback: fx(10), damage: fx(2) });
    events.hits.push({ attacker: 1, victim: 0, damage: fx(18), x: 0, y: 0, contactX: 0, contactY: 0, knockback: fx(140), angle: 0, hitboxId: 0 });
    heavy.engine.handleEvents(events);

    // The heavy recipe has a noise layer with two filters that the light one
    // does not, so it builds a materially larger graph.
    expect(heavy.mock.created.length).toBeGreaterThan(lightNodes);
    expect(heavy.mock.filters.length).toBeGreaterThan(0);
  });

  it("gives a KO the loudest moment on the frame it lands", async () => {
    const { mock, engine } = await running();
    const events = hit({ knockback: fx(200), damage: fx(20) });
    events.kos.push({ port: 1, x: 0, y: 0, kind: "blast" });

    engine.handleEvents(events);

    // The KO's signature: a lowpass closing from 8kHz as the pitch falls.
    expect(mock.filters.some((f) => f.frequency.valuePath[0] === 8000)).toBe(true);
  });

  it("plays a chik for a glance, and a sound each for a midair jump, a reflection and a counter's catch (Plan 6, Task 31)", async () => {
    // Each sound has a signature the mock records: a module namespace cannot be spied on under ESM.
    const cases: [string, (e: StepEvents) => void, (m: MockAudioContext) => boolean][] = [
      ["glance", (e) => e.glances.push({ attacker: 0, victim: 1, x: 0, y: 0 }), (m) => m.filters.some((f) => f.frequency.valuePath[0] === 3_500)],
      ["midairJump", (e) => e.airJumps.push({ port: 0, x: 0, y: 0 }), (m) => m.oscillators.some((o) => o.frequency.valuePath[0] === 520)],
      ["reflectChime", (e) => e.reflects.push({ port: 0, x: 0, y: 0 }), (m) => m.oscillators.some((o) => o.frequency.valuePath[0] === 1_800)],
      ["counterCatch", (e) => e.counters.push({ port: 0, x: 0, y: 0, damage: fx(1) }), (m) => m.filters.some((f) => f.frequency.valuePath[0] === 2_600)],
    ];
    for (const [name, fill, heard] of cases) {
      const { mock, engine } = await running();
      const events = emptyEvents();
      fill(events);
      engine.handleEvents(events);
      expect(heard(mock), name).toBe(true);
    }
  });

  it("chiks once for a graze that lasts several frames, and not over a hit", async () => {
    const { mock, engine } = await running();
    for (let i = 0; i < 3; i++) {
      const events = emptyEvents();
      events.glances.push({ attacker: 0, victim: 1, x: 0, y: 0 });
      engine.handleEvents(events);
    }
    expect(mock.filters.filter((f) => f.frequency.valuePath[0] === 3_500).length).toBe(1);
    const { mock: other, engine: second } = await running();
    const withHit = hit();
    withHit.glances.push({ attacker: 0, victim: 1, x: 0, y: 0 });
    second.handleEvents(withHit);
    expect(other.filters.some((f) => f.frequency.valuePath[0] === 3_500)).toBe(false);
  });

  it("handles every event channel without leaking a node", async () => {
    const { mock, engine } = await running();
    const events = hit();
    events.shieldHits.push({ victim: 1, x: 0, y: 0, contactX: 0, contactY: 0 });
    events.clanks.push({ x: 0, y: 0 });
    events.kos.push({ port: 0, x: 0, y: 0, kind: "star" });
    events.jumps.push({ port: 0, x: 0, y: 0 });
    events.lands.push({ port: 1, x: 0, y: 0 });
    events.shieldBreaks.push(1);
    events.smashBallBroken = 0;
    events.finalSmashes.push(0);

    engine.handleEvents(events);
    mock.advance(10);

    // Only the two bus nodes are still wired up.
    expect(mock.liveNodes.map((n) => n.kind)).toEqual(["gain", "gain"]);
  });

  it("leaks nothing across a match's worth of frames", async () => {
    const { mock, engine } = await running();
    for (let frame = 0; frame < 3600; frame++) {
      mock.currentTime = frame / 60;
      if (frame % 7 === 0) engine.handleEvents(hit());
      else if (frame % 61 === 0) {
        const events = emptyEvents();
        events.kos.push({ port: 0, x: 0, y: 0, kind: "blast" });
        engine.handleEvents(events);
      } else engine.handleEvents(emptyEvents());
    }
    mock.advance(10);

    expect(mock.created.length).toBeGreaterThan(1000);
    expect(mock.liveNodes.map((n) => n.kind)).toEqual(["gain", "gain"]);
  });
});

describe("a counter's catch and its counterattack (Plan 5, Task 17)", () => {
  /** The counterattack ring's signature: a triangle struck at 1568 Hz (`criticalHit`). */
  const rings = (mock: MockAudioContext) => mock.oscillators.filter((o) => o.type === "triangle" && o.frequency.valuePath[0] === 1568).length;
  const caught = (port: number, damage: number): StepEvents => {
    const events = emptyEvents();
    events.counters.push({ port, x: 0, y: 0, damage });
    return events;
  };

  /** A catch, `gap` empty frames, then a hit by `attacker`; the counterattack rings counted. */
  async function ringsAfter(damage: number, gap: number, attacker = 1): Promise<number> {
    const { mock, engine } = await running();
    engine.handleEvents(caught(1, damage));
    for (let i = 0; i < gap; i++) engine.handleEvents(emptyEvents());
    engine.handleEvents(hit({ attacker, victim: 1 - attacker, damage: fx(20), knockback: fx(120) }));
    return rings(mock);
  }

  it("rings over the counterattack's hit when the catch was strong: 13% or more (SmashWiki \"Marth (SSBU)/Down special\")", async () => {
    // Marth freezes 21 frames with the opponent, and strikes on the counterattack's frames 5-7.
    expect(await ringsAfter(STRONG_COUNTER_DAMAGE, 24)).toBe(1);
    expect(await ringsAfter(STRONG_COUNTER_DAMAGE - 1, 24)).toBe(0);
  });

  it("rings once, for its user's hit alone, and only inside the counterattack's window", async () => {
    expect(await ringsAfter(STRONG_COUNTER_DAMAGE, 24, 0)).toBe(0);
    expect(await ringsAfter(STRONG_COUNTER_DAMAGE, STRONG_COUNTER_WINDOW - 1)).toBe(1);
    expect(await ringsAfter(STRONG_COUNTER_DAMAGE, STRONG_COUNTER_WINDOW)).toBe(0);
    const { mock, engine } = await running();
    engine.handleEvents(caught(1, STRONG_COUNTER_DAMAGE));
    engine.handleEvents(hit({ attacker: 1, victim: 0 }));
    engine.handleEvents(hit({ attacker: 1, victim: 0 }));
    expect(rings(mock)).toBe(1);
  });

  /** Plan 6, Task 31: the catch has its own clash now; the ring still waits for the counterattack. */
  it("plays the catch's own clash on the catch, and no ring until its counterattack lands", async () => {
    const { mock, engine } = await running();
    engine.handleEvents(caught(1, fx(30)));
    expect(mock.filters.some((f) => f.frequency.valuePath[0] === 2_600)).toBe(true);
    expect(rings(mock)).toBe(0);
  });
});

describe("jumps that push off a wall or a head (Plan 5, Task 17)", () => {
  it("play the jump's sound, as one off the ground does", async () => {
    const signature = (from?: "wall" | "head") => {
      const { mock, engine } = makeEngine();
      return engine.resume().then(() => {
        const events = emptyEvents();
        events.jumps.push({ port: 0, x: 0, y: 0, ...(from ? { from } : {}) });
        engine.handleEvents(events);
        return mock.oscillators.map((o) => [o.type, ...o.frequency.valuePath]);
      });
    };
    const ground = await signature();
    expect(ground.length).toBeGreaterThan(0);
    expect(await signature("wall")).toEqual(ground);
    expect(await signature("head")).toEqual(ground);
  });
});

describe("the shield hum", () => {
  it("is level-triggered, so a rollback cannot stack eight of them", async () => {
    // Shield is a *state*, not an event — there is no "shield frame" to count.
    // Level-triggering is what makes it safe to call from the render loop
    // after a rollback has re-simulated the last eight frames.
    const { mock, engine } = await running();
    const before = mock.created.length;

    for (let i = 0; i < 8; i++) engine.setShieldHeld(0, true);
    const afterFirst = mock.created.length;
    for (let i = 0; i < 8; i++) engine.setShieldHeld(0, true);

    expect(afterFirst).toBeGreaterThan(before);
    expect(mock.created.length).toBe(afterFirst);
  });

  it("stops when the button comes up, and can start again", async () => {
    const { mock, engine } = await running();
    engine.setShieldHeld(0, true);
    const first = mock.created.length;

    engine.setShieldHeld(0, false);
    mock.advance(1);
    expect(mock.liveNodes.map((n) => n.kind)).toEqual(["gain", "gain"]);

    engine.setShieldHeld(0, true);
    expect(mock.created.length).toBeGreaterThan(first);
  });

  it("gives each port its own bubble", async () => {
    const { mock, engine } = await running();
    engine.setShieldHeld(0, true);
    const one = mock.created.length;
    engine.setShieldHeld(1, true);
    expect(mock.created.length).toBeGreaterThan(one);
  });

  it("releases every shield on dispose", async () => {
    const { mock, engine } = await running();
    engine.setShieldHeld(0, true);
    engine.setShieldHeld(1, true);

    engine.dispose();
    mock.advance(1);

    expect(mock.liveNodes).toEqual([]);
    expect(mock.state).toBe("closed");
  });

  it("forgets a shield that was released while the context was suspended", async () => {
    const { mock, engine } = await running();
    engine.setShieldHeld(0, true);
    await mock.suspend();

    engine.setShieldHeld(0, false);
    await engine.resume();
    const before = mock.created.length;
    engine.setShieldHeld(0, true);

    // A fresh bubble, rather than the engine believing one is still up.
    expect(mock.created.length).toBeGreaterThan(before);
  });
});

describe("the mixer", () => {
  it("mutes without tearing anything down", async () => {
    const { mock, engine } = await running();
    const master = mock.created[0];

    engine.setMuted(true);

    expect(engine.muted).toBe(true);
    expect((master as unknown as { gain: { value: number } }).gain.value).toBe(0);
    expect(master.outputs).toEqual([mock.destination]);
  });

  it("restores the previous volume on unmute", async () => {
    const { mock, engine } = await running();
    engine.setMasterVolume(0.5);
    engine.setMuted(true);
    engine.setMuted(false);
    expect((mock.created[0] as unknown as { gain: { value: number } }).gain.value).toBe(0.5);
  });

  it("moves SFX independently of the master", async () => {
    const { mock, engine } = await running();
    engine.setSfxVolume(0.25);
    const [master, sfxBus] = mock.created as unknown as { gain: { value: number } }[];
    expect(sfxBus.gain.value).toBe(0.25);
    expect(master.gain.value).toBe(0.8);
  });

  it("ramps rather than jumping, because a gain step is a click", async () => {
    const { mock, engine } = await running();
    engine.setMasterVolume(0.2);
    const master = mock.created[0] as unknown as { gain: { events: { method: string }[] } };
    expect(master.gain.events.map((e) => e.method)).toContain("linearRampToValueAtTime");
  });

  it("clamps anything a slider could produce", async () => {
    const { engine } = await running();
    engine.setMasterVolume(4);
    expect(engine.volume.master).toBe(1);
    engine.setSfxVolume(-1);
    expect(engine.volume.sfx).toBe(0);
    engine.setMasterVolume(Number.NaN);
    expect(engine.volume.master).toBe(0);
  });

  it("starts muted when asked, before the context even exists", async () => {
    const { mock, engine } = makeEngine({ muted: true });
    await engine.resume();
    expect((mock.created[0] as unknown as { gain: { value: number } }).gain.value).toBe(0);
    expect(engine.toggleMuted()).toBe(false);
  });
});

describe("shutdown", () => {
  it("is idempotent and inert afterwards", async () => {
    const { mock, engine } = await running();
    engine.dispose();
    expect(() => engine.dispose()).not.toThrow();
    const after = mock.created.length;
    engine.handleEvents(hit());
    engine.playUi("move");
    await engine.resume();
    expect(mock.created.length).toBe(after);
    expect(engine.running).toBe(false);
  });

  it("plays the one-shots the shell drives directly", async () => {
    const { mock, engine } = await running();
    const calls = [
      () => engine.playPerfectShield(),
      () => engine.playDodge(),
      () => engine.playGrab(),
      () => engine.playThrow(),
      () => engine.playCountdown(),
      () => engine.playGo(),
      () => engine.playUi("move"),
      () => engine.playUi("confirm"),
      () => engine.playUi("back"),
    ];
    for (const call of calls) {
      const before = mock.created.length;
      call();
      expect(mock.created.length).toBeGreaterThan(before);
    }
    mock.advance(10);
    expect(mock.liveNodes.map((n) => n.kind)).toEqual(["gain", "gain"]);
  });

  it("does not throw when the shell drives it before the first gesture", () => {
    const { engine } = makeEngine();
    const spy = vi.fn(() => {
      engine.playGo();
      engine.setShieldHeld(0, true);
      engine.handleEvents(emptyEvents());
    });
    expect(spy).not.toThrow();
  });
});
