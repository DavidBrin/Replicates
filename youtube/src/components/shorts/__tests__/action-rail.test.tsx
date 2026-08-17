import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MenuItem } from "@/components/primitives";

import { ActionRail, type ActionRailProps } from "../action-rail";

/**
 * The rail.
 *
 * The expected strings are the ones in `research/09-youtube-signedin-surfaces.md`
 * §11 and `research/screenshots/19-shorts-1920.png` — «1M», «4,882», «Share»,
 * «Remix» — rather than strings chosen to match the implementation. The point of
 * the count assertions is that the two ladders are genuinely different: a rail
 * that abbreviated both would render `4.8K` where the product renders `4,882`.
 */

function props(overrides: Partial<ActionRailProps> = {}): ActionRailProps {
  return {
    title: "Avocado Clicker",
    likeCount: 1_000_000,
    dislikeCount: 3_400,
    commentCount: 4_882,
    commentsEnabled: true,
    commentsOpen: false,
    viewerReaction: null,
    channel: { name: "Ludo dojo", handle: "Ludo-dojo", avatarUrl: null },
    subscribed: false,
    onReact: vi.fn(),
    onToggleComments: vi.fn(),
    onShare: vi.fn(),
    onRemix: vi.fn(),
    onToggleSubscribe: vi.fn(),
    ...overrides,
  };
}

function captionOf(name: string): string {
  const item = document.querySelector(`[data-rail-item="${name}"]`);
  return item?.querySelector("[data-rail-label]")?.textContent ?? "";
}

describe("the rail's counts", () => {
  it("abbreviates the like count and does not abbreviate the comment count", () => {
    render(<ActionRail {...props()} />);
    // §11's own sample pair: «334K» beside «2,190». Same rail, two ladders.
    expect(captionOf("like")).toBe("1M");
    expect(captionOf("comments")).toBe("4,882");
  });

  it("keeps three significant digits out of the like count", () => {
    // `formatCompactCount` is the *view* ladder, two significant digits, so
    // 334,000 is `334K` and 1,240,000 is `1.2M` rather than the subscriber
    // ladder's `1.24M`.
    render(<ActionRail {...props({ likeCount: 1_240_000 })} />);
    expect(captionOf("like")).toBe("1.2M");
  });

  it("writes the word Like when nothing has been liked", () => {
    // `formatCompactCount` returns an empty string at zero, on purpose: a like
    // button with no likes shows the word.
    render(<ActionRail {...props({ likeCount: 0 })} />);
    expect(captionOf("like")).toBe("Like");
  });

  it("does not show a dislike count unless asked", () => {
    render(<ActionRail {...props()} />);
    expect(captionOf("dislike")).toBe("Dislike");
  });

  it("shows a dislike count when asked", () => {
    render(<ActionRail {...props({ showDislikeCount: true })} />);
    expect(captionOf("dislike")).toBe("3.4K");
  });

  it("puts the exact like figure in the accessible name", () => {
    render(<ActionRail {...props({ likeCount: 6_259 })} />);
    expect(
      screen.getByLabelText("like this video along with 6,259 other people"),
    ).toBeInTheDocument();
  });

  it("names the comment button with the count and its noun", () => {
    render(<ActionRail {...props()} />);
    expect(screen.getByLabelText("4,882 Comments")).toBeInTheDocument();
  });
});

describe("the rail's states", () => {
  it("marks the held reaction and only that one", () => {
    render(<ActionRail {...props({ viewerReaction: 1 })} />);
    expect(
      document.querySelector('[data-rail-item="like"] button'),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      document.querySelector('[data-rail-item="dislike"] button'),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("marks the comment button while the panel is open", () => {
    render(<ActionRail {...props({ commentsOpen: true })} />);
    expect(
      document.querySelector('[data-rail-item="comments"] button'),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("removes the comment button entirely when comments are off", () => {
    render(<ActionRail {...props({ commentsEnabled: false })} />);
    expect(document.querySelector('[data-rail-item="comments"]')).toBeNull();
    // The rest of the rail is unaffected — it is one item gone, not a
    // different rail.
    expect(document.querySelector('[data-rail-item="share"]')).not.toBeNull();
  });

  it("renders no kebab when no rows were supplied", () => {
    // The rail cannot invent the actions — Save, Report and "Not interested"
    // are other slices' writes — so the affordance appears only when a surface
    // hands it something to open. `video-card.tsx` makes the same call.
    render(<ActionRail {...props()} />);
    expect(document.querySelector('[data-rail-item="menu"]')).toBeNull();
  });

  it("renders the kebab, and opens it, when rows were supplied", async () => {
    render(<ActionRail {...props({ menuItems: <MenuItem>Report</MenuItem> })} />);

    const trigger = screen.getByLabelText("More actions for Avocado Clicker");
    expect(trigger).toBeInTheDocument();
    await userEvent.click(trigger);
    expect(screen.getByRole("menuitem", { name: "Report" })).toBeInTheDocument();
  });

  it("names the subscribe badge for the state it will move to", () => {
    const { rerender } = render(<ActionRail {...props()} />);
    expect(screen.getByLabelText("Subscribe to Ludo dojo")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    rerender(<ActionRail {...props({ subscribed: true })} />);
    expect(screen.getByLabelText("Unsubscribe from Ludo dojo")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("points the avatar at the channel, with the handle encoded", () => {
    render(
      <ActionRail
        {...props({
          channel: { name: "Ludo dojo", handle: "Ludo dojo", avatarUrl: null },
        })}
      />,
    );
    expect(document.querySelector("[data-rail-channel-link]")).toHaveAttribute(
      "href",
      "/@Ludo%20dojo",
    );
  });
});

describe("the rail's actions", () => {
  it("reports which reaction was pressed", async () => {
    const onReact = vi.fn();
    render(<ActionRail {...props({ onReact })} />);

    await userEvent.click(
      screen.getByLabelText("like this video along with 1,000,000 other people"),
    );
    await userEvent.click(screen.getByLabelText("Dislike this video"));

    expect(onReact.mock.calls).toEqual([[1], [-1]]);
  });

  it("wires comments, share and subscribe to their own callbacks", async () => {
    const onToggleComments = vi.fn();
    const onShare = vi.fn();
    const onToggleSubscribe = vi.fn();
    render(
      <ActionRail {...props({ onToggleComments, onShare, onToggleSubscribe })} />,
    );

    await userEvent.click(screen.getByLabelText("4,882 Comments"));
    await userEvent.click(screen.getByLabelText("Share Avocado Clicker"));
    await userEvent.click(screen.getByLabelText("Subscribe to Ludo dojo"));

    expect(onToggleComments).toHaveBeenCalledOnce();
    expect(onShare).toHaveBeenCalledOnce();
    expect(onToggleSubscribe).toHaveBeenCalledOnce();
  });

  it("renders Remix disabled, carrying the reason", async () => {
    // Remix is measured as one of §11's four rail buttons, so it renders — but
    // it opens the Shorts editor, which is a creation surface this application
    // does not have. It used to be pressable and bound to a `noop`, which is
    // the one option that teaches a visitor the app is broken rather than that
    // the feature is absent.
    const onRemix = vi.fn();
    render(<ActionRail {...props({ onRemix })} />);

    const remix = screen.getByLabelText("Remix Avocado Clicker");
    expect(remix).toBeDisabled();
    expect(remix).toHaveAttribute("title", expect.stringContaining("not part of this build"));

    await userEvent.click(remix);
    expect(onRemix).not.toHaveBeenCalled();
  });
});
