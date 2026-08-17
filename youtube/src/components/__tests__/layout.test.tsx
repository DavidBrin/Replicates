import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AppShell } from "@/components/layout/app-shell";
import {
  GUIDE_EXPANDED_MIN_WIDTH,
  GUIDE_MINI_MIN_WIDTH,
  Guide,
  MiniGuide,
  guideModeForWidth,
} from "@/components/layout/guide";
import { Masthead } from "@/components/layout/masthead";
import {
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
  ThemeProvider,
  ThemeToggle,
  useTheme,
} from "@/components/theme";

/**
 * The chrome.
 *
 * The values asserted here are the ones a later slice will build on top of and
 * therefore inherit: if the rail is 232px instead of 240, or the mini/expanded
 * boundary is at 1280 instead of 1313, every surface in the application is
 * subtly wrong and nothing else fails.
 */

function setViewportWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    writable: true,
    configurable: true,
    value: width,
  });
}

/**
 * The chrome always renders under the theme provider.
 *
 * That is not a testing convenience: the masthead's settings menu is *where
 * the theme is chosen*, so the masthead genuinely depends on it, and the root
 * layout wraps `<body>` in one. `useTheme` throws outside a provider by
 * design — asserted at the bottom of this file — so a missing wrapper here
 * would fail loudly rather than render a half-themed masthead.
 */
function renderChrome(ui: ReactElement) {
  return render(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <ThemeProvider initialPreference="dark">{children}</ThemeProvider>
    ),
  });
}

/* -------------------------------------------------------- breakpoints ---- */

describe("guideModeForWidth — the two bisected breakpoints", () => {
  /**
   * R8 §3.2 binary-searched both boundaries to the pixel: hidden→mini at
   * 791/792, mini→expanded at 1312/1313. Those two odd numbers are exactly the
   * kind of thing that gets rounded to 800 and 1280 by someone reading a
   * screenshot, and the difference is a whole layout at 1300px.
   */
  it("switches to the mini rail at 792, not at 800", () => {
    expect(guideModeForWidth(791)).toBe("hidden");
    expect(guideModeForWidth(GUIDE_MINI_MIN_WIDTH)).toBe("mini");
  });

  it("switches to the expanded rail at 1313, not at 1280", () => {
    expect(guideModeForWidth(1312)).toBe("mini");
    expect(guideModeForWidth(GUIDE_EXPANDED_MIN_WIDTH)).toBe("expanded");
  });

  it("agrees with every viewport width the responsive sweep captured", () => {
    // `layout-responsive-and-nav.json`, all eleven rows.
    const measured: readonly [number, "expanded" | "mini" | "hidden"][] = [
      [1920, "expanded"],
      [1600, "expanded"],
      [1440, "expanded"],
      [1366, "expanded"],
      [1280, "mini"],
      [1024, "mini"],
      [900, "mini"],
      [768, "hidden"],
      [600, "hidden"],
      [480, "hidden"],
      [360, "hidden"],
    ];
    for (const [width, mode] of measured) {
      expect(guideModeForWidth(width), `${width}px`).toBe(mode);
    }
  });
});

/* ----------------------------------------------------------- app shell --- */

