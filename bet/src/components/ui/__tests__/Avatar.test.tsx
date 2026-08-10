import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Avatar, AvatarStack } from "../Avatar";

describe("Avatar", () => {
  it("renders initials with the given color applied inline", () => {
    render(<Avatar initials="DB" color="#7c6cff" />);
    const el = screen.getByText("DB");
    expect(el).toHaveStyle({ backgroundColor: "#7c6cff" });
  });
});

describe("AvatarStack", () => {
  const avatars = [
    { id: "1", initials: "AA", color: "#111111" },
    { id: "2", initials: "BB", color: "#222222" },
    { id: "3", initials: "CC", color: "#333333" },
    { id: "4", initials: "DD", color: "#444444" },
    { id: "5", initials: "EE", color: "#555555" },
  ];

  it("renders every avatar up to max with no overflow badge", () => {
    render(<AvatarStack avatars={avatars.slice(0, 3)} max={4} />);
    expect(screen.getByText("AA")).toBeInTheDocument();
    expect(screen.getByText("CC")).toBeInTheDocument();
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();
  });

  it("collapses avatars past max into a +N badge", () => {
    render(<AvatarStack avatars={avatars} max={3} />);
    expect(screen.getByText("AA")).toBeInTheDocument();
    expect(screen.getByText("CC")).toBeInTheDocument();
    expect(screen.queryByText("DD")).not.toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
  });
});
