import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WikiLink } from "@/components/wiki";

describe("WikiLink", () => {
  it("renders a plain link with no red styling when the target exists", () => {
    render(<WikiLink to="Davids_Internet">Davids_Internet</WikiLink>);
    const link = screen.getByRole("link", { name: "Davids_Internet" });
    expect(link).toHaveAttribute("href", "/wiki/Davids_Internet");
    expect(link).not.toHaveClass("new");
    expect(link).not.toHaveAttribute("title");
  });

  it("renders red with a 'page does not exist' tooltip when the target is missing", () => {
    render(<WikiLink to="Nowhere">Nowhere</WikiLink>);
    const link = screen.getByRole("link", { name: "Nowhere" });
    expect(link).toHaveClass("new");
    expect(link).toHaveAttribute("title", "page does not exist");
  });

  it("URL-encodes the slug in the href", () => {
    render(<WikiLink to="David's Internet">David&apos;s Internet</WikiLink>);
    const link = screen.getByRole("link", { name: "David's Internet" });
    expect(link).toHaveAttribute("href", `/wiki/${encodeURIComponent("David's Internet")}`);
  });
});
