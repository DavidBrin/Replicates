"use client";

/**
 * The editable text surface of a block, and the home of the editor's keyboard
 * grammar.
 *
 * Three rules govern everything in here:
 *
 * 1. **The DOM owns the text while the user is typing.** React seeds
 *    `textContent` once per block id and never writes it back while the
 *    element has focus. A controlled `contentEditable` re-creates its child
 *    text node on every keystroke, which collapses the selection to the end of
 *    the node — the caret jump every naive rich-text editor ships with. Store
 *    writes are therefore one-way (DOM → store), debounced, and flushed on
 *    blur and unmount.
 *
 * 2. **Composition is sacred.** Between `compositionstart` and
 *    `compositionend` an IME owns the DOM and the keystrokes. Committing to
 *    the store or interpreting a key mid-composition corrupts CJK input, so
 *    every handler returns early while `composingRef` is set.
 *
 * 3. **Structural edits are explicit.** Enter/Backspace/Tab never fall through
 *    to the browser's own contentEditable behaviour, which would splice `div`s
 *    and `br`s into a block that is supposed to hold one plain-text run.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";

import type { BlockType, Id } from "@/lib/model/types";
import { useWorkspaceStore, type WorkspaceState } from "@/lib/store/workspace-store";
import { cn } from "@/lib/utils/cn";

import {
  MARKDOWN_SHORTCUTS,
  applyBlockType,
  isListItem,
  isTextBlock,
} from "./block-types";
import {
  adjacentEditable,
  caretLineEdge,
  caretOffsetIn,
  caretRectIn,
  focusBlock,
  getEditable,
  placeCaretAtX,
  registerEditable,
  setCaret,
  unregisterEditable,
} from "./focus-registry";
import { SlashMenu } from "./SlashMenu";

// Re-exported so the rest of the editor imports the caret API from the
// component that owns it.
export {
  focusBlock,
  getEditable,
  setCaret,
  type CaretPosition,
} from "./focus-registry";

/** Long enough to coalesce a burst of typing, short enough to feel live. */
const COMMIT_DEBOUNCE_MS = 150;

export interface EditableProps {
  blockId: Id;
  className?: string;
  style?: CSSProperties;
  /** Overrides the type-derived ghost text. */
  placeholder?: string;
}

/* ------------------------------------------------------------- selectors -- */

/** The ordered sibling list a block belongs to, whatever its parent kind. */
function siblingIdsOf(state: WorkspaceState, parentId: Id): Id[] {
  return state.pages[parentId]?.blockIds ?? state.blocks[parentId]?.childIds ?? [];
}

/**
 * The block a Backspace-merge should join into: the last *visible* descendant
 * of the previous sibling, since that is the block whose text ends directly
 * above the caret on screen.
 */
function lastVisibleDescendant(state: WorkspaceState, blockId: Id): Id {
  let cursor = blockId;
  for (;;) {
    const block = state.blocks[cursor];
    if (!block || block.childIds.length === 0) return cursor;
    if (block.type === "toggle" && block.expanded === false) return cursor;
    cursor = block.childIds[block.childIds.length - 1];
  }
}

/**
 * Focus a block *after* React has committed the current mutation.
 *
 * Re-parenting (indent, outdent) unmounts the row and mounts a fresh one, so
 * focusing synchronously would land on the element that is about to be thrown
 * away. A frame's delay is enough: React flushes discrete events before paint.
 */
function focusAfterCommit(blockId: Id, position: number | "start" | "end"): void {
  requestAnimationFrame(() => focusBlock(blockId, position));
}

/**
 * Inserts a real newline character rather than letting the browser splice in a
 * `<br>`. `Block.text` is plain text read back off `textContent`, and a `<br>`
 * contributes nothing to `textContent` — the soft break would vanish on the
 * next remount. Rendering it needs `white-space: pre-wrap`, which the editable
 * always carries.
 */
function insertSoftBreak(): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const newline = document.createTextNode("\n");
  range.insertNode(newline);
  range.setStartAfter(newline);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function placeholderFor(type: BlockType, focused: boolean): string {
  if (type === "heading_1") return "Heading 1";
  if (type === "heading_2") return "Heading 2";
  if (type === "heading_3") return "Heading 3";
  if (type === "paragraph" && focused) return "Type '/' for commands";
  return "";
}

