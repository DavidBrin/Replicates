import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PageEditor } from "./PageEditor";
import { useWorkspaceStore } from "@/lib/store/workspace-store";
import { createDemoSnapshot } from "@/lib/seed/demo-workspace";

/**
 * Editing behaviour, exercised through a real mount.
 *
 * The caret rules in `Editable` cannot be verified any other way: they are all
 * about the ordering of DOM writes against React's commit, so a test that
 * calls the store directly proves nothing about them.
 */

let pageId: string;
let blockId: string;

beforeEach(() => {
  useWorkspaceStore.setState({ ...createDemoSnapshot(), hydrated: true });
  const store = useWorkspaceStore.getState();
  pageId = store.createPage({ title: "Editing" });
  blockId = store.insertBlock({ parentId: pageId, text: "" });
});

/**
 * The editable *is* the block element, not a descendant of it. Selecting the
 * first `[contenteditable]` on the page instead would silently return the page
 * title, and every assertion below would test the wrong element.
 */
/** Puts a collapsed caret at `offset` characters into an editable. */
function placeCaret(element: HTMLElement, offset: number): void {
  const node = element.firstChild ?? element.appendChild(document.createTextNode(""));
  const range = document.createRange();
  range.setStart(node, Math.min(offset, node.textContent?.length ?? 0));
  range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

const blockEditable = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>(
    `[data-block-id="${blockId}"][contenteditable]`,
  );
  if (!el) throw new Error(`no editable found for block ${blockId}`);
  return el;
};

describe("typing", () => {
  it("writes what you type back to the store", async () => {
    const user = userEvent.setup();
    render(<PageEditor pageId={pageId} />);

    const editable = blockEditable();
    await user.click(editable);
    await user.type(editable, "hello world");

    await waitFor(() => {
      expect(useWorkspaceStore.getState().blocks[blockId].text).toBe("hello world");
    });
  });
});

describe("markdown shortcuts", () => {
  it.each([
    ["# ", "heading_1"],
    ["## ", "heading_2"],
    ["- ", "bulleted_list_item"],
    ["1. ", "numbered_list_item"],
    ["> ", "quote"],
  ])("converts %s into a %s", async (prefix, expected) => {
    const user = userEvent.setup();
    render(<PageEditor pageId={pageId} />);

    const editable = blockEditable();
    await user.click(editable);
    await user.type(editable, prefix);

    await waitFor(() => {
      expect(useWorkspaceStore.getState().blocks[blockId].type).toBe(expected);
    });
    // The prefix is consumed, not left in the text.
    expect(useWorkspaceStore.getState().blocks[blockId].text).toBe("");
  });
});

describe("the slash menu", () => {
  it("opens on / and filters as you type", async () => {
    const user = userEvent.setup();
    render(<PageEditor pageId={pageId} />);

    const editable = blockEditable();
    await user.click(editable);
    await user.type(editable, "/");

    expect(await screen.findByText("Heading 1")).toBeInTheDocument();

    await user.type(editable, "quo");
    await waitFor(() => {
      expect(screen.queryByText("Heading 1")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Quote")).toBeInTheDocument();
  });

  it("converts the block and strips the query text", async () => {
    const user = userEvent.setup();
    render(<PageEditor pageId={pageId} />);

    const editable = blockEditable();
    await user.click(editable);
    await user.type(editable, "/callout");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(useWorkspaceStore.getState().blocks[blockId].type).toBe("callout");
    });
    expect(useWorkspaceStore.getState().blocks[blockId].text).toBe("");
  });

  it("leaves the caret in the converted block, ready to type", async () => {
    // The regression: the caret was restored *before* the conversion, and
    // converting swaps in a different component — so focus landed on an
    // element that was about to be unmounted and the user's next keystroke
    // went nowhere.
    const user = userEvent.setup();
    render(<PageEditor pageId={pageId} />);

    await user.click(blockEditable());
    await user.type(blockEditable(), "/quote");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(useWorkspaceStore.getState().blocks[blockId].type).toBe("quote");
    });

    await waitFor(() => {
      const active = document.activeElement as HTMLElement | null;
      expect(active?.isContentEditable, "no editable is focused after converting").toBe(true);
      expect(active?.closest(`[data-block-id="${blockId}"]`)).not.toBeNull();
    });

    // And the next keystroke actually lands in that block.
    await user.keyboard("typed after converting");
    await waitFor(() => {
      expect(useWorkspaceStore.getState().blocks[blockId].text).toBe("typed after converting");
    });
  });

  it("closes on Escape without converting", async () => {
    const user = userEvent.setup();
    render(<PageEditor pageId={pageId} />);

    const editable = blockEditable();
    await user.click(editable);
    await user.type(editable, "/");
    expect(await screen.findByText("Heading 1")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByText("Heading 1")).not.toBeInTheDocument();
    });
    expect(useWorkspaceStore.getState().blocks[blockId].type).toBe("paragraph");
  });
});

