import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider, useToast } from "../Toast";

function ShowOnMount({ title, durationMs }: { title: string; durationMs?: number }) {
  const { show } = useToast();
  useEffect(() => {
    show({ title, durationMs });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

describe("Toast", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("useToast throws outside a ToastProvider", () => {
    function Bare() {
      useToast();
      return null;
    }
    expect(() => render(<Bare />)).toThrow(/ToastProvider/);
  });

  it("show() renders a toast with a live region", () => {
    render(
      <ToastProvider>
        <ShowOnMount title="Trade placed" />
      </ToastProvider>,
    );
    expect(screen.getByText("Trade placed")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("dismisses on close-button click", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ShowOnMount title="Trade placed" />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Trade placed")).not.toBeInTheDocument();
  });

  it("auto-dismisses after its duration", async () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <ShowOnMount title="Trade placed" durationMs={1000} />
      </ToastProvider>,
    );
    expect(screen.getByText("Trade placed")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByText("Trade placed")).not.toBeInTheDocument();
  });
});
