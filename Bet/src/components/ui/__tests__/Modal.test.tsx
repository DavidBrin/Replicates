import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "../Modal";

function TriggerAndModal() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open modal
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="t">
        <button type="button">Inside</button>
      </Modal>
    </div>
  );
}

function Fixture({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Confirm trade">
      <button type="button">First</button>
      <button type="button">Second</button>
      <button type="button">Last</button>
    </Modal>
  );
}

describe("Modal", () => {
  it("renders nothing when closed", () => {
    render(<Modal open={false} onClose={vi.fn()}>content</Modal>);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders as a dialog with aria-modal via a portal into document.body", () => {
    render(<Modal open onClose={vi.fn()} title="Confirm trade">content</Modal>);
    const dialog = screen.getByRole("dialog", { name: "Confirm trade" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.closest("body")).toBe(document.body);
  });

  it("focuses the first focusable element on open", () => {
    render(<Fixture open onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
  });

  it("traps focus: Tab from the last focusable element (Close) cycles to the first", async () => {
    const user = userEvent.setup();
    render(<Fixture open onClose={vi.fn()} />);

    // The dialog's own close button is the last element in the trap.
    const closeButton = screen.getByLabelText("Close");
    closeButton.focus();
    expect(closeButton).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
  });

  it("traps focus backwards: Shift+Tab from the first focusable element cycles to the last (Close)", async () => {
    const user = userEvent.setup();
    render(<Fixture open onClose={vi.fn()} />);

    const first = screen.getByRole("button", { name: "First" });
    first.focus();
    expect(first).toHaveFocus();

    await user.tab({ shift: true });
    expect(screen.getByLabelText("Close")).toHaveFocus();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Fixture open onClose={onClose} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a backdrop click but not on a click inside the dialog", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Fixture open onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "First" }));
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("dialog").previousSibling as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("locks body scroll while open and restores it on close", () => {
    const { rerender } = render(<Fixture open onClose={vi.fn()} />);
    expect(document.body.style.overflow).toBe("hidden");

    rerender(<Fixture open={false} onClose={vi.fn()} />);
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("restores focus to the trigger element on close", async () => {
    const user = userEvent.setup();
    render(<TriggerAndModal />);
    const trigger = screen.getByRole("button", { name: "Open modal" });
    trigger.focus();
    await user.click(trigger);
    expect(screen.getByRole("button", { name: "Inside" })).toHaveFocus();

    await user.click(screen.getByLabelText("Close"));
    expect(trigger).toHaveFocus();
  });
});
