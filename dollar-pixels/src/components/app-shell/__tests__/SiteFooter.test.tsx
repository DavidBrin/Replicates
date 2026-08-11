import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SiteFooter } from "../SiteFooter";

describe("SiteFooter", () => {
  it("is a footer landmark that disclaims any affiliation with the original", () => {
    render(<SiteFooter />);

    const footer = screen.getByRole("contentinfo");
    expect(footer).toHaveTextContent(/rebuild of the 2005 Million Dollar Homepage/i);
    expect(footer).toHaveTextContent(/not affiliated with, endorsed by, or connected to/i);
  });

  it("links to the repo's README", () => {
    render(<SiteFooter />);
    expect(screen.getByRole("link", { name: "README" })).toHaveAttribute(
      "href",
      "/README.md",
    );
  });
});
