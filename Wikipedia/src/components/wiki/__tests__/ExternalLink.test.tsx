import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExternalLink } from "@/components/wiki";

describe("ExternalLink", () => {
  it("renders a real external link when href is set", () => {
    render(<ExternalLink href="https://example.com">Example</ExternalLink>);
    const link = screen.getByRole("link", { name: "Example" });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveClass("external-link");
    expect(link).not.toHaveClass("new");
  });

  it("renders a red stub link with the deploy tooltip when href is null", () => {
    render(<ExternalLink href={null}>Website</ExternalLink>);
    const link = screen.getByRole("link", { name: "Website" });
    expect(link).toHaveClass("new");
    expect(link).toHaveAttribute("title", "the project is not deployed yet");
  });
});
