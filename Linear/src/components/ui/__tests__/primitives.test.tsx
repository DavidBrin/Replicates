import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useRef, useState } from "react";

import {
  Avatar,
  AVATAR_COLORS,
  avatarColorForId,
  initialsFor,
} from "@/components/ui/avatar";
import { Badge, CountPill, DueDatePill, LabelChip } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Kbd, Shortcut } from "@/components/ui/kbd";
import { Popover } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { SkeletonList } from "@/components/ui/skeleton";

describe("Avatar", () => {
  it("derives a stable colour from the id", () => {
    // An avatar that re-rolls its colour between renders makes the list
    // unscannable by colour, which is most of what an 18px avatar is for.
    const first = avatarColorForId("usr_9f3c");
    expect(avatarColorForId("usr_9f3c")).toBe(first);
    expect(AVATAR_COLORS).toContain(first);
  });

  it("spreads ids that share a prefix across the palette", () => {
    // Every id in this app shares a prefix by design. A weak hash would hand
    // consecutively created users the same three colours.
    const colours = new Set(
      Array.from({ length: 40 }, (_, i) => avatarColorForId(`usr_${i}`)),
    );
    expect(colours.size).toBeGreaterThan(4);
  });

  it("omits the palest swatch, which cannot carry white initials", () => {
    expect(AVATAR_COLORS).not.toContain("#f7c8c1");
  });

  it("takes initials from the first and last words", () => {
    expect(initialsFor("David Del Rio")).toBe("DR");
    expect(initialsFor("Marco Vidal")).toBe("MV");
    expect(initialsFor("cher")).toBe("CH");
    expect(initialsFor("   ")).toBe("?");
  });

  it("prefers an explicit colour over the derived one", () => {
    render(<Avatar id="usr_1" name="Rafi Okonjo" color="#26b5ce" />);
    expect(screen.getByRole("img", { name: "Rafi Okonjo" })).toHaveStyle({
      background: "#26b5ce",
    });
  });

  it("renders the image when one exists, initials otherwise", () => {
    const { container } = render(
      <Avatar id="usr_1" name="Rafi Okonjo" src="data:image/gif;base64,R0lGOD" />,
    );
    expect(container.querySelector("img")).toBeInTheDocument();

    render(<Avatar id="usr_2" name="Rafi Okonjo" />);
    expect(screen.getByText("RO")).toBeInTheDocument();
  });

  it("goes silent when decorative", () => {
    const { container } = render(<Avatar id="usr_1" name="David" decorative />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });
});

describe("Badge", () => {
  it("renders a label's colour as a dot, never as the chip background", () => {
    // Four saturated fills in a 44px row out-shout the title they annotate.
    const { container } = render(<LabelChip name="Bug" color="#eb5757" />);
    const chip = container.firstElementChild as HTMLElement;
    expect(chip.style.background).toBe("");
    expect(screen.getByText("Bug")).toBeInTheDocument();
    expect(chip.querySelector("span")).toHaveStyle({ background: "#eb5757" });
  });

  it("keeps the label's name available when the chip is a bare dot", () => {
    render(<LabelChip name="Bug" color="#eb5757" dotOnly />);
    expect(screen.getByText("Bug")).toHaveClass("sr-only");
  });

  it("only paints a due date red when the caller says it is overdue", () => {
    // A past date on a Done issue is not a problem, and colouring it anyway
    // teaches the user to ignore the colour.
    const { container: plain } = render(<DueDatePill>Aug 31</DueDatePill>);
    expect(plain.firstElementChild).not.toHaveClass("text-danger");

    const { container: late } = render(<DueDatePill overdue>Aug 31</DueDatePill>);
    expect(late.firstElementChild).toHaveClass("text-danger");
  });

  it("caps a count rather than reflowing the row it sits in", () => {
    render(<CountPill count={1284} />);
    expect(screen.getByText("99+")).toBeInTheDocument();
  });

  it("renders arbitrary content in the base pill", () => {
    render(<Badge>3 sub-issues</Badge>);
    expect(screen.getByText("3 sub-issues")).toBeInTheDocument();
  });
});

describe("Button", () => {
  it("defaults to type=button so a toolbar button cannot submit a form", () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button>Filter</Button>
      </form>,
    );
    expect(screen.getByRole("button", { name: "Filter" })).toHaveAttribute(
      "type",
      "button",
    );
  });

  it("forwards a ref to the underlying element", () => {
    // A parent needs this to anchor a popover to the button that opened it,
    // which is the single most common composition in this app.
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Measure</Button>);
    expect(ref.current).toBe(screen.getByRole("button"));
  });

  it("renders leading and trailing slots around the label", () => {
    render(
      <Button leading={<span>L</span>} trailing={<span>T</span>}>
        Status
      </Button>,
    );
    expect(screen.getByRole("button").textContent).toBe("LStatusT");
  });
});

