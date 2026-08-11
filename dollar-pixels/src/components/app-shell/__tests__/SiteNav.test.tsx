import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { setPathname } from "../../../../vitest.setup";
import { SiteNav } from "../SiteNav";

afterEach(() => {
  setPathname("/");
});

describe("SiteNav", () => {
  it("renders every section as a labelled landmark", () => {
    setPathname("/");
    render(<SiteNav />);

    const nav = screen.getByRole("navigation", { name: "Site" });
    expect(nav).toBeInTheDocument();

    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual(["/", "/p/the-wall", "/pages", "/new", "/dashboard"]);
  });

  it("marks the current route, and only it", () => {
    setPathname("/pages");
    render(<SiteNav />);

    expect(screen.getByRole("link", { name: "Pages" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getAllByRole("link").filter((l) => l.hasAttribute("aria-current")),
    ).toHaveLength(1);
  });

  it("keeps a section current on its descendant routes", () => {
    setPathname("/p/the-wall/claims/abc");
    render(<SiteNav />);
    expect(screen.getByRole("link", { name: "The Wall" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("does not treat Home as current merely because every path starts with a slash", () => {
    setPathname("/dashboard");
    render(<SiteNav />);

    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("marks nothing on a route outside the nav", () => {
    setPathname("/checkout/return");
    render(<SiteNav />);
    expect(
      screen.getAllByRole("link").filter((l) => l.hasAttribute("aria-current")),
    ).toHaveLength(0);
  });
});
