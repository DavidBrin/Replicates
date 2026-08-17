import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Button, Chip, Menu, MenuItem, Sheet, SheetListItem } from "@/components/primitives";
import { CheckIcon } from "@/components/icons";

/**
 * The primitives.
 *
 * Each assertion here is a rule that a reimplementation would plausibly get
 * wrong *on its own*, which is why they are separate tests rather than one
 * "it renders" per component. There are no snapshots: a snapshot of a tree
 * asserts nothing about whether the tree is right and breaks every time a
 * class name moves.
 */

/* ------------------------------------------------------------- button ---- */

describe("Button — the interaction overlay", () => {
  /**
   * The headline finding of the signed-in research pass (R9 §2.1, §14): the
   * product cross-fades a `Stroke` + `Fill` sibling instead of swapping the
   * host's background. A `:hover { background: … }` implementation renders
   * identically at rest and is instantly wrong in use, so the structure is
   * what has to be asserted.
   */
  it("renders the Stroke and Fill overlay siblings, not a hover background", () => {
    render(<Button>Share</Button>);
    const button = screen.getByRole("button", { name: "Share" });

    const feedback = button.querySelector("[data-touch-feedback]");
    expect(feedback).not.toBeNull();
    expect(feedback?.querySelector("[data-touch-stroke]")).not.toBeNull();
    expect(feedback?.querySelector("[data-touch-fill]")).not.toBeNull();

    // Both layers rest at zero and are raised by opacity, never by a colour
    // swap — so the value is a custom property rather than a literal.
    const fill = feedback?.querySelector("[data-touch-fill]");
    expect(fill?.getAttribute("style")).toContain("var(--yt-fill-opacity)");
  });

  it("never carries a hover background utility on the host", () => {
    // The negative half of the rule above. If someone "simplifies" the overlay
    // away, the class list is where the shortcut shows up first.
    render(<Button variant="tonal">Save</Button>);
    const classes = screen.getByRole("button", { name: "Save" }).className;
    expect(classes).not.toMatch(/hover:bg-/);
  });

  it("flips the overlay's polarity for a filled button", () => {
    // A Filled Mono button is near-white on a dark page, so its overlay has to
    // darken: `touch-response-inverse` at the `state-mono-filled-*` opacities.
    // Getting this wrong makes the one button on the page that should darken
    // glow instead.
    render(
      <>
        <Button variant="filled">Subscribe</Button>
        <Button variant="tonal">Share</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Subscribe" }).className).toContain(
      "--yt-fill-color:var(--yt-touch-response-inverse)",
    );
    expect(screen.getByRole("button", { name: "Share" }).className).toContain(
      "--yt-fill-color:var(--yt-touch-response)",
    );
  });

  it("carries the measured height and radius for each of the four sizes", () => {
    // R9 §2.1: 32/16, 40/20, 48/24, 56/28. The radius is always half the
    // height — every button is a pill, which is exactly why the chip's 8px
    // radius (below) is so easy to get wrong.
    const cases = [
      ["s", "h-8", "rounded-[16px]"],
      ["m", "h-10", "rounded-[20px]"],
      ["l", "h-12", "rounded-[24px]"],
      ["xl", "h-14", "rounded-[28px]"],
    ] as const;

    for (const [size, height, radius] of cases) {
      const { unmount } = render(<Button size={size}>Label</Button>);
      const classes = screen.getByRole("button", { name: "Label" }).className;
      expect(classes, `size ${size} height`).toContain(height);
      expect(classes, `size ${size} radius`).toContain(radius);
      unmount();
    }
  });

  it("keeps the icons and drops only the label in the no-text mode", () => {
    // The *subscribed* state of the Subscribe button is a bell and a chevron
    // with no words (R9 §9.1). The label still has to be passed, because it is
    // what names the control.
    render(
      <Button
        hideLabel
        leading={<CheckIcon />}
        trailing={<CheckIcon />}
        aria-label="Subscribed"
      >
        Subscribed
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Subscribed" });
    expect(button.querySelector("[data-button-label]")).toBeNull();
    expect(button.querySelector('[data-button-icon="leading"]')).not.toBeNull();
    expect(button.querySelector('[data-button-icon="trailing"]')).not.toBeNull();
  });

  it("defaults to type=button so a toolbar control cannot submit a form", () => {
    render(
      <form onSubmit={(event) => event.preventDefault()}>
        <Button>Filter</Button>
      </form>,
    );
    expect(screen.getByRole("button", { name: "Filter" })).toHaveAttribute(
      "type",
      "button",
    );
  });
});

/* --------------------------------------------------------------- chip ---- */

describe("Chip", () => {
  it("is 32px tall with an 8px radius — not a pill", () => {
    // Measured (`chips-and-miniguide.json`). Memory reliably says pill here,
    // because every other rounded control in this system is one.
    render(<Chip>All</Chip>);
    const classes = screen.getByRole("tab", { name: "All" }).className;
    expect(classes).toContain("h-8");
    expect(classes).toContain("rounded-compact");
    expect(classes).not.toContain("rounded-full");
  });

  it("inverts its fill when selected, rather than tinting it", () => {
    render(
      <>
        <Chip selected>All</Chip>
        <Chip>Music</Chip>
      </>,
    );
    const selected = screen.getByRole("tab", { name: "All" });
    const unselected = screen.getByRole("tab", { name: "Music" });

    expect(selected.className).toContain("bg-inverted");
    expect(selected.className).toContain("text-primary-inverse");
    expect(unselected.className).toContain("bg-additive");
    expect(unselected.className).toContain("text-primary");
  });

  it("is a tab, and says which one is selected", () => {
    // The captured HTML is `<button role="tab" aria-selected>` inside the feed
    // filter bar — not a checkbox, not a link, not a listbox option.
    render(
      <>
        <Chip selected>All</Chip>
        <Chip>Music</Chip>
      </>,
    );
    expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Music" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });
});

/* --------------------------------------------------------------- menu ---- */

function renderMenu() {
  return render(
    <Menu
      label="Settings"
      trigger={(props) => (
        <button {...props} type="button">
          Settings
        </button>
      )}
    >
      <MenuItem>Your data in YouTube</MenuItem>
      <MenuItem role="menuitemradio" checked>
        Dark theme
      </MenuItem>
      <MenuItem role="menuitemradio">Light theme</MenuItem>
    </Menu>,
  );
}

describe("Menu — the APG menu-button pattern", () => {
  it("marks the trigger as a menu button and tracks expansion", async () => {
    const user = userEvent.setup();
    renderMenu();
    const trigger = screen.getByRole("button", { name: "Settings" });

    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu", { name: "Settings" })).toBeInTheDocument();
  });

  it("opens on the checked item rather than on row 0", async () => {
    // Otherwise a keyboard user's first two presses in a settings menu are
    // always corrections. The APG allows either; the *useful* one is this.
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("menuitemradio", { name: "Dark theme" })).toHaveFocus();
  });

  it("uses a roving tabindex — exactly one item is tabbable at a time", async () => {
    // The single most common real-world bug in this pattern is giving every
    // item `tabindex="0"`, which floods the page's Tab sequence and breaks the
    // "the whole menu is one tab stop" contract.
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: "Settings" }));

    // Queried by attribute rather than by role: radios and plain items both
    // count towards the roving position, and `getAllByRole` takes one role at
    // a time.
    const menu = screen.getByRole("menu");
    const items = Array.from(menu.querySelectorAll('[role^="menuitem"]'));
    const tabbable = items.filter(
      (item) => item.getAttribute("tabindex") === "0",
    );
    expect(items).toHaveLength(3);
    expect(tabbable).toHaveLength(1);
  });

  it("moves the roving position with the arrow keys, and wraps", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: "Settings" }));

    // Opened on "Dark theme" (index 1).
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitemradio", { name: "Light theme" })).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Your data in YouTube" })).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitemradio", { name: "Light theme" })).toHaveFocus();
  });

  it("jumps to the ends with Home and End", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: "Settings" }));

    await user.keyboard("{End}");
    expect(screen.getByRole("menuitemradio", { name: "Light theme" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("menuitem", { name: "Your data in YouTube" })).toHaveFocus();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    // Without the restore a keyboard user is dropped back at the top of the
    // document — §7.4 and §8.1 of the a11y research both call it out.
    const user = userEvent.setup();
    renderMenu();
    const trigger = screen.getByRole("button", { name: "Settings" });
    await user.click(trigger);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("activates an item with Enter and closes", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <Menu
        label="Actions"
        trigger={(props) => (
          <button {...props} type="button">
            Actions
          </button>
        )}
      >
        <MenuItem onSelect={onSelect}>Report</MenuItem>
      </Menu>,
    );

    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("exposes radio rows as radios with their checked state", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByRole("menuitemradio", { name: "Dark theme" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("menuitemradio", { name: "Light theme" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });
});

/* -------------------------------------------------------------- sheet ---- */

describe("Sheet — contextual, not modal", () => {
  function renderSheet(onToggle = vi.fn()) {
    return {
      onToggle,
      ...render(
        <Sheet
          title="Save video to..."
          trigger={(props) => (
            <button {...props} type="button">
              Save
            </button>
          )}
        >
          <SheetListItem
            title="Watch later"
            subtitle="Private"
            checked={false}
            onToggle={onToggle}
            icon={<CheckIcon />}
          />
        </Sheet>,
      ),
    };
  }

  it("is a dialog that does not claim to be modal", async () => {
    // Measured: anchored to the button, no scrim, page still interactive
    // (R9 §9.3). `aria-modal` is a claim about the rest of the page, and this
    // sheet cannot honestly make it.
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByRole("button", { name: "Save" }));

    const dialog = screen.getByRole("dialog", { name: "Save video to..." });
    expect(dialog).not.toHaveAttribute("aria-modal");
    expect(document.querySelector("[data-guide-scrim]")).toBeNull();
  });

  it("moves focus in on open and restores it on Escape", async () => {
    const user = userEvent.setup();
    renderSheet();
    const trigger = screen.getByRole("button", { name: "Save" });
    await user.click(trigger);

    expect(screen.getByRole("menuitemcheckbox", { name: /Watch later/ })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("writes immediately and stays open — there is no confirm step", async () => {
    // The old checkbox-plus-Save footer is gone. Modelling the rows as a form
    // would change what the user is doing.
    const onToggle = vi.fn();
    const user = userEvent.setup();
    renderSheet(onToggle);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: /Watch later/ }));

    expect(onToggle).toHaveBeenCalledWith(true);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

/* ----------------------------------------------------------- contrast ---- */

/**
 * WCAG contrast of the token pairs this slice ships.
 *
 * §8.5 of `research/07-captions-and-a11y.md` warns that YouTube's dark
 * secondary grey is a borderline case and that matching it must not be treated
 * as automatically passing. The right response to that warning is to compute
 * the number rather than to trust or to distrust it — and computed, the
 * measured pair is comfortably over the line. The warning is *not* wrong in
 * general; it is wrong about these particular values, and the way to know that
 * is this test.
 */
function relativeLuminance(hex: string): number {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  const channels = [0, 2, 4].map((offset) => {
    const raw = Number.parseInt(full.slice(offset, offset + 2), 16) / 255;
    return raw <= 0.04045 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4;
  });
  const [r = 0, g = 0, b = 0] = channels;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  ) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

describe("token contrast (WCAG 1.4.3 / 1.4.11)", () => {
  const DARK_BG = "#0f0f0f";
  const LIGHT_BG = "#ffffff";

  it("clears 4.5:1 for every body-text pair in both themes", () => {
    const pairs: readonly [string, string, string][] = [
      ["dark text-primary", "#f1f1f1", DARK_BG],
      ["dark text-secondary", "#aaaaaa", DARK_BG],
      ["light text-primary", "#0f0f0f", LIGHT_BG],
      ["light text-secondary", "#606060", LIGHT_BG],
    ];
    for (const [name, ink, background] of pairs) {
      expect(contrastRatio(ink, background), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("puts the dark secondary grey at 8.25:1, not at the borderline the research warns about", () => {
    // The specific number, pinned. If a later change nudges either token, this
    // is the test that says so rather than a vague "still passes".
    expect(contrastRatio("#aaaaaa", DARK_BG)).toBeCloseTo(8.25, 1);
  });

  it("records that text-disabled does not clear 4.5:1, which is why it is only ever disabled", () => {
    // #717171 on #0f0f0f is 3.93:1. Exempt under SC 1.4.3 as disabled content
    // — but only for as long as nobody reaches for it as "a dimmer grey".
    expect(contrastRatio("#717171", DARK_BG)).toBeLessThan(4.5);
  });

  it("clears 3:1 for the focus ring against both page backgrounds (SC 1.4.11)", () => {
    expect(contrastRatio("#3ea6ff", DARK_BG)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio("#065fd4", LIGHT_BG)).toBeGreaterThanOrEqual(3);
  });

  it("clears 4.5:1 for white on every avatar fallback colour", () => {
    // These are the dark end of the measured add-on ramps, chosen for exactly
    // this reason — the fallback letter is white at every avatar size.
    const fallbacks = ["#5c7e00", "#891c52", "#882712", "#52077a", "#7f0119", "#00673c"];
    for (const colour of fallbacks) {
      expect(contrastRatio("#ffffff", colour), colour).toBeGreaterThanOrEqual(4.5);
    }
  });
});