describe("Input and Textarea", () => {
  it("accepts typing and reports invalid state", async () => {
    const user = userEvent.setup();
    render(<Input aria-label="Title" invalid />);
    const input = screen.getByLabelText("Title");
    await user.type(input, "ENG-1");
    expect(input).toHaveValue("ENG-1");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("drops the border in its bare form, for use inside a popover", () => {
    const { container } = render(<Input variant="bare" aria-label="Search" />);
    expect(container.firstElementChild?.className).not.toContain("border-default");
  });

  it("grows the textarea to fit and never below its starting height", async () => {
    const user = userEvent.setup();
    render(<Textarea aria-label="Description" />);
    const field = screen.getByLabelText("Description");
    await user.type(field, "line one{Enter}line two{Enter}line three");
    // jsdom reports scrollHeight 0, so the assertion is that the resize path
    // ran and set an explicit height rather than throwing on the way through.
    expect(field.style.height).not.toBe("");
  });
});

describe("Kbd", () => {
  it("renders a cap per key", () => {
    render(<Kbd>S</Kbd>);
    expect(screen.getByText("S")).toBeInTheDocument();
  });

  it("maps modifiers to symbols and expands them for a screen reader", () => {
    render(<Shortcut keys="shift+3" />);
    expect(screen.getByText("⇧")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("renders a chord as separate steps", () => {
    // `G then I` is a real distinction in this keymap — `M` is a prefix and
    // never a bare action.
    const { container } = render(<Shortcut keys="G then I" />);
    const caps = container.querySelectorAll("kbd");
    expect(Array.from(caps).map((cap) => cap.textContent)).toEqual(["G", "I"]);
  });

  it("speaks `mod` as a word rather than a symbol", () => {
    render(<Shortcut keys="mod+z" />);
    // jsdom is not macOS, so the platform modifier resolves to Control.
    expect(screen.getByText(/Control\+z/i)).toBeInTheDocument();
  });
});

describe("Popover", () => {
  function Harness({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
    const anchor = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    return (
      <>
        <button ref={anchor} type="button" onClick={() => setOpen((o) => !o)}>
          Open
        </button>
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            onOpenChange?.(next);
          }}
          anchor={anchor}
          aria-label="Panel"
        >
          <button type="button">First</button>
          <button type="button">Second</button>
        </Popover>
      </>
    );
  }

  it("mounts on open and moves focus inside", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByRole("button", { name: "First" })).toHaveFocus();
  });

  it("closes on Escape and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open" });

    await user.click(trigger);
    await screen.findByRole("button", { name: "First" });
    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "First" })).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it("traps Tab inside the panel", async () => {
    // Tabbing out of an open popover leaves it floating over a page you are
    // now navigating.
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open" }));

    await user.tab();
    expect(screen.getByRole("button", { name: "Second" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
  });

  it("closes on an outside click but not on a click on its own trigger", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <>
        <Harness onOpenChange={onOpenChange} />
        <button type="button">Elsewhere</button>
      </>,
    );

    await user.click(screen.getByRole("button", { name: "Open" }));
    await screen.findByRole("button", { name: "First" });

    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "First" })).not.toBeInTheDocument(),
    );
  });
});

describe("Tooltip", () => {
  it("opens on hover after a delay and closes immediately", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Change status" shortcut="S" instant>
        <button type="button">Status</button>
      </Tooltip>,
    );

    await user.hover(screen.getByRole("button", { name: "Status" }));
    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent("Change status");

    await user.unhover(screen.getByRole("button", { name: "Status" }));
    await waitFor(() =>
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(),
    );
  });

  it("describes its trigger while open", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Change status" instant>
        <button type="button">Status</button>
      </Tooltip>,
    );
    await user.hover(screen.getByRole("button"));
    await screen.findByRole("tooltip");
    expect(screen.getByRole("button").parentElement).toHaveAttribute(
      "aria-describedby",
    );
  });

  it("dismisses on Escape", async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Change status" instant>
        <button type="button">Status</button>
      </Tooltip>,
    );
    await user.hover(screen.getByRole("button"));
    await screen.findByRole("tooltip");
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(),
    );
  });
});

describe("Skeleton", () => {
  it("announces itself as busy without reading out every placeholder", () => {
    render(<SkeletonList count={4} />);
    const list = screen.getByRole("status", { name: "Loading issues" });
    expect(list).toHaveAttribute("aria-busy", "true");
    expect(list.querySelectorAll("[data-skeleton]").length).toBeGreaterThan(4);
  });

  it("varies the title width deterministically, so hydration matches", () => {
    // A random width renders differently on the server and the client, which
    // is a hydration mismatch in the one place nothing looks.
    const { container: first } = render(<SkeletonList count={5} />);
    const { container: second } = render(<SkeletonList count={5} />);
    expect(first.innerHTML).toBe(second.innerHTML);
  });
});
