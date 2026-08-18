import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Infobox } from "@/components/wiki";

describe("Infobox", () => {
  it("renders the title as a caption and each row as a label/value pair", () => {
    render(
      <Infobox
        title="Example Project"
        rows={[
          { label: "Type", value: "Static site" },
          { label: "Stack", value: <span>Next.js</span> },
        ]}
      />,
    );

    expect(screen.getByText("Example Project")).toBeInTheDocument();
    expect(screen.getByText("Type")).toBeInTheDocument();
    expect(screen.getByText("Static site")).toBeInTheDocument();
    expect(screen.getByText("Stack")).toBeInTheDocument();
    expect(screen.getByText("Next.js")).toBeInTheDocument();
  });

  it("renders as a table so rows line up as label/value cells", () => {
    render(<Infobox title="T" rows={[{ label: "A", value: "B" }]} />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "A" })).toBeInTheDocument();
  });
});
