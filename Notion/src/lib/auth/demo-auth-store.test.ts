import { beforeEach, describe, expect, it } from "vitest";
import { useDemoAuthStore } from "./demo-auth-store";
import { useWorkspaceStore } from "../store/workspace-store";
import { demoAuth } from "@/config/app.config";

const store = () => useDemoAuthStore.getState();

beforeEach(() => {
  useDemoAuthStore.setState({ demoName: null, gateResolved: false });
});

describe("signIn", () => {
  it("trims whitespace and sets gateResolved", () => {
    store().signIn("  Sam Rivera  ");

    expect(store().demoName).toBe("Sam Rivera");
    expect(store().gateResolved).toBe(true);
  });

  it("is a no-op for a whitespace-only name", () => {
    const before = store().gateResolved;

    store().signIn("   ");

    expect(store().demoName).toBeNull();
    expect(store().gateResolved).toBe(before);
  });

  it("caps the name at demoAuth.maxNameLength characters", () => {
    const long = "x".repeat(demoAuth.maxNameLength + 10);

    store().signIn(long);

    expect(store().demoName).toHaveLength(demoAuth.maxNameLength);
    expect(store().demoName).toBe("x".repeat(demoAuth.maxNameLength));
  });
});

describe("skip", () => {
  it("resolves the gate without touching demoName", () => {
    store().skip();

    expect(store().gateResolved).toBe(true);
    expect(store().demoName).toBeNull();
  });
});

describe("signOut", () => {
  it("resets both fields to their initial values", () => {
    store().signIn("Sam");
    expect(store().demoName).not.toBeNull();

    store().signOut();

    expect(store().demoName).toBeNull();
    expect(store().gateResolved).toBe(false);
  });
});

describe("isolation from useWorkspaceStore", () => {
  it("never touches the workspace store's persisted snapshot", () => {
    const before = useWorkspaceStore.getState().exportSnapshot();

    useDemoAuthStore.getState().signIn("Sam");

    const after = useWorkspaceStore.getState().exportSnapshot();
    expect(after).toEqual(before);
  });
});
