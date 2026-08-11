import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Field } from "../Field";

describe("Field", () => {
  it("associates its label with the input via a generated id", async () => {
    render(<Field label="Caption" />);
    const input = screen.getByLabelText("Caption");
    expect(input.id).not.toBe("");
    await userEvent.type(input, "hello");
    expect(input).toHaveValue("hello");
  });

  it("gives two fields distinct ids so labels do not cross", () => {
    render(
      <>
        <Field label="Caption" />
        <Field label="Colour" />
      </>,
    );
    expect(screen.getByLabelText("Caption").id).not.toBe(
      screen.getByLabelText("Colour").id,
    );
  });

  it("uses a supplied id verbatim", () => {
    render(<Field label="Slug" id="page-slug" />);
    expect(screen.getByLabelText("Slug")).toHaveAttribute("id", "page-slug");
  });

  it("describes the input with its hint", () => {
    render(<Field label="Slug" hint="Lowercase letters, numbers and hyphens." />);
    expect(screen.getByLabelText("Slug")).toHaveAccessibleDescription(
      "Lowercase letters, numbers and hyphens.",
    );
  });

  it("marks the input invalid and announces the error", () => {
    render(<Field label="Slug" error="That slug is taken." />);

    const input = screen.getByLabelText("Slug");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("That slug is taken.");
    expect(screen.getByRole("alert")).toHaveTextContent("That slug is taken.");
  });

  it("describes the input with the hint and the error together", () => {
    render(<Field label="Slug" hint="3 to 32 characters." error="Too short." />);
    expect(screen.getByLabelText("Slug")).toHaveAccessibleDescription(
      "3 to 32 characters. Too short.",
    );
  });

  it("leaves a valid field undescribed and not flagged", () => {
    render(<Field label="Caption" />);
    const input = screen.getByLabelText("Caption");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  it("forwards a ref and passes input props through", () => {
    const ref = { current: null as HTMLInputElement | null };
    render(<Field ref={ref} label="Caption" placeholder="Say something" maxLength={60} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(screen.getByPlaceholderText("Say something")).toHaveAttribute("maxLength", "60");
  });
});
