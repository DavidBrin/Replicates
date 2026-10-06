import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { DIALOG_GROUPS } from "@/content/dialog";

import { DialogRoster } from "./DialogRoster";

function lines(): HTMLElement[] {
  return Array.from(
    screen.getByTestId("dialog-roster").querySelectorAll<HTMLElement>("[data-line-id]"),
  );
}

describe("DialogRoster", () => {
  it("renders exactly 42 lines while an alliance is active", () => {
    render(<DialogRoster allied onSend={vi.fn()} />);
    expect(lines()).toHaveLength(42);
  });

  it("renders 40 lines when there is no alliance — 28 and 29 are ally-only", () => {
    render(<DialogRoster allied={false} onSend={vi.fn()} />);
    expect(lines()).toHaveLength(40);
    expect(screen.queryByTestId("dialog-line-28")).toBeNull();
    expect(screen.queryByTestId("dialog-line-29")).toBeNull();
  });

  it("renders the seven groups in roster order, each under its label", () => {
    render(<DialogRoster allied onSend={vi.fn()} />);
    const sections = Array.from(
      screen.getByTestId("dialog-roster").querySelectorAll<HTMLElement>("[data-testid^='dialog-group-']"),
    );
    expect(sections.map((s) => s.dataset["testid"]?.replace("dialog-group-", ""))).toEqual(
      DIALOG_GROUPS.map((g) => g.id),
    );
    for (const group of DIALOG_GROUPS) {
      expect(screen.getByText(group.label)).toBeInTheDocument();
    }
  });

  it("keeps the five RGD-verbatim lines verbatim", () => {
    render(<DialogRoster allied onSend={vi.fn()} />);
    expect(screen.getByTestId("dialog-line-20")).toHaveTextContent(/^NO DICE!$/);
    expect(screen.getByTestId("dialog-line-21")).toHaveTextContent(/^THE DICE HATE ME!$/);
    expect(screen.getByTestId("dialog-line-28"))
      .toHaveTextContent(/^Sorry, I need to attack your territory\.$/);
    expect(screen.getByTestId("dialog-line-29"))
      .toHaveTextContent(/^Attack my territory if you need to\.$/);
    expect(screen.getByTestId("dialog-line-34")).toHaveTextContent(/^Great game\.$/);
  });

  it("sends the roster index — never the text — when a line is tapped", () => {
    const onSend = vi.fn();
    render(<DialogRoster allied onSend={onSend} />);
    fireEvent.click(screen.getByTestId("dialog-line-7"));
    expect(onSend).toHaveBeenCalledWith({ lineId: 7 });
    fireEvent.click(screen.getByTestId("dialog-line-42"));
    expect(onSend).toHaveBeenLastCalledWith({ lineId: 42 });
  });

  it("gives every pill a 46 px touch target", () => {
    render(<DialogRoster allied onSend={vi.fn()} />);
    for (const pill of lines()) expect(pill.style.height).toBe("46px");
  });
});
