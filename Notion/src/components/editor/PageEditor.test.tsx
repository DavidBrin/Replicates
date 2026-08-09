import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { PageEditor } from "./PageEditor";
import { useWorkspaceStore } from "@/lib/store/workspace-store";
import { createDemoSnapshot, SEED_IDS } from "@/lib/seed/demo-workspace";

/**
 * Mounting tests for the page body.
 *
 * These exist because the unit suite was fully green while the page cover
 * rendered as blank space: the bug lived in how React serialises a style
 * object, which no amount of testing the store could reach. Anything whose
 * failure mode is "renders, but wrong" needs an actual render.
 */

const pageId = SEED_IDS.homePageId;

beforeEach(() => {
  useWorkspaceStore.setState({ ...createDemoSnapshot(), hydrated: true });
});

function coverElement(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[class*="group/cover"]');
}

describe("page cover", () => {
  it("paints a gradient cover", () => {
    const { container } = render(<PageEditor pageId={pageId} />);
    const cover = coverElement(container);

    expect(cover).not.toBeNull();
    // The regression: mixing the `background` shorthand with a
    // `backgroundImage` longhand in one style object leaves the element
    // sized but unpainted, because the undefined longhand clears the image
    // the shorthand just set.
    expect(cover!.style.backgroundImage).toContain("linear-gradient");
  });

  it("paints an image cover", () => {
    useWorkspaceStore
      .getState()
      .setPageCover(pageId, { type: "url", url: "https://example.test/cover.jpg" });

    const { container } = render(<PageEditor pageId={pageId} />);
    const cover = coverElement(container);

    expect(cover!.style.backgroundImage).toContain("example.test/cover.jpg");
    expect(cover!.style.backgroundImage).not.toContain("undefined");
  });

  it("renders no cover element at all when the page has none", () => {
    useWorkspaceStore.getState().setPageCover(pageId, { type: "none" });

    const { container } = render(<PageEditor pageId={pageId} />);

    expect(coverElement(container)).toBeNull();
    expect(screen.getByText("Add cover")).toBeInTheDocument();
  });
});

describe("page body", () => {
  it("renders the title and the seeded blocks", () => {
    render(<PageEditor pageId={pageId} />);

    expect(screen.getByText("Priority Tasks (only for unspecific URGENT)")).toBeInTheDocument();
    expect(screen.getByText(/Three rules, and everything else is negotiable/)).toBeInTheDocument();
  });

  it("gives the inline database the break-out class so a board is not squeezed", () => {
    // The board has five columns and the prose column is 708px. Notion lets an
    // inline database use the whole page; losing this class silently squashes
    // the board back into the text measure.
    const { container } = render(<PageEditor pageId={pageId} />);
    expect(container.querySelector(".notion-breakout")).not.toBeNull();
  });

  it("renders each block type without throwing", () => {
    // Walks every block type through the renderer registry. A type added to
    // the model but missing from the registry fails here rather than blanking
    // a page in production.
    const store = useWorkspaceStore.getState();
    const blank = store.createPage({ title: "Every block" });
    for (const type of [
      "paragraph",
      "heading_1",
      "heading_2",
      "heading_3",
      "bulleted_list_item",
      "numbered_list_item",
      "to_do",
      "toggle",
      "quote",
      "callout",
      "code",
      "divider",
      "image",
    ] as const) {
      store.insertBlock({ parentId: blank, type, text: `a ${type}` });
    }

    expect(() => render(<PageEditor pageId={blank} />)).not.toThrow();
    expect(screen.getByText("a heading_1")).toBeInTheDocument();
    expect(screen.getByText("a callout")).toBeInTheDocument();
  });

  it("renders nothing rather than crashing for a page that does not exist", () => {
    const { container } = render(<PageEditor pageId="page-does-not-exist" />);
    expect(container).toBeEmptyDOMElement();
  });
});
