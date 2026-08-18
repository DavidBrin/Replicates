import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageToolbar } from "../PageToolbar";

describe("PageToolbar", () => {
  it("renders no Talk, Edit, View history or Tools controls", () => {
    render(<PageToolbar />);

    // "\u22ee" is the vertical-ellipsis glyph the removed Tools dropdown
    // actually rendered — asserting only the word "Tools" would miss it.
    for (const label of ["Talk", "Edit", "View history", "Tools", "\u22ee"]) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
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
