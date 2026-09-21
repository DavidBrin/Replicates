import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PixelButton, PixelDialog, PlayerDot, StarRow, WoodPanel } from "./index";

describe("PixelButton", () => {
  it("renders a button by default, of type button, with the variant class", () => {
    render(<PixelButton variant="green">Go</PixelButton>);
    const b = screen.getByRole("button", { name: "Go" });
    expect(b.tagName).toBe("BUTTON");
    expect(b).toHaveAttribute("type", "button");
    expect(b).toHaveClass("ie-btn", "ie-btn--green", "ie-outline");
  });

  it("renders a link when href is given", () => {
    render(
      <PixelButton href="/campaign" variant="yellow" size="lg" block>
        Campaign
      </PixelButton>,
    );
    const a = screen.getByRole("link", { name: "Campaign" });
    expect(a).toHaveAttribute("href", "/campaign");
    expect(a).toHaveClass("ie-btn--yellow", "ie-btn--lg", "ie-btn--block");
    expect(a).not.toHaveClass("ie-outline");
  });

  it("forwards disabled and click handlers", async () => {
    const onClick = vi.fn();
    render(
      <PixelButton onClick={onClick} disabled>
        Nope
      </PixelButton>,
    );
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("StarRow", () => {
  it("lights `count` of `max` stars and clamps", () => {
    const { rerender } = render(<StarRow count={2} />);
    const row = screen.getByTestId("star-row");
    expect(row).toHaveAttribute("data-stars", "2");
    expect(row).toHaveAttribute("aria-label", "2 of 3 stars");
    expect(row.querySelectorAll("svg")).toHaveLength(3);
    rerender(<StarRow count={9} />);
    expect(screen.getByTestId("star-row")).toHaveAttribute("data-stars", "3");
    rerender(<StarRow count={-1} />);
    expect(screen.getByTestId("star-row")).toHaveAttribute("data-stars", "0");
  });
});

describe("WoodPanel", () => {
  it("renders children and an optional footer", () => {
    const { rerender } = render(<WoodPanel>Body</WoodPanel>);
    expect(screen.getByText("Body")).toBeInTheDocument();
    expect(document.querySelector(".ie-panel__footer")).toBeNull();
    rerender(<WoodPanel footer="Available 6d">Body</WoodPanel>);
    expect(screen.getByText("Available 6d")).toHaveClass("ie-panel__footer");
  });
});

describe("PixelDialog", () => {
  it("is hidden when closed and closes on OK, backdrop and Escape", async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <PixelDialog open={false} title="Strength" onClose={onClose}>
        chart
      </PixelDialog>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();

    rerender(
      <PixelDialog open title="Strength" onClose={onClose}>
        chart
      </PixelDialog>,
    );
    expect(screen.getByRole("dialog", { name: "Strength" })).toBeInTheDocument();
    expect(screen.getByText("- Strength -")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByTestId("dialog-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(2);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(3);
    // Clicking inside does not close.
    await userEvent.click(screen.getByText("chart"));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

describe("PlayerDot", () => {
  it("labels the seat colour", () => {
    render(<PlayerDot colour="red" />);
    expect(screen.getByRole("img", { name: "red" })).toBeInTheDocument();
  });
});
