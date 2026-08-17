import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { VideoInfo, type VideoInfoProps } from "../video-info";

/**
 * The watch metadata block.
 *
 * Almost every assertion here is a *string* rather than a layout, and that is
 * deliberate: `research/extracted/watch-layout-1920.json` `actionButtons`
 * carries the real accessible names, and they are the part a rebuild invents.
 * `like this video along with 6,259 other people` is not a phrasing anybody
 * would guess.
 */

function renderInfo(overrides: Partial<VideoInfoProps> = {}) {
  const onReact = vi.fn();
  const onToggleSubscribe = vi.fn();
  render(
    <VideoInfo
      videoId="v1"
      title="How It's Made: Noodles, Pasta, Mac & Cheese"
      channelName="Captain Discovery"
      channelHandle="captaindiscovery"
      subscriberCount={222_000}
      likeCount={6_259}
      viewerReaction={null}
      subscribed={false}
      onReact={onReact}
      onToggleSubscribe={onToggleSubscribe}
      {...overrides}
    />,
  );
  return { onReact, onToggleSubscribe };
}

describe("VideoInfo — the measured copy", () => {
  it("puts the title in an h1", () => {
    // §10.3: `ytd-watch-metadata > h1`, 20/28/700. One per page, and it is the
    // video's name — not the site's.
    renderInfo();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "How It's Made: Noodles, Pasta, Mac & Cheese",
      }),
    ).toBeInTheDocument();
  });

  it("carries the measured like label with the exact figure", () => {
    // Measured verbatim: `like this video along with 6,259 other people`. The
    // visible text is the abbreviated `6.2K`; the exact count lives only in the
    // accessible name (§8.1).
    renderInfo();
    const like = screen.getByRole("button", {
      name: "like this video along with 6,259 other people",
    });
    expect(like).toHaveTextContent("6.2K");
  });

  it("uses the three-digit subscriber ladder, not the view one", () => {
    // §8.1: `222K subscribers`. Under the *view* rule 1,240,000 would be
    // `1.2M`; under the subscriber rule it is `1.24M`. Two formatters, 200px
    // apart on this component.
    renderInfo({ subscriberCount: 1_240_000 });
    expect(screen.getByText("1.24M subscribers")).toBeInTheDocument();
  });

  it("names the dislike button without a count", () => {
    // Measured: `Dislike this video`, and the button carries no number —
    // YouTube shows no dislike count.
    renderInfo();
    const dislike = screen.getByRole("button", { name: "Dislike this video" });
    expect(dislike.textContent).toBe("");
  });

  it("uses the measured names for the remaining actions", () => {
    renderInfo();
    for (const name of ["Share", "Save to playlist", "More actions"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("omits Join when the channel offers no membership", () => {
    // §8.3: "Owner row: `Join` (membership, when offered) then `Subscribe`".
    renderInfo();
    expect(screen.queryByRole("button", { name: "Join this channel" })).toBeNull();
  });

  it("offers Join when it does", () => {
    renderInfo({ membershipsOffered: true });
    expect(screen.getByRole("button", { name: "Join this channel" })).toBeInTheDocument();
  });

  it("writes `Like` instead of a zero", () => {
    // `formatLikeCount` returns an empty string at zero, because a like button
    // with no likes shows the word and no number.
    renderInfo({ likeCount: 0 });
    expect(
      screen.getByRole("button", { name: /^like this video/ }),
    ).toHaveTextContent("Like");
  });
});

describe("VideoInfo — the segmented like/dislike pair", () => {
  it("squares off the joining edge on both halves", () => {
    // §3.4: like is `radius 20px 0 0 20px` and dislike `0 20px 20px 0`, with no
    // gap and no divider between them. It is one control that looks like one
    // control, and the `segment` prop on `Button` exists for this and nothing
    // else.
    renderInfo();
    const like = screen.getByRole("button", { name: /^like this video/ });
    const dislike = screen.getByRole("button", { name: "Dislike this video" });
    expect(like.className).toContain("rounded-r-none");
    expect(dislike.className).toContain("rounded-l-none");
  });

  it("reflects the viewer's own reaction as a pressed state", () => {
    renderInfo({ viewerReaction: 1 });
    expect(screen.getByRole("button", { name: /^like this video/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Dislike this video" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("reports which half was pressed", async () => {
    const user = userEvent.setup();
    const { onReact } = renderInfo();
    await user.click(screen.getByRole("button", { name: /^like this video/ }));
    expect(onReact).toHaveBeenCalledWith(1);
    await user.click(screen.getByRole("button", { name: "Dislike this video" }));
    expect(onReact).toHaveBeenCalledWith(-1);
  });
});

describe("VideoInfo — Subscribe, in both states", () => {
  it("is a filled button naming the channel, with the measured trailing period", () => {
    // Measured verbatim: `Subscribe to Captain Discovery.`
    renderInfo();
    const button = screen.getByRole("button", { name: "Subscribe to Captain Discovery." });
    expect(button).toHaveTextContent("Subscribe");
    // §1.2: the unsubscribed button is Filled Mono, whose overlay darkens
    // rather than lightens.
    expect(button.className).toContain("--yt-fill-color:var(--yt-touch-response-inverse)");
  });

  it("drops the words once subscribed", () => {
    // R9 §9.1: the subscribed state is `IconLeadingTrailingNoText` — a bell and
    // a chevron, 74×40, and no label. The accessible name still says what
    // pressing does.
    renderInfo({ subscribed: true });
    const button = screen.getByRole("button", {
      name: "Unsubscribe from Captain Discovery.",
    });
    expect(button.querySelector("[data-button-label]")).toBeNull();
    expect(button.querySelector('[data-button-icon="leading"]')).not.toBeNull();
    expect(button.querySelector('[data-button-icon="trailing"]')).not.toBeNull();
  });

  it("reports the press", async () => {
    const user = userEvent.setup();
    const { onToggleSubscribe } = renderInfo();
    await user.click(screen.getByRole("button", { name: /^Subscribe to/ }));
    expect(onToggleSubscribe).toHaveBeenCalledOnce();
  });
});
