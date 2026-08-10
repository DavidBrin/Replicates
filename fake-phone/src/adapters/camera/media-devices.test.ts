import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCameraSource } from "@/adapters/camera/media-devices";

/**
 * These tests exist for one property: **no track this adapter opens is ever
 * left running by a path the caller cannot see.** A stranded track leaves the
 * phone's camera indicator lit with nothing on screen explaining why, which is
 * the worst bug this app could ship (see the file header), and every failure
 * path below is one that a browser will really take.
 *
 * jsdom has no media pipeline, so `getUserMedia` is stubbed. That is fine: what
 * is under test is this file's bookkeeping, not the browser's.
 */

interface FakeTrack {
  readonly stops: number;
  stop(): void;
}

/** Every track handed out during a test, so "nothing is still running" is a
 * question about the whole test, not about one stream. */
let issued: FakeTrack[] = [];

function fakeStream(): MediaStream {
  const track: FakeTrack = {
    stops: 0,
    stop() {
      (this as { stops: number }).stops += 1;
    },
  };
  issued.push(track);
  return { getTracks: () => [track] } as unknown as MediaStream;
}

const running = () => issued.filter((track) => track.stops === 0).length;

let getUserMedia: ReturnType<typeof vi.fn>;
let videoInputs: number;

beforeEach(() => {
  issued = [];
  videoInputs = 2;
  getUserMedia = vi.fn(() => Promise.resolve(fakeStream()));

  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia,
      enumerateDevices: () =>
        Promise.resolve(
          Array.from({ length: videoInputs }, () => ({ kind: "videoinput" })) as MediaDeviceInfo[],
        ),
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "mediaDevices");
});

describe("media-devices camera adapter", () => {
  it("never asks for audio, so there is nothing to record even by accident", async () => {
    const camera = createCameraSource();
    await camera.start("user");

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia.mock.calls[0][0]).toMatchObject({ audio: false });
    camera.stop();
  });

  it("stops the previous camera before opening the next one", async () => {
    const camera = createCameraSource();
    await camera.start("user");
    await camera.flip();

    // iOS will not hand out both at once, and holding two would double the
    // leak surface for no benefit.
    expect(issued).toHaveLength(2);
    expect(issued[0].stops).toBe(1);
    expect(running()).toBe(1);
    camera.stop();
    expect(running()).toBe(0);
  });

  it("leaves no camera running when the flip fails", async () => {
    // The regression this test is here for: the adapter used to re-acquire the
    // previous camera and *then* rethrow, so the caller was told the flip had
    // failed while a live track kept the camera indicator lit behind an error
    // screen — a camera the user believes is off but which is actually running.
    const camera = createCameraSource();
    await camera.start("user");

    getUserMedia.mockRejectedValueOnce(
      Object.assign(new Error("busy"), { name: "NotReadableError" }),
    );

    await expect(camera.flip()).rejects.toMatchObject({ code: "in_use" });
    expect(running()).toBe(0);
    // Two calls, not three: no invisible restore attempt behind the rejection.
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("keeps the running camera when there is nothing to flip to", async () => {
    videoInputs = 1;
    const camera = createCameraSource();
    await camera.start("user");

    await expect(camera.flip()).rejects.toMatchObject({ code: "single_camera" });
    // Checked before touching the stream: a flip button that blacks out the
    // picture is worse than one that does nothing.
    expect(running()).toBe(1);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    camera.stop();
  });

  it("stops a stream that arrives after the user has already left", async () => {
    // The permission sheet can still be up when the screen unmounts. Nobody is
    // holding the stream that finally arrives, so nobody else can ever stop it.
    let settle: (stream: MediaStream) => void = () => {};
    getUserMedia.mockImplementationOnce(
      () =>
        new Promise<MediaStream>((resolve) => {
          settle = resolve;
        }),
    );

    const camera = createCameraSource();
    const pending = camera.start("user");
    camera.stop();
    settle(fakeStream());

    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    expect(running()).toBe(0);
  });

  it("is safe to stop repeatedly", async () => {
    const camera = createCameraSource();
    await camera.start("user");

    // Unmount, `pagehide` and a tab hide all firing together is the normal
    // case, not an edge case.
    camera.stop();
    camera.stop();
    expect(issued[0].stops).toBe(1);
  });

  it("explains an insecure origin rather than blaming the camera", async () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    const camera = createCameraSource();

    await expect(camera.start("user")).rejects.toMatchObject({ code: "insecure_context" });
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
