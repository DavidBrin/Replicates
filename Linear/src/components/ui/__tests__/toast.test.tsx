import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ToastProvider, useToast } from "@/components/ui/toast-provider";

/**
 * The toast queue, and the Undo affordance in particular.
 *
 * Undo is the reason destructive actions in this app do not need a confirmation
 * dialog, so "the button calls back and the card goes away" is a load-bearing
 * behaviour rather than a nicety.
 */

function Harness({
  onUndo,
  ...options
}: {
  onUndo?: () => void;
  title?: string;
  variant?: "default" | "error";
  duration?: number | null;
}) {
  const { toast } = useToast();
  return (
    <button
      type="button"
      onClick={() =>
        toast({
          title: options.title ?? "Deleted ENG-42",
          variant: options.variant,
          duration: options.duration,
          undo: onUndo,
        })
      }
    >
      raise
    </button>
  );
}

function renderWithProvider(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe("ToastProvider", () => {
  it("shows a toast on demand", async () => {
    const user = userEvent.setup();
    renderWithProvider(<Harness />);

    await user.click(screen.getByRole("button", { name: "raise" }));
    expect(await screen.findByText("Deleted ENG-42")).toBeInTheDocument();
  });

  it("runs the undo callback and takes the toast away with it", async () => {
    // Leaving the card up after Undo invites a second click that undoes the
    // undo — which is why the action dismisses rather than just firing.
    const user = userEvent.setup();
    const onUndo = vi.fn();
    renderWithProvider(<Harness onUndo={onUndo} />);

    await user.click(screen.getByRole("button", { name: "raise" }));
    await user.click(await screen.findByRole("button", { name: /Undo/ }));

    expect(onUndo).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByText("Deleted ENG-42")).not.toBeInTheDocument(),
    );
  });

  it("renders the ⌘Z hint on the undo, because the toast is teaching the shortcut", async () => {
    const user = userEvent.setup();
    renderWithProvider(<Harness onUndo={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "raise" }));
    const undo = await screen.findByRole("button", { name: /Undo/ });
    // jsdom is not macOS, so the platform-correct cap is Ctrl. What matters is
    // that a hint is rendered at all and that it names the modifier.
    expect(undo.textContent).toMatch(/Ctrl|⌘/);
    expect(undo.textContent).toMatch(/Z/);
  });

  it("dismisses from the close button", async () => {
    const user = userEvent.setup();
    renderWithProvider(<Harness />);

    await user.click(screen.getByRole("button", { name: "raise" }));
    await screen.findByText("Deleted ENG-42");
    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() =>
      expect(screen.queryByText("Deleted ENG-42")).not.toBeInTheDocument(),
    );
  });

  it("expires a timed toast on its own", async () => {
    const user = userEvent.setup();
    renderWithProvider(<Harness duration={40} />);

    await user.click(screen.getByRole("button", { name: "raise" }));
    await screen.findByText("Deleted ENG-42");
    await waitFor(
      () => expect(screen.queryByText("Deleted ENG-42")).not.toBeInTheDocument(),
      { timeout: 1_000 },
    );
  });

  it("makes errors sticky and assertive", async () => {
    // An error that vanishes before it is read is an error that will be hit
    // again — and `polite` means the user finds out after they have retried.
    const user = userEvent.setup();
    renderWithProvider(<Harness variant="error" title="Couldn't update ENG-42" />);

    await user.click(screen.getByRole("button", { name: "raise" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(alert.querySelector("[data-toast-progress]")).toBeNull();
  });

  it("keeps at most three cards on screen", async () => {
    const user = userEvent.setup();
    renderWithProvider(<Harness duration={null} />);

    const raise = screen.getByRole("button", { name: "raise" });
    for (let i = 0; i < 5; i += 1) await user.click(raise);

    await waitFor(() =>
      expect(screen.getAllByText("Deleted ENG-42")).toHaveLength(3),
    );
  });

  it("refuses to be used outside its provider", () => {
    // A silent no-op here would mean an error toast that never appears, and
    // nothing else would fail.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    function Orphan() {
      useToast();
      return null;
    }
    expect(() => render(<Orphan />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });
});
