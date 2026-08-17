import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  CHANNEL_TABS,
  ChannelHeader,
  ChannelTabs,
  SubscribeButton,
  channelTabFromSegment,
  channelTabHref,
  type ChannelTab,
} from "@/components/channel";
import {
  formatSubscriberCount,
  formatVideoCount,
  formatViewCount,
} from "@/domain/format";

/**
 * The channel page's header and tab row.
 *
 * Every assertion is a rule a reimplementation would plausibly break **on its
 * own**, and several are shaped to fail if the implementation is changed to the
 * thing memory suggests instead of the thing that was measured:
 *
 * * the subscribed state must be the 74×40 icon-only bell pill and **not** a
 *   "Subscribed" text button — R9 §9.1 records both in the DOM and records
 *   which one is shown;
 * * the subscriber count must come from `formatSubscriberCount`, which keeps
 *   **three** significant digits, and not from `formatViewCount`, which keeps
 *   two. `7,060,000` is the sample that separates them: `7.06M` against `7M`.
 *
 * No snapshots. A snapshot of a header asserts nothing about whether the header
 * is right and goes red every time a class name moves.
 */

/** R8 §8.1's sample, and the one number that catches the wrong formatter. */
const SUBSCRIBERS = 7_060_000;
const VIDEOS = 526;

