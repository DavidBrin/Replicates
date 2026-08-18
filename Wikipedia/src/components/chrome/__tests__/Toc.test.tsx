import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Toc } from "../Toc";

describe("Toc", () => {
  it("renders nothing when there are no sections", () => {
    const { container } = render(<Toc sections={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("always lists (Top) first, followed by the given sections in order", () => {
    render(
      <Toc
        sections={[
          { id: "History", heading: "History" },
          { id: "Reception", heading: "Reception" },
        ]}
      />,
    );

    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["(Top)", "History", "Reception"]);
  });

  it("links each entry to its section anchor", () => {
    render(<Toc sections={[{ id: "History", heading: "History" }]} />);
    expect(screen.getByRole("link", { name: "History" })).toHaveAttribute("href", "#History");
    expect(screen.getByRole("link", { name: "(Top)" })).toHaveAttribute("href", "#top");
  });
});
