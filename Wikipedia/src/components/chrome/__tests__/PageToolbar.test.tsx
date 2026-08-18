import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageToolbar } from "../PageToolbar";

describe("PageToolbar", () => {
  it("marks Talk, Edit, and View history as greyed/disabled", () => {
    render(<PageToolbar />);

    for (const label of ["Talk", "Edit", "View history"]) {
      const el = screen.getByText(label);
      expect(el).toHaveAttribute("aria-disabled", "true");
      expect(el).toHaveAttribute("title");
    }
  });

  it("leaves Article and Read selected, not greyed", () => {
    render(<PageToolbar />);

    const article = screen.getByText("Article");
    const read = screen.getByText("Read");
    expect(article).not.toHaveAttribute("aria-disabled");
    expect(read).not.toHaveAttribute("aria-disabled");
  });

  it("renders the siteSub line", () => {
    render(<PageToolbar />);
    expect(screen.getByText("From Wikipedia, the free encyclopedia")).toBeInTheDocument();
  });
});