describe("AppShell — rail state and the content inset", () => {
  beforeEach(() => setViewportWidth(1920));

  it("insets the content column by the rail's measured width", async () => {
    // `pageManagerMargin` measured 240px expanded, 72px mini, 0px hidden.
    const { rerender } = renderChrome(<AppShell>content</AppShell>);
    const main = screen.getByRole("main");
    expect(main.style.marginLeft).toBe("var(--yt-guide-width)");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Guide" }));
    expect(main.style.marginLeft).toBe("var(--yt-guide-mini-width)");

    setViewportWidth(600);
    window.dispatchEvent(new Event("resize"));
    rerender(<AppShell>content</AppShell>);
    expect(screen.getByRole("main").style.marginLeft).toBe("0px");
  });

  it("collapses the persistent rail to the mini form rather than hiding it", async () => {
    // Above 1313 the drawer is persistent, so the toggle is expanded↔mini and
    // never expanded↔nothing — the mini rail is always what is left behind.
    const user = userEvent.setup();
    renderChrome(<AppShell>content</AppShell>);
    const shell = screen.getByRole("main").parentElement;

    expect(shell).toHaveAttribute("data-guide", "expanded");
    await user.click(screen.getByRole("button", { name: "Guide" }));
    expect(shell).toHaveAttribute("data-guide", "mini");
    expect(screen.getByRole("navigation", { name: "Guide" })).toHaveAttribute(
      "data-guide-mode",
      "mini",
    );
  });

  it("shows the mini rail without a drawer between 792 and 1312", () => {
    setViewportWidth(1024);
    renderChrome(<AppShell>content</AppShell>);
    expect(screen.getByRole("navigation", { name: "Guide" })).toHaveAttribute(
      "data-guide-mode",
      "mini",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows no rail at all below 792", () => {
    setViewportWidth(600);
    renderChrome(<AppShell>content</AppShell>);
    expect(screen.queryByRole("navigation", { name: "Guide" })).not.toBeInTheDocument();
  });

  it("opens a scrimmed, focus-trapping drawer below 1313 and restores focus on Escape", async () => {
    // The temporary drawer is the one overlay in this slice that carries a
    // scrim, and therefore the one that may claim `aria-modal` — which obliges
    // it to trap Tab. The contextual sheet is the opposite case, and its test
    // asserts the opposite.
    setViewportWidth(1024);
    const user = userEvent.setup();
    renderChrome(<AppShell>content</AppShell>);

    const toggle = screen.getByRole("button", { name: "Guide" });
    await user.click(toggle);

    const drawer = screen.getByRole("dialog", { name: "Guide" });
    expect(drawer).toHaveAttribute("aria-modal", "true");
    expect(document.querySelector("[data-guide-scrim]")).not.toBeNull();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
  });

  it("gives the content column a container context so the grid can size off it", () => {
    // Column count follows the *content* box, not the viewport: the same
    // 1920px window is 3 columns with the rail open and 4 with it collapsed.
    // A viewport media query cannot express that; the container query in
    // `globals.css` needs this element to exist and to wrap its children.
    renderChrome(<AppShell>content</AppShell>);
    const main = screen.getByRole("main");
    expect(main).toHaveClass("yt-content");
    expect(main.querySelector(".yt-content-inner")).not.toBeNull();
  });
});

/* --------------------------------------------------------------- guide --- */

describe("Guide — signed out", () => {
  it("carries the sign-in promo with its measured copy", () => {
    // R8 §8.3 records the string verbatim; it is the one piece of prose in the
    // rail and it is signed-out-only.
    render(<Guide />);
    expect(
      screen.getByText("Sign in to like videos, comment, and subscribe."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });

  it("has the five primary entries and both section headings", () => {
    render(<Guide />);
    for (const label of ["Home", "Shorts", "Subscriptions", "You", "History"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("heading", { name: "Explore" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "More from YouTube" }),
    ).toBeInTheDocument();
  });

  it("marks the current entry with aria-current, not only with a fill", () => {
    render(<Guide activePath="/feed/history" />);
    expect(screen.getByRole("link", { name: "History" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("distinguishes the active entry by weight as well as by fill", () => {
    // Measured twice over: `additive-background` *and* weight 500 against the
    // others' 400. Using only the fill is the common near-miss.
    render(<Guide activePath="/" />);
    const active = screen.getByRole("link", { name: "Home" });
    expect(active.className).toContain("bg-additive");
    expect(active.querySelector("span.flex-1")?.className).toContain(
      "font-[var(--yt-weight-medium)]",
    );
  });
});

describe("Guide — signed in", () => {
  const subscriptions = [
    { id: "a", name: "Channel A", href: "/@a", hasNewContent: true },
    { id: "b", name: "Channel B", href: "/@b" },
  ];

  it("drops the promo and grows a subscriptions section", () => {
    render(<Guide signedIn subscriptions={subscriptions} />);
    expect(
      screen.queryByText("Sign in to like videos, comment, and subscribe."),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Channel A/ })).toBeInTheDocument();
  });

  it("renders the collapsible section header as a link, not as a heading", () => {
    // R9 §3.2: the "Subscriptions" collapsible header is an *entry* — same
    // 204×40 / 10px-radius box as a row, 16px/22px w500 label, 16px trailing
    // chevron — and the whole row links to /feed/subscriptions. Building it as
    // a heading with a disclosure button beside it is a different control.
    render(<Guide signedIn subscriptions={subscriptions} />);
    const headers = screen.getAllByRole("link", { name: /^Subscriptions/ });
    expect(headers.length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("heading", { name: "Subscriptions" }),
    ).not.toBeInTheDocument();
  });

  it("shows the new-video dot only on channels that have one", () => {
    render(<Guide signedIn subscriptions={subscriptions} />);
    const withDot = screen.getByRole("link", { name: /Channel A/ });
    const withoutDot = screen.getByRole("link", { name: /Channel B/ });
    expect(withDot.querySelector(".bg-\\[var\\(--yt-call-to-action\\)\\]")).not.toBeNull();
    expect(withoutDot.querySelector(".bg-\\[var\\(--yt-call-to-action\\)\\]")).toBeNull();
  });
});

describe("MiniGuide", () => {
  it("has four entries, not five — History is expanded-only", () => {
    render(<MiniGuide />);
    const nav = screen.getByRole("navigation", { name: "Guide" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Home",
      "Shorts",
      "Subscriptions",
      "You",
    ]);
  });

  it("labels at 10px — the only place in the product that goes below 12", () => {
    render(<MiniGuide />);
    const home = screen.getByRole("link", { name: "Home" });
    expect(home.querySelector("span.truncate")?.className).toContain("text-mini");
  });
});

/* ------------------------------------------------------------ masthead --- */

describe("Masthead", () => {
  it("is 56px tall at every width", () => {
    renderChrome(<Masthead />);
    expect(screen.getByRole("banner").className).toContain("h-14");
  });

  it("carries a search landmark with the measured placeholder", () => {
    renderChrome(<Masthead />);
    const search = screen.getByRole("search");
    expect(within(search).getByPlaceholderText("Search")).toBeInTheDocument();
  });

  it("submits the query rather than navigating on every keystroke", async () => {
    const submitted: string[] = [];
    const user = userEvent.setup();
    renderChrome(<Masthead onSubmitQuery={(value) => submitted.push(value)} />);

    await user.type(screen.getByPlaceholderText("Search"), "how it is made");
    expect(submitted).toEqual([]);
    await user.keyboard("{Enter}");
    expect(submitted).toEqual(["how it is made"]);
  });

  it("shows Sign in when logged out and the account cluster when logged in", () => {
    const { rerender } = renderChrome(<Masthead />);
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Create" })).not.toBeInTheDocument();

    rerender(<Masthead signedIn account={{ name: "A Channel" }} />);
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
    // A **link**, not a button: the product's Create opens a menu of three
    // things, two of which this application deliberately does not have (there
    // is no live ingest adapter and there are no posts). One real destination
    // is a link to it.
    expect(screen.getByRole("link", { name: "Create" })).toHaveAttribute(
      "href",
      "/studio/upload",
    );
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Account menu" })).toBeInTheDocument();
  });

  it("names the skip link the way the product does", () => {
    // Not an addition: "Skip navigation" is the masthead's first DOM text in
    // the capture. WCAG 2.4.1.
    renderChrome(<Masthead />);
    expect(screen.getByRole("link", { name: "Skip navigation" })).toHaveAttribute(
      "href",
      "#content",
    );
  });
});

/* --------------------------------------------------------------- theme --- */

function ThemeProbe() {
  const { preference, resolved } = useTheme();
  return (
    <p>
      {preference}/{resolved}
    </p>
  );
}

/**
 * An in-memory `Storage`.
 *
 * **This runner's jsdom does not expose `window.localStorage`** — reading it
 * throws a `TypeError`, which is a live demonstration of why every access in
 * `theme.tsx` is wrapped in `try`/`catch` rather than in a `typeof window`
 * check. Safari's private mode and some enterprise cookie policies throw the
 * same way in production. The stub below is what lets the persistence
 * assertion say something, instead of the test quietly proving that a throw is
 * swallowed.
 */
function installStorage(): void {
  const store = new Map<string, string>();
  const stub: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => Array.from(store.keys())[index] ?? null,
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    writable: true,
    value: stub,
  });
}

describe("ThemeProvider", () => {
  beforeEach(() => installStorage());

  afterEach(() => {
    document.documentElement.removeAttribute(THEME_ATTRIBUTE);
    document.documentElement.style.colorScheme = "";
  });

  it("re-points the token block by writing one attribute on <html>", async () => {
    // The whole theme is one attribute write. If this stops happening, every
    // colour in the app silently stays on the dark values in light mode.
    const user = userEvent.setup();
    render(
      <ThemeProvider initialPreference="dark">
        <ThemeToggle />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole("button"));
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("light");

    await user.click(screen.getByRole("button"));
    expect(document.documentElement.getAttribute(THEME_ATTRIBUTE)).toBe("dark");
  });

  it("sets color-scheme alongside it, so the UA paints its own parts to match", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider initialPreference="dark">
        <ThemeToggle />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole("button"));
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("persists the preference", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider initialPreference="dark">
        <ThemeToggle />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole("button"));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("resolves the device preference against prefers-color-scheme", () => {
    // The setup file's `matchMedia` stub reports `matches: false`, i.e. a
    // light OS. `device` must follow it rather than falling back to the
    // application default.
    render(
      <ThemeProvider initialPreference="device">
        <ThemeProbe />
      </ThemeProvider>,
    );
    expect(screen.getByText("device/light")).toBeInTheDocument();
  });

  it("names the action the press performs, not the state it is in", () => {
    // §7.3 of the a11y research: a toggle's accessible name flips to describe
    // what pressing it *does*, so a screen reader never announces a noun.
    render(
      <ThemeProvider initialPreference="dark">
        <ThemeToggle />
      </ThemeProvider>,
    );
    const toggle = screen.getByRole("button", { name: "Use the light theme" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
  });

  it("throws outside a provider rather than silently defaulting", () => {
    // A component that quietly gets "dark" when mounted outside the tree is a
    // bug that surfaces as one wrong colour in one route.
    expect(() => render(<ThemeProbe />)).toThrow(/ThemeProvider/);
  });
});
