import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Callout } from "../Callout";

describe("Callout", () => {
  it("defaults to the polite info tone", () => {
    render(<Callout>Holds expire after 30 minutes.</Callout>);
    const callout = screen.getByRole("status");
    expect(callout).toHaveTextContent("Holds expire after 30 minutes.");
    expect(callout).toHaveAttribute("data-tone", "info");
  });

  it("keeps warn polite — only danger is allowed to interrupt", () => {
    render(<Callout tone="warn">This page is unlisted, not private.</Callout>);
    expect(screen.getByRole("status")).toHaveAttribute("data-tone", "warn");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("uses role=alert for danger", () => {
    render(<Callout tone="danger">Your card was declined.</Callout>);
    const callout = screen.getByRole("alert");
    expect(callout).toHaveTextContent("Your card was declined.");
    expect(callout).toHaveAttribute("data-tone", "danger");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
