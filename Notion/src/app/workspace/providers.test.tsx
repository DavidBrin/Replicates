import { StrictMode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { WorkspaceProviders } from "./providers";
import { useWorkspaceStore } from "@/lib/store/workspace-store";
import { getStorageAdapter, resetStorageAdapter } from "@/lib/storage";
import { createDemoSnapshot } from "@/lib/seed/demo-workspace";
import { useDemoAuthStore } from "@/lib/auth/demo-auth-store";
import { demoAuth } from "@/config/app.config";
import { demoLoginCopy } from "@/components/auth/copy";

/**
 * Regression coverage for the defect that made the whole app render nothing.
 *
 * The load effect used to combine a "has already run" ref guard with a
 * cancel-on-cleanup flag. Under Strict Mode's mount → unmount → remount, the
 * first pass was cancelled and the second returned early at the guard, so
 * `hydrated` never flipped and every route sat on the skeleton forever.
 *
 * Every test here mounts in <StrictMode> on purpose — the bug is invisible
 * without the double invocation, and `reactStrictMode` is on in next.config.
 */

async function clearStorage() {
  await getStorageAdapter().clear();
}

beforeEach(async () => {
  resetStorageAdapter(null);
  await clearStorage();
  useWorkspaceStore.setState({ ...createDemoSnapshot(), hydrated: false });
  useDemoAuthStore.setState({ demoName: null, gateResolved: false });
});

describe("WorkspaceProviders", () => {
  it("reaches the hydrated state under Strict Mode's double mount", async () => {
    render(
      <StrictMode>
        <WorkspaceProviders>
          <div>workspace content</div>
        </WorkspaceProviders>
      </StrictMode>,
    );

    expect(await screen.findByText("workspace content")).toBeInTheDocument();
    expect(useWorkspaceStore.getState().hydrated).toBe(true);
  });

  it("shows the skeleton before hydration and swaps it out after", async () => {
    render(
      <StrictMode>
        <WorkspaceProviders>
          <div>workspace content</div>
        </WorkspaceProviders>
      </StrictMode>,
    );

    // The skeleton is what both the server pass and the first client pass
    // render; keeping them identical is what avoids a hydration mismatch.
    expect(screen.getByLabelText("Loading workspace")).toBeInTheDocument();
    expect(screen.queryByText("workspace content")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByLabelText("Loading workspace")).not.toBeInTheDocument();
    });
    expect(screen.getByText("workspace content")).toBeInTheDocument();
  });

  it("restores a previously saved workspace rather than the seed", async () => {
    const saved = createDemoSnapshot();
    saved.workspace.name = "Restored from storage";
    await getStorageAdapter().save(saved);

    render(
      <StrictMode>
        <WorkspaceProviders>
          <div>workspace content</div>
        </WorkspaceProviders>
      </StrictMode>,
    );

    await screen.findByText("workspace content");
    expect(useWorkspaceStore.getState().workspace.name).toBe("Restored from storage");
  });

  it("falls back to the seed when storage is empty", async () => {
    render(
      <StrictMode>
        <WorkspaceProviders>
          <div>workspace content</div>
        </WorkspaceProviders>
      </StrictMode>,
    );

    await screen.findByText("workspace content");
    expect(useWorkspaceStore.getState().workspace.name).toBe(
      createDemoSnapshot().workspace.name,
    );
  });

  it("still renders when the storage adapter throws on load", async () => {
    // A broken or quota-exhausted browser store must degrade to an
    // unsaved session, never to a permanently blank screen.
    const failing = getStorageAdapter();
    failing.load = async () => {
      throw new Error("storage is on fire");
    };
    resetStorageAdapter(failing);

    render(
      <StrictMode>
        <WorkspaceProviders>
          <div>workspace content</div>
        </WorkspaceProviders>
      </StrictMode>,
    );

    expect(await screen.findByText("workspace content")).toBeInTheDocument();
  });
});

describe("DemoAuthGate", () => {
  it("renders the login dialog by default when demoAuth is enabled and unresolved", async () => {
    render(
      <StrictMode>
        <WorkspaceProviders>
          <div>workspace content</div>
        </WorkspaceProviders>
      </StrictMode>,
    );

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(demoLoginCopy.title)).toBeInTheDocument();
  });

  it("disappears once the store's skip() resolves the gate", async () => {
    render(
      <StrictMode>
        <WorkspaceProviders>
          <div>workspace content</div>
        </WorkspaceProviders>
      </StrictMode>,
    );

    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    useDemoAuthStore.getState().skip();

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("never renders when demoAuth.enabled is false", async () => {
    const original = demoAuth.enabled;
    (demoAuth as { enabled: boolean }).enabled = false;

    try {
      render(
        <StrictMode>
          <WorkspaceProviders>
            <div>workspace content</div>
          </WorkspaceProviders>
        </StrictMode>,
      );

      await screen.findByText("workspace content");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    } finally {
      (demoAuth as { enabled: boolean }).enabled = original;
    }
  });
});
