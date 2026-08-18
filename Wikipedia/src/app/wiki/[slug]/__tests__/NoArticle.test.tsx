import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NoArticle } from "../NoArticle";

describe("NoArticle", () => {
  it("renders the page-does-not-exist message for an unknown slug", () => {
    render(<NoArticle slug="This_Article_Does_Not_Exist" />);

    expect(
      screen.getByRole("heading", { name: "This Article Does Not Exist" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("This page is not deployed yet or does not exist."),
    ).toBeInTheDocument();
  });

  it("links back to the Main page", () => {
    render(<NoArticle slug="Website_not_yet_deployed" />);
    expect(screen.getByRole("link", { name: "Main page" })).toHaveAttribute("href", "/");
  });

  it("decodes URI-encoded slugs for the displayed title", () => {
    render(<NoArticle slug="Foo%20Bar" />);
    expect(screen.getByRole("heading", { name: "Foo Bar" })).toBeInTheDocument();
  });
});