/* ----------------------------------------------------------- inline marks -- */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Inline marks go through `document.execCommand`.
 *
 * It is deprecated, but it is also the only API that applies a mark to an
 * arbitrary selection *and* participates in the browser's native undo stack.
 * The alternative is a full document model with its own selection mapping and
 * undo — the right call for a production editor, overkill here. The cost is
 * real and deliberate: `Block.text` is plain text, so marks live only in the
 * DOM and are lost when the block unmounts or the page reloads.
 */
function applyInlineMark(event: KeyboardEvent<HTMLDivElement>): boolean {
  const key = event.key.toLowerCase();

  if (event.shiftKey) {
    if (key === "s") {
      document.execCommand("strikeThrough");
      return true;
    }
    return false;
  }

  if (key === "b") return document.execCommand("bold");
  if (key === "i") return document.execCommand("italic");
  if (key === "u") return document.execCommand("underline");
  if (key === "e") {
    const selected = window.getSelection()?.toString() ?? "";
    if (!selected) return true;
    document.execCommand(
      "insertHTML",
      false,
      `<code style="font-family:var(--font-mono);font-size:0.85em;background:var(--bac-ter);` +
        `border-radius:3px;padding:0.2em 0.4em;color:var(--tag-red-fg)">${escapeHtml(selected)}</code>`,
    );
    return true;
  }
  return false;
}

/* ------------------------------------------------------------- component -- */

