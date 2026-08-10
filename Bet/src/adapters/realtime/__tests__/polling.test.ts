import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PollingRealtimeChannel, type VisibilityHost } from "../polling";

/** A minimal fake `document` so tests control visibility deterministically
 * instead of depending on jsdom's real one (and can flip it mid-test). */
function fakeDocument(initial: DocumentVisibilityState): {
  host: VisibilityHost;
  setVisibility: (state: DocumentVisibilityState) => void;
} {
  let state = initial;
  const listeners = new Set<() => void>();
  const host: VisibilityHost = {
    get visibilityState() {
      return state;
    },
    addEventListener: (_type: string, handler: EventListenerOrEventListenerObject) => {
      listeners.add(handler as () => void);
    },
    removeEventListener: (_type: string, handler: EventListenerOrEventListenerObject) => {
      listeners.delete(handler as () => void);
    },
  } as unknown as VisibilityHost;
  return {
    host,
    setVisibility: (next) => {
      state = next;
      for (const l of listeners) l();
    },
  };
}

describe("PollingRealtimeChannel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls immediately on subscribe and then every intervalMs while visible", async () => {
    const { host } = fakeDocument("visible");
    const fetchLatest = vi.fn().mockResolvedValue(["m1"]);
    const channel = new PollingRealtimeChannel({
      fetchLatest,
      sendMessage: vi.fn(),
      intervalMs: 4000,
      document: host,
    });
    const onMessages = vi.fn();

    channel.subscribe(onMessages);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchLatest).toHaveBeenCalledTimes(1);
    expect(onMessages).toHaveBeenCalledWith(["m1"]);

    await vi.advanceTimersByTimeAsync(4000);
    expect(fetchLatest).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(4000);
    expect(fetchLatest).toHaveBeenCalledTimes(3);
  });

  it("does not poll while the document starts hidden", async () => {
    const { host } = fakeDocument("hidden");
    const fetchLatest = vi.fn().mockResolvedValue([]);
    const channel = new PollingRealtimeChannel({ fetchLatest, sendMessage: vi.fn(), document: host });

    channel.subscribe(vi.fn());
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchLatest).not.toHaveBeenCalled();
  });

  it("stops polling when the tab becomes hidden, and resumes (with an immediate poll) when visible again", async () => {
    const { host, setVisibility } = fakeDocument("visible");
    const fetchLatest = vi.fn().mockResolvedValue([]);
    const channel = new PollingRealtimeChannel({ fetchLatest, sendMessage: vi.fn(), intervalMs: 4000, document: host });

    channel.subscribe(vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchLatest).toHaveBeenCalledTimes(1);

    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchLatest).toHaveBeenCalledTimes(1); // no further polls while hidden

    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchLatest).toHaveBeenCalledTimes(2); // immediate poll on resume, not a wait for the next tick
  });

  it("send() awaits sendMessage then triggers an immediate extra poll", async () => {
    const { host } = fakeDocument("visible");
    const fetchLatest = vi.fn().mockResolvedValue([]);
    const sendMessage = vi.fn().mockResolvedValue({ id: "m-new" });
    const channel = new PollingRealtimeChannel({ fetchLatest, sendMessage, intervalMs: 4000, document: host });

    channel.subscribe(vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchLatest).toHaveBeenCalledTimes(1);

    const result = await channel.send({ clientId: "c1", body: "hi" });
    expect(sendMessage).toHaveBeenCalledWith("c1", "hi");
    expect(result).toEqual({ id: "m-new" });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchLatest).toHaveBeenCalledTimes(2);
  });

  it("close() stops the timer and detaches the listener — no further callbacks fire", async () => {
    const { host } = fakeDocument("visible");
    const fetchLatest = vi.fn().mockResolvedValue(["late"]);
    const channel = new PollingRealtimeChannel({ fetchLatest, sendMessage: vi.fn(), intervalMs: 4000, document: host });
    const onMessages = vi.fn();

    channel.subscribe(onMessages);
    await vi.advanceTimersByTimeAsync(0);
    onMessages.mockClear();

    channel.close();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onMessages).not.toHaveBeenCalled();
  });

  it("swallows a transient fetch failure and keeps polling on the next tick", async () => {
    const { host } = fakeDocument("visible");
    const fetchLatest = vi.fn().mockRejectedValueOnce(new Error("network blip")).mockResolvedValue(["ok"]);
    const channel = new PollingRealtimeChannel({ fetchLatest, sendMessage: vi.fn(), intervalMs: 4000, document: host });
    const onMessages = vi.fn();

    channel.subscribe(onMessages);
    await vi.advanceTimersByTimeAsync(0);
    expect(onMessages).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4000);
    expect(onMessages).toHaveBeenCalledWith(["ok"]);
  });
});
