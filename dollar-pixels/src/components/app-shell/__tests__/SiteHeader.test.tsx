import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SiteHeader } from "../SiteHeader";

describe("SiteHeader", () => {
  it("renders the wordmark and tagline", () => {
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: "Dollar Pixels" })).toHaveAttribute("href", "/");
    expect(screen.getByText("$1 buys nine pixels")).toBeInTheDocument();
  });

  it("omits the stat box when the counts are absent", () => {
    render(<SiteHeader />);
    expect(screen.queryByText("Sold")).not.toBeInTheDocument();
    expect(screen.queryByText("Available")).not.toBeInTheDocument();
  });

  it("omits the stat box when only one count is given", () => {
    render(<SiteHeader sold={128000} />);
    expect(screen.queryByText("Sold")).not.toBeInTheDocument();
  });

  it("groups the figures, derives available, and colours each one", () => {
    render(<SiteHeader sold={128000} total={160000} />);

    const sold = screen.getByText("128,000");
    const available = screen.getByText("32,000");

    expect(sold).toHaveAttribute("data-tone", "sold");
    expect(sold).toHaveClass("tnum");
    expect(sold.className).toContain("--sold");

    expect(available).toHaveAttribute("data-tone", "open");
    expect(available).toHaveClass("tnum");
    expect(available.className).toContain("--open");
  });

  it("never shows a negative availability if the counts disagree", () => {
    render(<SiteHeader sold={160001} total={160000} />);
    expect(screen.getByText("0")).toHaveAttribute("data-tone", "open");
  });
});
