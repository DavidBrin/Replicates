"use client";

/**
 * The page body: cover, icon, title, blocks, and the click-to-append dead zone.
 *
 * The column geometry comes from `layout.page`: a `contentWidth` text column
 * inside `horizontalPadding` gutters. The gutters are load-bearing rather than
 * decorative — every block's hover affordance is absolutely positioned into
 * them, so narrowing the padding would clip the drag handles.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { FaceSlightlySmiling, ImagePlus } from "lucide-react";

import { layout } from "@/config/app.config";
import type { Id } from "@/lib/model/types";
import { useWorkspaceStore } from "@/lib/store/workspace-store";
import { cn } from "@/lib/utils/cn";

import { BlockList } from "./BlockList";
import { EmojiPicker } from "./EmojiPicker";
import { BLOCK_ROW_STYLE } from "./blocks/shared";
import { adjacentEditable, focusBlock, placeCaretAtX } from "./focus-registry";

const TITLE_DEBOUNCE_MS = 150;

/** Notion's stock gradient covers, cycled by the "Change cover" control. */
const COVER_GRADIENTS = [
  "linear-gradient(120deg, #a1c4fd 0%, #c2e9fb 100%)",
  "linear-gradient(120deg, #f6d365 0%, #fda085 100%)",
  "linear-gradient(120deg, #d4fc79 0%, #96e6a1 100%)",
  "linear-gradient(120deg, #fbc2eb 0%, #a6c1ee 100%)",
  "linear-gradient(120deg, #e0c3fc 0%, #8ec5fc 100%)",
];

export interface PageEditorProps {
  pageId: Id;
}