export function Editable({ blockId, className, style, placeholder }: EditableProps) {
  const ref = useRef<HTMLDivElement>(null);
  const text = useWorkspaceStore((state) => state.blocks[blockId]?.text ?? "");
  const type = useWorkspaceStore(
    (state) => state.blocks[blockId]?.type ?? ("paragraph" as BlockType),
  );

  const composingRef = useRef(false);
  const pendingRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Offset of the `/` that opened the slash menu, or null when it is closed. */
  const slashStartRef = useRef<number | null>(null);

  const [slash, setSlash] = useState<{ query: string; rect: DOMRect } | null>(null);
  const [focused, setFocused] = useState(false);

  /* -- store commits -- */

  const cancelPending = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    pendingRef.current = null;
  }, []);

  const commit = useCallback(
    (value: string) => {
      cancelPending();
      useWorkspaceStore.getState().updateBlockText(blockId, value);
    },
    [blockId, cancelPending],
  );

  const flush = useCallback(() => {
    if (pendingRef.current !== null) commit(pendingRef.current);
  }, [commit]);

  /* -- lifecycle -- */

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    // Seed once per block id. After this the DOM is authoritative until the
    // element loses focus (see the sync effect below).
    element.textContent = useWorkspaceStore.getState().blocks[blockId]?.text ?? "";
    registerEditable(blockId, element);
    return () => unregisterEditable(blockId, element);
  }, [blockId]);

  useEffect(() => {
    const element = ref.current;
    // The caret rule: an external text change (a Backspace merge appending to
    // this block, an undo, a remote edit) may only reach the DOM while the
    // element is unfocused.
    if (!element || document.activeElement === element) return;
    if (element.textContent === text) return;
    element.textContent = text;
  }, [text]);

  useEffect(
    () => () => {
      // Losing a keystroke because a block was deleted or re-parented before
      // the debounce fired would be silent data loss.
      if (timerRef.current) clearTimeout(timerRef.current);
      if (pendingRef.current !== null) {
        useWorkspaceStore.getState().updateBlockText(blockId, pendingRef.current);
      }
    },
    [blockId],
  );

  /* -- slash menu -- */

  const closeSlash = useCallback(() => {
    slashStartRef.current = null;
    setSlash(null);
  }, []);

  const syncSlashQuery = useCallback(
    (element: HTMLElement, value: string) => {
      const start = slashStartRef.current;
      if (start === null) return;
      const caret = caretOffsetIn(element);
      // The user deleted the slash, or moved the caret behind it.
      if (value[start] !== "/" || caret <= start) {
        closeSlash();
        return;
      }
      setSlash({
        query: value.slice(start + 1, caret),
        rect: caretRectIn(element) ?? element.getBoundingClientRect(),
      });
    },
    [closeSlash],
  );

  const handleSlashSelect = useCallback(
    (nextType: BlockType) => {
      const element = ref.current;
      const start = slashStartRef.current;
      if (!element || start === null) return;

      const value = element.textContent ?? "";
      const caret = Math.max(caretOffsetIn(element), start);
      const stripped = value.slice(0, start) + value.slice(caret);

      element.textContent = stripped;
      commit(stripped);
      closeSlash();

      applyBlockType(blockId, nextType);

      // Converting swaps in a different block component, so the element this
      // handler is holding is about to be discarded. Setting the caret on it
      // now would be undone by the remount — the caret has to be restored
      // after React commits, against whatever element replaces it.
      // A divider is not editable, so there is nothing to focus.
      if (nextType !== "divider") focusAfterCommit(blockId, start);
    },
    [blockId, closeSlash, commit],
  );

  /* -- input -- */

  const handleInput = useCallback(() => {
    const element = ref.current;
    if (!element || composingRef.current) return;

    const value = element.textContent ?? "";
    // Deleting the last character leaves a stray `<br>` behind in every
    // engine, which defeats the `:empty` placeholder rule in globals.css.
    if (value === "" && element.innerHTML !== "") {
      element.innerHTML = "";
      setCaret(element, 0);
    }

    pendingRef.current = value;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const queued = pendingRef.current;
      if (queued !== null) commit(queued);
    }, COMMIT_DEBOUNCE_MS);

    syncSlashQuery(element, value);
  }, [commit, syncSlashQuery]);

  const handlePaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      // Paste as plain text: pasted HTML would smuggle foreign markup and
      // styling into a block whose model is a single text run.
      event.preventDefault();
      const plain = event.clipboardData.getData("text/plain").replace(/\r\n/g, "\n");
      document.execCommand("insertText", false, plain);
      handleInput();
    },
    [handleInput],
  );

  /* -- keyboard grammar -- */

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const element = ref.current;
      if (!element) return;
      // Rule 2: never interpret a key the IME is still composing with.
      if (composingRef.current || event.nativeEvent.isComposing) return;

      const store = useWorkspaceStore.getState();
      const block = store.blocks[blockId];
      if (!block) return;

      if (event.metaKey || event.ctrlKey) {
        if (applyInlineMark(event)) {
          event.preventDefault();
          handleInput();
        }
        return;
      }

      const value = element.textContent ?? "";
      const offset = caretOffsetIn(element);
      const selection = window.getSelection();
      const collapsed = selection?.isCollapsed ?? true;

      /* ---- Enter: split, or exit the list ---- */
      if (event.key === "Enter") {
        // A code block is one multi-line run: Enter belongs to the snippet,
        // not to the document structure.
        if (event.shiftKey || block.type === "code") {
          event.preventDefault();
          insertSoftBreak();
          handleInput();
          return;
        }
        event.preventDefault();

        // Notion's "exit the list": Enter on an empty list item unwraps it
        // one level rather than creating another empty item.
        if (value === "" && isListItem(block.type)) {
          cancelPending();
          if (store.blocks[block.parentId]) store.outdentBlock(blockId);
          else store.convertBlock(blockId, "paragraph");
          focusAfterCommit(blockId, "start");
          return;
        }

        const before = value.slice(0, offset);
        const after = value.slice(offset);

        element.textContent = before;
        commit(before);

        const inherited = isListItem(block.type) ? block.type : "paragraph";
        const patch = inherited === "to_do" ? { checked: false } : undefined;
        const hasVisibleChildren =
          block.childIds.length > 0 &&
          !(block.type === "toggle" && block.expanded === false);

        let createdId: Id;
        if (hasVisibleChildren) {
          // The remainder belongs at the top of the subtree; appending it as a
          // sibling would fling the text past its own children.
          createdId = store.insertBlock({
            parentId: blockId,
            type: inherited,
            text: after,
            patch,
          });
          store.moveBlock(createdId, blockId, 0);
        } else {
          createdId = store.insertBlock({
            parentId: block.parentId,
            type: inherited,
            text: after,
            afterBlockId: blockId,
            patch,
          });
        }
        focusBlock(createdId, "start");
        return;
      }

      /* ---- Backspace at offset 0: merge upwards ---- */
      if (event.key === "Backspace") {
        if (!collapsed || offset > 0) return; // ordinary character delete
        event.preventDefault();

        const siblings = siblingIdsOf(store, block.parentId);
        const index = siblings.indexOf(blockId);
        const previousId = index > 0 ? siblings[index - 1] : null;

        // Deleting this block would take its whole subtree with it, so a
        // parent block unwraps instead of merging.
        const hasChildren = block.childIds.length > 0;

        if (!previousId || hasChildren) {
          if (store.blocks[block.parentId]) store.outdentBlock(blockId);
          else if (block.type !== "paragraph") store.convertBlock(blockId, "paragraph");
          focusAfterCommit(blockId, "start");
          return;
        }

        const targetId = lastVisibleDescendant(store, previousId);
        const target = store.blocks[targetId];
        if (!target) return;

        if (!isTextBlock(target.type)) {
          // A divider or image has no caret to merge into; Notion removes it.
          store.deleteBlock(targetId);
          focusBlock(blockId, "start");
          return;
        }

        cancelPending();
        const joinAt = target.text.length;
        const merged = target.text + value;
        const targetElement = getEditable(targetId);

        store.updateBlockText(targetId, merged);
        store.deleteBlock(blockId);
        // The target's own sync effect will refuse to write once we focus it
        // (that is the caret rule), and it has not run yet — so the merged
        // text has to be put into its DOM here, before the focus moves.
        if (targetElement) targetElement.textContent = merged;
        focusBlock(targetId, joinAt);
        return;
      }

      /* ---- Tab: indent / outdent ---- */
      if (event.key === "Tab") {
        event.preventDefault();
        flush();
        if (event.shiftKey) store.outdentBlock(blockId);
        else store.indentBlock(blockId);
        // Re-parenting remounts the row, so the caret has to be restored by id
        // once the new element exists.
        focusAfterCommit(blockId, offset);
        return;
      }

      /* ---- Arrows: leave the block only from its first/last visual line ---- */
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        if (!collapsed) return;
        const edge = caretLineEdge(element);
        const goingUp = event.key === "ArrowUp";
        if (goingUp ? !edge.first : !edge.last) return;

        const next = adjacentEditable(element, goingUp ? -1 : 1);
        if (!next) return;
        event.preventDefault();
        flush();
        const rect = caretRectIn(element);
        placeCaretAtX(
          next,
          rect?.left ?? element.getBoundingClientRect().left,
          goingUp ? "bottom" : "top",
        );
        return;
      }

      // Inside a code block every remaining key is literal text: markdown
      // prefixes and `/` are part of the snippet, not editor commands.
      if (block.type === "code") return;

      /* ---- Space: markdown shortcuts ---- */
      if (event.key === " " && collapsed) {
        const before = value.slice(0, offset);
        const shortcut = MARKDOWN_SHORTCUTS.find((entry) => entry.pattern.test(before));
        if (shortcut) {
          event.preventDefault();
          const rest = value.slice(offset);
          element.textContent = rest;
          commit(rest);
          applyBlockType(blockId, shortcut.type);
          return;
        }
      }

      /* ---- Slash: open the command palette ---- */
      if (event.key === "/" && collapsed && slashStartRef.current === null) {
        const before = value.slice(0, offset);
        if (before === "" || /\s$/.test(before)) {
          slashStartRef.current = offset;
          // Opened next frame so the "/" is in the DOM and the caret rect the
          // menu anchors to is the one after the character, not before it.
          requestAnimationFrame(() => {
            const current = ref.current;
            if (!current || slashStartRef.current === null) return;
            setSlash({
              query: "",
              rect: caretRectIn(current) ?? current.getBoundingClientRect(),
            });
          });
        }
      }
    },
    [blockId, cancelPending, commit, flush, handleInput],
  );

  const ghost = placeholder ?? placeholderFor(type, focused);

  return (
    <>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        spellCheck
        data-editable="true"
        data-block-id={blockId}
        data-placeholder={ghost}
        className={cn(
          // `relative` anchors the absolutely-positioned placeholder pseudo
          // element defined in globals.css.
          "relative w-full min-w-px whitespace-pre-wrap break-words outline-hidden",
          className,
        )}
        style={style}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          flush();
          closeSlash();
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          handleInput();
        }}
      />
      {slash ? (
        <SlashMenu
          query={slash.query}
          anchorRect={slash.rect}
          onSelect={handleSlashSelect}
          onClose={closeSlash}
        />
      ) : null}
    </>
  );
}
