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

  it("shows the configured broadcaster identity over the stream", async () => {
    const camera = stubCamera();
    const settings: Settings = {
      ...defaultSettings,
      live: { ...defaultSettings.live, username: "rowan", avatar: "" },
    };
    renderLive(camera, settings);

    fireEvent.click(screen.getByTestId("camera-start"));

    await waitFor(() => expect(screen.getByTestId("live-username")).toBeInTheDocument());
    // A setting that changes nothing on screen reads as a broken setting.
    expect(screen.getByTestId("live-username")).toHaveTextContent("rowan");
    // No avatar configured: the monogram, through the same shared helper the
    // call screen uses.
    expect(screen.getByTestId("live-avatar")).toHaveTextContent("R");
  });

  it("uses the configured avatar image when there is one", async () => {
    const camera = stubCamera();
    const avatar = "data:image/png;base64,iVBORw0KGgo=";
    const settings: Settings = {
      ...defaultSettings,
      live: { ...defaultSettings.live, username: "rowan", avatar },
    };
    renderLive(camera, settings);

    fireEvent.click(screen.getByTestId("camera-start"));

    await waitFor(() => expect(screen.getByTestId("live-avatar")).toBeInTheDocument());
    expect(screen.getByTestId("live-avatar")).toHaveStyle({
      backgroundImage: `url("${avatar}")`,
    });
    // The image replaces the monogram rather than sitting behind it.
    expect(screen.getByTestId("live-avatar")).toHaveTextContent("");
  });

  it("carries no platform branding in the live chrome", async () => {
    // research/instagram-live-ui.md §9: the category pattern is fine, the brand
    // assets are not — and the broadcaster identity is the newest place a
    // wordmark could creep in.
    const camera = stubCamera();
    renderLive(camera);

    fireEvent.click(screen.getByTestId("camera-start"));
    await waitFor(() => expect(screen.getByTestId("live-badge")).toBeInTheDocument());

    expect(screen.getByTestId("live-screen").textContent).not.toMatch(/instagram|tiktok/i);
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

  it("re-opens the camera it had when a flip fails outright", async () => {
    // The adapter has to release the running camera before it can ask for the
    // other one, so a failed flip arrives here with the picture already gone
    // and nothing running. Dropping the user onto the error primer would end
    // the broadcast because a *second* camera would not open.
    const busy = Object.assign(new Error("busy"), { name: "NotReadableError" });
    const camera = stubCamera({ flip: () => Promise.reject(busy) });
    renderLive(camera);

    fireEvent.click(screen.getByTestId("camera-start"));
    await waitFor(() => expect(screen.getByTestId("live-badge")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Flip camera"));

    await waitFor(() =>
      expect(screen.getByText("Could not switch cameras.")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("camera-primer")).not.toBeInTheDocument();
    // Re-opened the camera it was already on, not the one that just refused.
    expect(camera.calls).toEqual(["user", "user"]);
  });

  it("explains the failure when the camera cannot be re-opened either", async () => {
    const busy = Object.assign(new Error("busy"), { name: "NotReadableError" });
    let started = 0;
    const camera = stubCamera({
      flip: () => Promise.reject(busy),
      start: () => {
        started += 1;
        // The first start succeeds; the recovery start finds the camera gone.
        return started === 1
          ? Promise.resolve(fakeStream())
          : Promise.reject(Object.assign(new Error("gone"), { name: "NotFoundError" }));
      },
    });
    renderLive(camera);

    fireEvent.click(screen.getByTestId("camera-start"));
    await waitFor(() => expect(screen.getByTestId("live-badge")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Flip camera"));

    // The original failure is what gets reported, not the recovery's.
    await waitFor(() => expect(screen.getByText("The camera is busy")).toBeInTheDocument());
    expect(screen.getByTestId("camera-primer")).toBeInTheDocument();
  });
});