describe("structural keys", () => {
  const topLevelIds = () => useWorkspaceStore.getState().pages[pageId].blockIds;

  /**
   * Enter, Tab and Backspace all re-parent or remount a row, and the caret is
   * restored a frame later so it lands on the element React actually
   * committed. Tests have to wait for that frame before typing again —
   * otherwise the next keystroke races the focus move and lands in the old
   * block, which is what a real user never manages to do.
   */
  const caretSettled = () =>
    waitFor(() =>
      expect((document.activeElement as HTMLElement | null)?.isContentEditable).toBe(true),
    );

  it("Enter splits the text at the caret", async () => {
    // The caret is placed with the Selection API rather than by typing and
    // trusting the position, because jsdom does not restore a caret across a
    // remount the way a browser does. What is under test is the split itself.
    const store = useWorkspaceStore.getState();
    store.updateBlockText(blockId, "firstsecond");

    const user = userEvent.setup();
    render(<PageEditor pageId={pageId} />);

    await user.click(blockEditable());
    placeCaret(blockEditable(), "first".length);
    await user.keyboard("{Enter}");

    await waitFor(() => expect(topLevelIds()).toHaveLength(2));
    const [firstId, secondId] = topLevelIds();
    expect(useWorkspaceStore.getState().blocks[firstId].text).toBe("first");
    expect(useWorkspaceStore.getState().blocks[secondId].text).toBe("second");
  });

  it("Enter carries the list type onto the new block", async () => {
    const store = useWorkspaceStore.getState();
    store.convertBlock(blockId, "bulleted_list_item");
    store.updateBlockText(blockId, "one");

    const user = userEvent.setup();
    render(<PageEditor pageId={pageId} />);

    await user.click(blockEditable());
    placeCaret(blockEditable(), "one".length);
    await user.keyboard("{Enter}");

    await waitFor(() => expect(topLevelIds()).toHaveLength(2));
    const [, secondId] = topLevelIds();
    expect(useWorkspaceStore.getState().blocks[secondId].type).toBe("bulleted_list_item");
  });

  it("Enter on an empty list item leaves the list instead of extending it", async () => {
    const store = useWorkspaceStore.getState();
    store.convertBlock(blockId, "bulleted_list_item");

    const user = userEvent.setup();
    render(<PageEditor pageId={pageId} />);

    await user.click(blockEditable());
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(useWorkspaceStore.getState().blocks[blockId].type).toBe("paragraph");
    });
    expect(topLevelIds()).toHaveLength(1);
  });

  it("Tab nests a block under the one above it", async () => {
    const user = userEvent.setup();
    render(<PageEditor pageId={pageId} />);

    await user.click(blockEditable());
    await user.type(blockEditable(), "parent");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(topLevelIds()).toHaveLength(2));
    await caretSettled();

    await user.keyboard("child");
    await user.keyboard("{Tab}");

    await waitFor(() => {
      const store = useWorkspaceStore.getState();
      expect(topLevelIds()).toHaveLength(1);
      expect(store.blocks[topLevelIds()[0]].childIds).toHaveLength(1);
    });
  });

  it("Shift+Tab lifts a nested block back out", async () => {
    const store = useWorkspaceStore.getState();
    const parent = store.insertBlock({ parentId: pageId, text: "parent" });
    const child = store.insertBlock({ parentId: parent, text: "child" });

    const user = userEvent.setup();
    render(<PageEditor pageId={pageId} />);

    const childEditable = document.querySelector<HTMLElement>(
      `[data-block-id="${child}"][contenteditable]`,
    )!;
    await user.click(childEditable);
    await user.keyboard("{Shift>}{Tab}{/Shift}");

    await waitFor(() => {
      expect(useWorkspaceStore.getState().blocks[child].parentId).toBe(pageId);
      expect(useWorkspaceStore.getState().blocks[parent].childIds).toHaveLength(0);
    });
  });
});
