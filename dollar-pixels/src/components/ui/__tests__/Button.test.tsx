import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button, type ButtonSize, type ButtonVariant } from "../Button";

const variants: ButtonVariant[] = ["primary", "secondary", "ghost", "danger"];
const sizes: ButtonSize[] = ["sm", "md"];

describe("Button", () => {
  it("renders a native button that defaults to type=button", () => {
    render(<Button>Buy blocks</Button>);
    const button = screen.getByRole("button", { name: "Buy blocks" });
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
  });

  it("respects an explicit type", () => {
    render(<Button type="submit">Check out</Button>);
    expect(screen.getByRole("button", { name: "Check out" })).toHaveAttribute(
      "type",
      "submit",
    );
  });

  it.each(variants)("renders and stays clickable in the %s variant", async (variant) => {
    const onClick = vi.fn();
    render(
      <Button variant={variant} onClick={onClick}>
        Go
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Go" });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it.each(sizes)("renders in the %s size", (size) => {
    render(<Button size={size}>Go</Button>);
    expect(screen.getByRole("button", { name: "Go" })).toBeInTheDocument();
  });

  it("keeps its accessible name while loading, and disables rather than firing", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Buy blocks
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Buy blocks" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeDisabled();

    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("hides the spinner from assistive tech so the button is announced once", () => {
    const { container } = render(<Button loading>Buy blocks</Button>);
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("forwards a ref to the underlying element", () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(<Button ref={ref}>Go</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });
});
