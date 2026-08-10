import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ContainerProvider } from "@/components/app-shell/container-provider";
import { SettingsProvider } from "@/components/app-shell/settings-provider";
import { defaultSettings, type Settings } from "@/domain/settings";
import type { CameraFacing, CameraSource } from "@/ports";
import { createServerContainer, type Container } from "@/lib/container";

import { routerMock } from "../../../vitest.setup";
import { LiveScreen } from "./live-screen";

/** A `MediaStream` stand-in — jsdom has no media pipeline, and nothing on this
 * screen touches the stream beyond assigning it to `video.srcObject`. */
function fakeStream(): MediaStream {
  return {
    getTracks: () => [],
    getVideoTracks: () => [],
  } as unknown as MediaStream;
}

interface StubCamera extends CameraSource {
  readonly calls: CameraFacing[];
  readonly stopped: () => number;
}

function stubCamera(
  overrides: Partial<Pick<CameraSource, "isSupported" | "start" | "flip">> = {},
): StubCamera {
  const calls: CameraFacing[] = [];
  let stops = 0;
  return {
    calls,
    stopped: () => stops,
    isSupported: overrides.isSupported ?? (() => true),
    start:
      overrides.start ??
      ((facing: CameraFacing) => {
        calls.push(facing);
        return Promise.resolve(fakeStream());
      }),
    stop: () => {
      stops += 1;
    },
    flip: overrides.flip ?? (() => Promise.resolve(fakeStream())),
  };
}

function testContainer(camera: CameraSource, settings: Settings = defaultSettings): Container {
  const base = createServerContainer();
  return {
    ...base,
    camera,
    settings: { load: () => settings, save: () => {}, clear: () => {} },
  };
}

function renderLive(camera: CameraSource, settings?: Settings) {
  return render(
    <ContainerProvider container={testContainer(camera, settings)}>
      <SettingsProvider>
        <LiveScreen />
      </SettingsProvider>
    </ContainerProvider>,
  );
}

beforeEach(() => {
  routerMock.push.mockClear();
});

describe("LiveScreen", () => {
  it("shows the primer, and no camera, until the user asks for one", () => {
    const camera = stubCamera();
    renderLive(camera);

    expect(screen.getByTestId("live-screen")).toBeInTheDocument();
    expect(screen.getByTestId("camera-primer")).toBeInTheDocument();
    expect(screen.getByTestId("camera-start")).toHaveTextContent("Turn on the camera");
    // The whole point: nothing has touched `getUserMedia` before the gesture.
    expect(camera.calls).toHaveLength(0);
    expect(screen.queryByTestId("live-badge")).not.toBeInTheDocument();
  });

  it("starts the front camera from the button, then shows the broadcast chrome", async () => {
    const camera = stubCamera();
    renderLive(camera);

    fireEvent.click(screen.getByTestId("camera-start"));

    await waitFor(() => expect(screen.getByTestId("live-badge")).toBeInTheDocument());
    expect(camera.calls).toEqual(["user"]);
    expect(screen.queryByTestId("camera-primer")).not.toBeInTheDocument();
    expect(screen.getByTestId("comment-stream")).toBeInTheDocument();
    expect(screen.getByText("Add a comment…")).toBeInTheDocument();
  });

  it("mirrors the selfie view", async () => {
    const camera = stubCamera();
    const { container } = renderLive(camera);

    fireEvent.click(screen.getByTestId("camera-start"));
    await waitFor(() => expect(screen.getByTestId("live-badge")).toBeInTheDocument());

    const video = container.querySelector("video");
    expect(video).toHaveStyle({ transform: "scaleX(-1)" });
    // Both attributes are load-bearing on iOS: without them the stream either
    // refuses to autoplay or is taken fullscreen by the native player.
    expect(video).toHaveAttribute("playsinline");
    expect(video?.muted).toBe(true);
  });

  it("explains a denied permission instead of leaving a black screen", async () => {
    const denied = Object.assign(new Error("blocked"), {
      name: "NotAllowedError",
    });
    const camera = stubCamera({ start: () => Promise.reject(denied) });
    renderLive(camera);

    fireEvent.click(screen.getByTestId("camera-start"));

    await waitFor(() => expect(screen.getByText("The camera is blocked")).toBeInTheDocument());
    expect(screen.getByTestId("camera-primer")).toBeInTheDocument();
    expect(screen.getByTestId("camera-start")).toHaveTextContent("Try again");
  });

  it("says so when the browser has no camera API at all", async () => {
    const camera = stubCamera({ isSupported: () => false });
    renderLive(camera);

    await waitFor(() =>
      expect(screen.getByText("This browser cannot use the camera")).toBeInTheDocument(),
    );
    // Nothing to retry — the only affordance is the way out.
    expect(screen.queryByTestId("camera-start")).not.toBeInTheDocument();
  });

  it("renders the viewer count through the shared formatter", async () => {
    const camera = stubCamera();
    const settings: Settings = {
      ...defaultSettings,
      live: { ...defaultSettings.live, viewers: 12_500, commentsPerMinute: 0 },
    };
    renderLive(camera, settings);

    fireEvent.click(screen.getByTestId("camera-start"));

    await waitFor(() => expect(screen.getByTestId("viewer-count")).toBeInTheDocument());
    expect(screen.getByTestId("viewer-count")).toHaveTextContent("12.5K");
  });

  it("stops the camera on unmount", async () => {
    const camera = stubCamera();
    const view = renderLive(camera);

    fireEvent.click(screen.getByTestId("camera-start"));
    await waitFor(() => expect(screen.getByTestId("live-badge")).toBeInTheDocument());

    const before = camera.stopped();
    view.unmount();
    expect(camera.stopped()).toBeGreaterThan(before);
  });

  it("stops the camera before navigating home from the close button", async () => {
    const camera = stubCamera();
    renderLive(camera);

    fireEvent.click(screen.getByTestId("camera-start"));
    await waitFor(() => expect(screen.getByTestId("live-close")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("live-close"));
    expect(camera.stopped()).toBeGreaterThan(0);
    expect(routerMock.push).toHaveBeenCalledWith("/home");
  });

  it("releases the camera when the tab is really hidden", async () => {
    const camera = stubCamera();
    renderLive(camera);

    fireEvent.click(screen.getByTestId("camera-start"));
    await waitFor(() => expect(screen.getByTestId("live-badge")).toBeInTheDocument());

    const before = camera.stopped();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    fireEvent(document, new Event("visibilitychange"));
    expect(camera.stopped()).toBeGreaterThan(before);
    vi.restoreAllMocks();
  });

  it("keeps the current stream when a flip finds only one camera", async () => {
    const single = Object.assign(new Error("one camera"), {
      code: "single_camera",
    });
    const camera = stubCamera({ flip: () => Promise.reject(single) });
    renderLive(camera);

    fireEvent.click(screen.getByTestId("camera-start"));
    await waitFor(() => expect(screen.getByTestId("live-badge")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Flip camera"));

    await waitFor(() =>
      expect(screen.getByText("This device only has one camera.")).toBeInTheDocument(),
    );
    // Still live: a refused flip must never take the picture away.
    expect(screen.getByTestId("live-badge")).toBeInTheDocument();
    expect(screen.queryByTestId("camera-primer")).not.toBeInTheDocument();
  });
});