function okResponse(): Response {
  return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => okResponse());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function bodyOf(call: unknown[]): Record<string, unknown> {
  const init = call[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

/* ------------------------------------------------------------- tab row --- */

describe("ChannelTabs", () => {
  it("renders exactly the five specified tabs, in order", () => {
    render(<ChannelTabs handle="veritasium" active="home" />);
    const links = within(screen.getByRole("navigation")).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Home",
      "Videos",
      "Shorts",
      "Playlists",
      "About",
    ]);
  });

  it("points Home at the bare channel URL and every other tab at a segment", () => {
    render(<ChannelTabs handle="veritasium" active="home" />);
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute(
      "href",
      "/@veritasium",
    );
    expect(screen.getByRole("link", { name: "Videos" })).toHaveAttribute(
      "href",
      "/@veritasium/videos",
    );
    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute(
      "href",
      "/@veritasium/about",
    );
  });

  it("marks only the active tab, and switching `active` moves the mark", () => {
    const { rerender } = render(
      <ChannelTabs handle="veritasium" active="home" />,
    );
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Videos" })).not.toHaveAttribute(
      "aria-current",
    );

    rerender(<ChannelTabs handle="veritasium" active="playlists" />);
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute(
      "aria-current",
    );
    expect(screen.getByRole("link", { name: "Playlists" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("gives the selected tab primary ink and the rest secondary", () => {
    render(<ChannelTabs handle="veritasium" active="videos" />);
    const selected = screen.getByRole("link", { name: "Videos" });
    const other = screen.getByRole("link", { name: "Shorts" });
    expect(selected.className).toContain("text-primary");
    expect(other.className).toContain("text-secondary");
    expect(other.className).toContain("border-transparent");
  });

  it("encodes a handle that needs it, in both the href and the segment", () => {
    expect(channelTabHref("a.b_c-d", "videos")).toBe("/@a.b_c-d/videos");
    expect(channelTabHref("a b", "home")).toBe("/@a%20b");
  });

  it("round-trips every tab through its own segment", () => {
    for (const tab of CHANNEL_TABS) {
      const href = channelTabHref("x", tab);
      const segment = href.replace("/@x", "").replace(/^\//, "");
      expect(channelTabFromSegment(segment === "" ? undefined : segment)).toBe(
        tab,
      );
    }
  });

  it("reads a missing or empty segment as Home and an unknown one as nothing", () => {
    expect(channelTabFromSegment(undefined)).toBe<ChannelTab>("home");
    expect(channelTabFromSegment("")).toBe<ChannelTab>("home");
    // Not a silent fall back to Home: `/@x/nonsense` is a URL that does not
    // exist, and the page turns this `null` into a 404.
    expect(channelTabFromSegment("nonsense")).toBeNull();
    // The measured row has a Posts tab and this one does not — see the
    // component's header. It must not resolve by accident.
    expect(channelTabFromSegment("posts")).toBeNull();
  });
});

/* -------------------------------------------------------------- header --- */

describe("ChannelHeader", () => {
  function renderHeader(overrides: Record<string, unknown> = {}) {
    return render(
      <ChannelHeader
        name="Veritasium"
        handle="veritasium"
        subscriberCount={SUBSCRIBERS}
        videoCount={VIDEOS}
        description="An element of truth."
        {...overrides}
      />,
    );
  }

  it("uses formatSubscriberCount — three significant digits — not the view ladder", () => {
    renderHeader();
    // `7.06M subscribers`, and emphatically not `7M subscribers`. Asserted
    // against the formatter rather than a literal so the test cannot drift
    // away from the module it is protecting.
    expect(screen.getByText(formatSubscriberCount(SUBSCRIBERS))).toBeInTheDocument();
    expect(
      screen.queryByText(formatViewCount(SUBSCRIBERS).replace(" views", " subscribers")),
    ).toBeNull();
    expect(formatSubscriberCount(SUBSCRIBERS)).toBe("7.06M subscribers");
  });

  it("writes the video count out in full, lowercase noun", () => {
    renderHeader();
    expect(screen.getByText(formatVideoCount(VIDEOS))).toBeInTheDocument();
    expect(formatVideoCount(VIDEOS)).toBe("526 videos");
  });

  it("renders the handle with its `@`, which the column does not store", () => {
    renderHeader();
    expect(screen.getByText("@veritasium")).toBeInTheDocument();
  });

  it("shows the verified tick only when the channel carries one", () => {
    const { rerender } = renderHeader();
    expect(document.querySelector("[data-channel-verified]")).toBeNull();
    rerender(
      <ChannelHeader
        name="Veritasium"
        handle="veritasium"
        verified
        subscriberCount={SUBSCRIBERS}
        videoCount={VIDEOS}
        description=""
      />,
    );
    expect(document.querySelector("[data-channel-verified]")).not.toBeNull();
  });

  it("renders the banner at the measured 1284 : 206.98 ratio, and omits it when absent", () => {
    const { rerender } = renderHeader({ bannerUrl: "/api/media/banner.jpg" });
    const banner = document.querySelector("[data-channel-banner]");
    expect(banner).not.toBeNull();
    expect(banner?.getAttribute("style")).toContain("1284 / 206.98");

    rerender(
      <ChannelHeader
        name="Veritasium"
        handle="veritasium"
        subscriberCount={SUBSCRIBERS}
        videoCount={VIDEOS}
        description=""
      />,
    );
    expect(document.querySelector("[data-channel-banner]")).toBeNull();
  });

  it("clamps the description to the measured single line until it is expanded", async () => {
    const user = userEvent.setup();
    renderHeader();
    const text = document.querySelector("[data-channel-description]");
    expect(text?.className).toContain("truncate");

    await user.click(screen.getByRole("button", { name: "...more" }));
    expect(
      document.querySelector("[data-channel-description]")?.className,
    ).not.toContain("truncate");
    expect(screen.getByRole("button", { name: "less" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("renders no description block at all when there is no description", () => {
    renderHeader({ description: "" });
    expect(document.querySelector("[data-channel-description]")).toBeNull();
  });
});

/* ------------------------------------------------------ subscribe/bell --- */

describe("SubscribeButton", () => {
  it("is a text Subscribe pill when the viewer does not follow the channel", () => {
    render(<SubscribeButton channelId="c1" channelName="Veritasium" level={null} />);
    const button = screen.getByRole("button", { name: "Subscribe" });
    expect(button).toBeInTheDocument();
    expect(document.querySelector("[data-subscribed]")).toBeNull();
  });

  it("collapses the subscribed state to a 74×40 icon-only bell pill, with no label", () => {
    render(
      <SubscribeButton
        channelId="c1"
        channelName="Veritasium"
        level="personalised"
      />,
    );
    const pill = document.querySelector("[data-subscribed]");
    expect(pill).not.toBeNull();
    // R9 §9.1: `IconLeadingTrailingNoText`, 74 × 40. The alternate
    // «Subscribed» text pill exists in the product's DOM and is *not* what is
    // shown — building it is the mistake this asserts against.
    expect(pill?.textContent?.trim()).toBe("");
    expect(screen.queryByText("Subscribed")).toBeNull();
    expect(pill?.className).toContain("w-[74px]");
    expect(pill?.className).toContain("h-10");
    // Icon-only, so the accessible name has to come from `aria-label`.
    expect(pill?.getAttribute("aria-label")).toBe(
      "Notifications for Veritasium: Personalised",
    );
  });

  it("hides itself entirely on the viewer's own channel", () => {
    const { container } = render(
      <SubscribeButton
        channelId="c1"
        channelName="Mine"
        level={null}
        ownedByViewer
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("subscribes on click, flipping to the bell and posting the default level", async () => {
    const user = userEvent.setup();
    render(<SubscribeButton channelId="c1" channelName="Veritasium" level={null} />);

    await user.click(screen.getByRole("button", { name: "Subscribe" }));

    expect(document.querySelector("[data-subscribed]")).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] ?? [];
    expect(call[0]).toBe("/api/subscriptions");
    expect(bodyOf(call)).toEqual({
      action: "subscribe",
      channelId: "c1",
      // The repository's own default, so pressing Subscribe and never opening
      // the bell leaves the viewer where the product leaves them.
      notifications: "personalised",
    });
  });

  it("opens the notification menu from the bell, with the current level checked", async () => {
    const user = userEvent.setup();
    render(
      <SubscribeButton channelId="c1" channelName="Veritasium" level="all" />,
    );

    await user.click(screen.getByRole("button", { name: /Notifications for/ }));
    const menu = screen.getByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitemradio")
        .map((item) => item.textContent),
    ).toEqual(["All", "Personalised", "None"]);
    expect(within(menu).getByRole("menuitemradio", { name: "All" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(within(menu).getByRole("menuitem", { name: "Unsubscribe" })).toBeInTheDocument();
  });

  it("changes the bell level without leaving the subscribed state", async () => {
    const user = userEvent.setup();
    render(
      <SubscribeButton channelId="c1" channelName="Veritasium" level="all" />,
    );

    await user.click(screen.getByRole("button", { name: /Notifications for/ }));
    await user.click(screen.getByRole("menuitemradio", { name: "None" }));

    expect(bodyOf(fetchMock.mock.calls[0] ?? [])).toEqual({
      action: "notifications",
      channelId: "c1",
      notifications: "none",
    });
    // Still subscribed — the bell is a level, not an on/off switch.
    expect(document.querySelector("[data-subscribed]")).not.toBeNull();
    expect(
      document.querySelector("[data-subscribed]")?.getAttribute("aria-label"),
    ).toBe("Notifications for Veritasium: None");
  });

  it("unsubscribes from the menu, returning to the Subscribe pill", async () => {
    const user = userEvent.setup();
    render(
      <SubscribeButton
        channelId="c1"
        channelName="Veritasium"
        level="personalised"
      />,
    );

    await user.click(screen.getByRole("button", { name: /Notifications for/ }));
    await user.click(screen.getByRole("menuitem", { name: "Unsubscribe" }));

    expect(bodyOf(fetchMock.mock.calls[0] ?? [])).toEqual({
      action: "unsubscribe",
      channelId: "c1",
    });
    expect(screen.getByRole("button", { name: "Subscribe" })).toBeInTheDocument();
    expect(document.querySelector("[data-subscribed]")).toBeNull();
  });

  it("puts the pill back and says so when the write fails", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as unknown as Response);

    render(<SubscribeButton channelId="c1" channelName="Veritasium" level={null} />);
    await user.click(screen.getByRole("button", { name: "Subscribe" }));

    expect(screen.getByRole("button", { name: "Subscribe" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("did not save");
  });

  it("asks a signed-out viewer to sign in rather than posting a doomed request", async () => {
    const user = userEvent.setup();
    render(
      <SubscribeButton
        channelId="c1"
        channelName="Veritasium"
        level={null}
        signedIn={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Subscribe" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Sign in to subscribe");
  });
});
