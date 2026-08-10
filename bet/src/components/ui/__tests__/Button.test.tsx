import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "../Button";

describe("Button", () => {
  it("renders as a native <button>", () => {
    render(<Button>Buy Yes</Button>);
    const btn = screen.getByRole("button", { name: "Buy Yes" });
    expect(btn.tagName).toBe("BUTTON");
    expect(btn).toHaveAttribute("type", "button");
  });

  it("fires onClick", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("respects an explicit type", () => {
    render(<Button type="submit">Submit</Button>);
    expect(screen.getByRole("button", { name: "Submit" })).toHaveAttribute("type", "submit");
  });

  it("loading sets aria-busy and disables the button, and does not fire onClick", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Buy Yes
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Buy Yes" });
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(btn).toBeDisabled();
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("forwards a ref to the underlying element", () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(<Button ref={ref}>Click</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });
});
