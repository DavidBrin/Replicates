/**
 * Caret and focus plumbing for the block editor.
 *
 * A `contentEditable` block is *uncontrolled*: React seeds its text once and
 * then keeps its hands off, because assigning `textContent` while the element
 * has focus collapses the selection to the end of the node and the caret
 * visibly jumps. That trade means the caret can no longer be expressed as
 * React state, so every cross-block caret move (Enter split, Backspace merge,
 * arrow navigation, slash-menu conversion) goes through this module instead:
 * a module-level registry of live elements plus imperative caret helpers.
 */

/** blockId → the live contentEditable element currently rendering it. */
const editableElements = new Map<string, HTMLElement>();

export type CaretPosition = "start" | "end" | number;

/** Called by `Editable` on mount. Passing `null` unregisters. */
export function registerEditable(blockId: string, element: HTMLElement | null): void {
  if (element) editableElements.set(blockId, element);
  else editableElements.delete(blockId);
}

/**
 * Unregisters only if `element` is still the one on file. Guards the
 * mount/unmount race when a block id is remounted elsewhere in the tree
 * (indent, drag) before the old node's cleanup has run.
 */
export function unregisterEditable(blockId: string, element: HTMLElement): void {
  if (editableElements.get(blockId) === element) editableElements.delete(blockId);
}

export function getEditable(blockId: string): HTMLElement | undefined {
  return editableElements.get(blockId);
}

/* ------------------------------------------------------------------ caret -- */

/** Plain-text offset of the caret within `element`, counting across children. */
export function caretOffsetIn(element: HTMLElement): number {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return 0;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer)) return 0;

  const measured = range.cloneRange();
  measured.selectNodeContents(element);
  measured.setEnd(range.startContainer, range.startOffset);
  return measured.toString().length;
}

/** Resolves a plain-text offset to a (text node, offset) pair. */
function textPointAt(
  root: HTMLElement,
  offset: number,
): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let tail: { node: Text; offset: number } | null = null;

  let node = walker.nextNode() as Text | null;
  while (node) {
    const length = node.data.length;
    if (remaining <= length) return { node, offset: remaining };
    remaining -= length;
    tail = { node, offset: length };
    node = walker.nextNode() as Text | null;
  }
  return tail;
}

export function setCaret(element: HTMLElement, position: CaretPosition): void {
  const selection = window.getSelection();
  if (!selection) return;

  const length = element.textContent?.length ?? 0;
  const target =
    position === "start"
      ? 0
      : position === "end"
        ? length
        : Math.max(0, Math.min(position, length));

  const range = document.createRange();
  const point = textPointAt(element, target);
  if (point) range.setStart(point.node, point.offset);
  else range.selectNodeContents(element); // genuinely empty block
  range.collapse(true);

  selection.removeAllRanges();
  selection.addRange(range);
}

const FOCUS_RETRY_FRAMES = 5;

/**
 * Moves the caret into a block by id.
 *
 * Callers routinely ask for a block that was created microseconds ago by a
 * store mutation, so its element has not been committed yet. Rather than make
 * every call site deal with that, retry across a few frames.
 */
export function focusBlock(
  blockId: string,
  position: CaretPosition = "end",
  attempt = 0,
): void {
  const element = editableElements.get(blockId);
  if (element?.isConnected) {
    element.focus({ preventScroll: true });
    setCaret(element, position);
    element.scrollIntoView({ block: "nearest" });
    return;
  }
  if (attempt < FOCUS_RETRY_FRAMES && typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => focusBlock(blockId, position, attempt + 1));
  }
}

/* ------------------------------------------------------- spatial helpers -- */

/** Viewport rect of the caret, falling back to the element for empty blocks. */
export function caretRectIn(element: HTMLElement): DOMRect | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer)) return null;

  const rect = range.getBoundingClientRect();
  // A collapsed range inside an empty node measures 0×0 in every engine.
  if (rect.width === 0 && rect.height === 0) return element.getBoundingClientRect();
  return rect;
}

/**
 * Whether the caret sits on the first / last *visual* line of a wrapped block.
 * Arrow keys only leave the block from those edges; inside, the browser's own
 * line-walking is correct and must not be pre-empted.
 */
export function caretLineEdge(element: HTMLElement): { first: boolean; last: boolean } {
  const caret = caretRectIn(element);
  if (!caret) return { first: true, last: true };
  const box = element.getBoundingClientRect();
  const tolerance = Math.max(4, caret.height * 0.5);
  return {
    first: caret.top - box.top <= tolerance,
    last: box.bottom - caret.bottom <= tolerance,
  };
}

/**
 * The next/previous editable surface in document order.
 *
 * Deliberately a DOM query rather than a walk of the block tree: the DOM
 * already reflects collapsed toggles, nesting and the page title (which is not
 * a block at all), so it is the only ordering that matches what the user sees.
 */
export function adjacentEditable(
  element: HTMLElement,
  direction: -1 | 1,
): HTMLElement | null {
  const root: ParentNode = element.closest("[data-editor-root]") ?? document;
  const all = Array.from(root.querySelectorAll<HTMLElement>('[data-editable="true"]'));
  const index = all.indexOf(element);
  if (index === -1) return null;
  return all[index + direction] ?? null;
}

interface CaretPositionFromPoint {
  offsetNode: Node;
  offset: number;
}

function rangeFromPoint(x: number, y: number): Range | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => CaretPositionFromPoint | null;
  };
  if (typeof doc.caretRangeFromPoint === "function") return doc.caretRangeFromPoint(x, y);

  const position = doc.caretPositionFromPoint?.(x, y);
  if (!position) return null;
  const range = document.createRange();
  range.setStart(position.offsetNode, position.offset);
  range.collapse(true);
  return range;
}

/**
 * Focuses `element` and drops the caret at horizontal position `x` on either
 * its first or last line — what makes ArrowUp/ArrowDown across blocks feel
 * like moving through one continuous document instead of jumping to an edge.
 */
export function placeCaretAtX(
  element: HTMLElement,
  x: number,
  edge: "top" | "bottom",
): void {
  element.focus({ preventScroll: true });
  const box = element.getBoundingClientRect();
  const y = edge === "top" ? box.top + 6 : box.bottom - 6;

  const range = rangeFromPoint(x, y);
  if (range && element.contains(range.startContainer)) {
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  } else {
    setCaret(element, edge === "top" ? "start" : "end");
  }
  element.scrollIntoView({ block: "nearest" });
}