export function PageEditor({ pageId }: PageEditorProps) {
  const page = useWorkspaceStore((state) => state.pages[pageId]);
  const title = page?.title ?? "";

  const titleRef = useRef<HTMLDivElement>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titlePending = useRef<string | null>(null);
  const titleComposing = useRef(false);
  const iconRef = useRef<HTMLButtonElement>(null);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);

  /* -- title: same uncontrolled contract as a block's Editable -- */

  const commitTitle = useCallback(
    (value: string) => {
      if (titleTimer.current) clearTimeout(titleTimer.current);
      titleTimer.current = null;
      titlePending.current = null;
      useWorkspaceStore.getState().renamePage(pageId, value);
    },
    [pageId],
  );

  useLayoutEffect(() => {
    const element = titleRef.current;
    if (!element) return;
    element.textContent = useWorkspaceStore.getState().pages[pageId]?.title ?? "";
  }, [pageId]);

  useEffect(() => {
    const element = titleRef.current;
    // Writing the title back while it has focus would collapse the caret.
    if (!element || document.activeElement === element) return;
    if (element.textContent === title) return;
    element.textContent = title;
  }, [title]);

  useEffect(
    () => () => {
      if (titleTimer.current) clearTimeout(titleTimer.current);
      if (titlePending.current !== null) {
        useWorkspaceStore.getState().renamePage(pageId, titlePending.current);
      }
    },
    [pageId],
  );

  const handleTitleInput = useCallback(() => {
    const element = titleRef.current;
    if (!element || titleComposing.current) return;
    const value = element.textContent ?? "";
    // A leftover `<br>` from deleting the last character would keep the
    // element out of `:empty` and hide the "Untitled" ghost.
    if (value === "" && element.innerHTML !== "") element.innerHTML = "";

    titlePending.current = value;
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => {
      if (titlePending.current !== null) commitTitle(titlePending.current);
    }, TITLE_DEBOUNCE_MS);
  }, [commitTitle]);

  /** Focuses the first block, creating one when the page is still empty. */
  const enterBody = useCallback(() => {
    const store = useWorkspaceStore.getState();
    const first = store.pages[pageId]?.blockIds[0];
    if (first) {
      focusBlock(first, "start");
      return;
    }
    focusBlock(store.insertBlock({ parentId: pageId }), "start");
  }, [pageId]);

  const handleTitleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (titleComposing.current || event.nativeEvent.isComposing) return;

      if (event.key === "Enter") {
        event.preventDefault();
        if (titlePending.current !== null) commitTitle(titlePending.current);
        enterBody();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "Tab") {
        const element = titleRef.current;
        if (!element) return;
        const next = adjacentEditable(element, 1);
        if (!next) return;
        event.preventDefault();
        if (titlePending.current !== null) commitTitle(titlePending.current);
        placeCaretAtX(next, element.getBoundingClientRect().left, "top");
      }
    },
    [commitTitle, enterBody],
  );

  /* -- cover / icon -- */

  const cycleCover = useCallback(() => {
    const store = useWorkspaceStore.getState();
    const current = store.pages[pageId]?.cover;
    const index =
      current?.type === "gradient" ? COVER_GRADIENTS.indexOf(current.gradient) : -1;
    store.setPageCover(pageId, {
      type: "gradient",
      gradient: COVER_GRADIENTS[(index + 1) % COVER_GRADIENTS.length],
    });
  }, [pageId]);

  /* -- click-to-append dead zone -- */

  const appendParagraph = useCallback(() => {
    const store = useWorkspaceStore.getState();
    const blockIds = store.pages[pageId]?.blockIds ?? [];
    const lastId = blockIds[blockIds.length - 1];
    const last = lastId ? store.blocks[lastId] : undefined;

    // Clicking below an already-empty trailing paragraph should land in it
    // rather than stack another one, which is what Notion does.
    if (last && last.type === "paragraph" && last.text === "" && last.childIds.length === 0) {
      focusBlock(lastId, "end");
      return;
    }
    focusBlock(store.insertBlock({ parentId: pageId }), "start");
  }, [pageId]);

  if (!page) return null;

  // Narrowed to the variants that actually paint, so the JSX below can read
  // `.gradient` / `.url` without re-checking the discriminant.
  const cover = page.cover.type === "none" ? null : page.cover;
  const hasIcon = page.icon.type !== "none";
  const horizontalPadding = page.fullWidth
    ? layout.page.fullWidthPadding
    : layout.page.horizontalPadding;

  const columnStyle: CSSProperties = {
    maxWidth: page.fullWidth
      ? undefined
      : layout.page.contentWidth + layout.page.horizontalPadding * 2,
    paddingLeft: horizontalPadding,
    paddingRight: horizontalPadding,
  };

  return (
    <div
      data-editor-root
      className="group/page relative w-full"
      // Drives every block's font size from one place, so a "small text" page
      // shrinks the whole body without each block knowing about the setting.
      style={{ "--editor-text": page.smallText ? "14px" : "16px" } as CSSProperties}
    >
      {cover ? (
        <div
          className="group/cover relative w-full"
          style={{
            height: `${layout.page.coverHeight}vh`,
            // Both cover kinds go through `backgroundImage`. Mixing the
            // `background` shorthand with a `backgroundImage` longhand in one
            // style object silently loses the image: React applies the
            // shorthand first, then assigning the longhand `undefined` clears
            // it again while leaving the shorthand's other resets in place.
            backgroundImage:
              cover.type === "gradient" ? cover.gradient : `url(${cover.url})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          <div
            className="absolute bottom-3 right-0 flex gap-1 opacity-0 transition-opacity duration-100 group-hover/cover:opacity-100"
            style={{ paddingRight: horizontalPadding }}
          >
            <CoverButton onClick={cycleCover}>Change cover</CoverButton>
            <CoverButton
              onClick={() => useWorkspaceStore.getState().setPageCover(pageId, { type: "none" })}
            >
              Remove
            </CoverButton>
          </div>
        </div>
      ) : null}

      <div className="mx-auto w-full" style={columnStyle}>
        {hasIcon ? (
          <div
            style={{
              marginTop: cover ? -layout.page.iconCoverOverlap : 24,
              marginBottom: 4,
            }}
          >
            <button
              ref={iconRef}
              type="button"
              aria-label="Change page icon"
              onClick={() => setIconPickerOpen((open) => !open)}
              className="flex items-center justify-center rounded-[8px] leading-none transition-colors duration-100 hover:bg-[var(--bac-int)]"
              style={{
                width: layout.page.iconSize,
                height: layout.page.iconSize,
                fontSize: layout.page.iconSize - 12,
              }}
            >
              {page.icon.type === "emoji" ? (
                page.icon.emoji
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={page.icon.type === "url" ? page.icon.url : ""}
                  alt=""
                  className="h-full w-full rounded-[8px] object-cover"
                />
              )}
            </button>
          </div>
        ) : null}

        {/* Add-icon / add-cover affordances only exist for the things the page
            does not already have, mirroring Notion's header controls. */}
        <div
          className={cn(
            "flex h-7 items-center gap-1 opacity-0 transition-opacity duration-100",
            "group-hover/page:opacity-100 focus-within:opacity-100",
            hasIcon && cover && "hidden",
          )}
          style={{ marginTop: hasIcon ? 0 : cover ? 24 : 40 }}
        >
          {!hasIcon ? (
            <HeaderButton
              ref={iconRef}
              icon={<FaceSlightlySmiling size={14} />}
              onClick={() => setIconPickerOpen(true)}
            >
              Add icon
            </HeaderButton>
          ) : null}
          {!cover ? (
            <HeaderButton icon={<ImagePlus size={14} />} onClick={cycleCover}>
              Add cover
            </HeaderButton>
          ) : null}
        </div>

        <h1>
          <div
            ref={titleRef}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            spellCheck
            data-editable="true"
            data-placeholder="Untitled"
            className="relative w-full break-words outline-hidden"
            style={{
              fontSize: 40,
              fontWeight: 700,
              lineHeight: 1.2,
              padding: "3px 2px",
              color: "var(--tex-pri)",
            }}
            onInput={handleTitleInput}
            onKeyDown={handleTitleKeyDown}
            onBlur={() => {
              if (titlePending.current !== null) commitTitle(titlePending.current);
            }}
            onCompositionStart={() => {
              titleComposing.current = true;
            }}
            onCompositionEnd={() => {
              titleComposing.current = false;
              handleTitleInput();
            }}
          />
        </h1>

        <div className="mt-1">
          {page.blockIds.length > 0 ? (
            <BlockList parentId={pageId} blockIds={page.blockIds} />
          ) : (
            <button
              type="button"
              onClick={appendParagraph}
              className="w-full text-left"
              style={{ ...BLOCK_ROW_STYLE, color: "var(--tex-ter)" }}
            >
              Type &#39;/&#39; for commands
            </button>
          )}
        </div>

        {/* Notion's dead zone: clicking the emptiness under the last block
            appends a paragraph, so a page never traps the caret. */}
        <div
          className="w-full cursor-text"
          style={{ minHeight: "30vh" }}
          onClick={appendParagraph}
        />
      </div>

      <EmojiPicker
        open={iconPickerOpen}
        onOpenChange={setIconPickerOpen}
        anchor={iconRef}
        onSelect={(emoji) =>
          useWorkspaceStore.getState().setPageIcon(pageId, { type: "emoji", emoji })
        }
        onRemove={
          hasIcon
            ? () => useWorkspaceStore.getState().setPageIcon(pageId, { type: "none" })
            : undefined
        }
      />
    </div>
  );
}

/* ----------------------------------------------------------------- chrome -- */

function CoverButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[4px] border px-2 py-1 text-xs font-medium shadow-xs transition-colors duration-100 hover:bg-[var(--bac-int)]"
      style={{
        background: "var(--bac-ele)",
        borderColor: "var(--bor-pri)",
        color: "var(--tex-sec)",
      }}
    >
      {children}
    </button>
  );
}

const HeaderButton = function HeaderButton({
  ref,
  icon,
  children,
  onClick,
}: {
  ref?: React.Ref<HTMLButtonElement>;
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-[4px] px-2 py-1 text-sm font-medium transition-colors duration-100 hover:bg-[var(--bac-int)]"
      style={{ color: "var(--tex-ter)" }}
    >
      {icon}
      {children}
    </button>
  );
};
