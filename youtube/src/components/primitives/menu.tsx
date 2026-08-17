"use client";

import clsx from "clsx";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import { ChevronIcon } from "@/components/icons";

/**
 * The menu, built to the ARIA APG Menu Button pattern.
 *
 * `research/07-captions-and-a11y.md` §7.4 and §8.1 are the spec, and the two
 * rules that get broken most often in real implementations are both asserted
 * in `src/components/__tests__/primitives.test.tsx`:
 *
 * 1. **Roving tabindex, not a list of tab stops.** Exactly one item is
 *    `tabindex="0"` at a time — the first, or the checked one when the menu
 *    reopens — and every other item is `-1`. Arrow keys move the roving
 *    position *and* focus. Giving every item `tabindex="0"` is the single most
 *    common bug here: it floods the page's Tab sequence and breaks the "the
 *    whole menu is one tab stop" contract users rely on.
 * 2. **Escape closes and returns focus to the trigger.** Without the restore, a
 *    keyboard user is dropped back at the top of the document.
 *
 * The roving position is applied by writing `tabindex` onto the items the
 * menu finds in the DOM rather than by threading an index through context.
 * That is deliberate: DOM order *is* the traversal order the pattern
 * specifies, and deriving it from the rendered tree means a caller can wrap,
 * filter or conditionally render items without the indices silently going
 * wrong. Items render at `tabindex="-1"`, so React never fights the write.
 *
 * ## Geometry
 *
 * Measured off the account menu (`research/09-…` §10): `menu-background`
 * (#282828 dark, #ffffff light), 12px radius, rows a flat **40px** — there is
 * no 48px row anywhere in it — 14px/20px weight 400, a 24px icon at a 16px
 * inset and the label at 56px. Sections carry no border: the 8px of padding on
 * each is what reads as a divider, which {@link MenuSection} reproduces.
 *
 * The *player's* settings menu is a different component with its own metrics
 * (385×401 on `rgba(0,0,0,0.6)`, 48.13px rows, 11px/14.3px text — R8 §5.6).
 * It is not this menu wearing a modifier, and should not be built as one.
 *
 * ## What this deliberately does not do
 *
 * No portal and no collision detection: the popup is absolutely positioned
 * against a wrapper. Everywhere this menu is used in the measured product —
 * the masthead, the card kebab, a comment's overflow — the trigger is inside a
 * container that does not clip, and a flip-on-collision implementation without
 * a real surface to test it against would be guesswork. Typeahead is likewise
 * left out; the APG lists it as optional and no measured menu is long enough
 * to need it.
 */

const MENU_ITEM_SELECTOR =
  '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]';

interface MenuContextValue {
  readonly close: () => void;
}

const MenuContext = createContext<MenuContextValue | null>(null);

export interface MenuTriggerProps {
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  "aria-controls": string | undefined;
  onClick: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
}

export interface MenuProps {
  /**
   * Renders the control that opens the menu.
   *
   * A render prop rather than `cloneElement`: the trigger needs a ref and five
   * ARIA attributes, and cloning silently drops any of them the caller also
   * set. This way the caller can see exactly what it is being handed.
   */
  trigger: (props: MenuTriggerProps) => ReactNode;
  /** Names the popup for assistive technology. */
  label: string;
  /** Which edge of the trigger the popup aligns to. */
  align?: "start" | "end";
  /** Popup width. The account menu measures 300px; the default is its own content. */
  width?: number;
  className?: string;
  children: ReactNode;
}

export function Menu({
  trigger,
  label,
  align = "start",
  width,
  className,
  children,
}: MenuProps) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  /**
   * `null` means "not resolved yet".
   *
   * Where the roving position starts depends on the rendered items, and those
   * do not exist until the popup has painted — so opening records an *intent*
   * and the effect below turns it into an index once there is a DOM to look
   * at. Computing it in the click handler reads the previous render's items,
   * which is empty on first open and stale on every one after.
   */
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const pendingRef = useRef<"checked" | "first" | "last">("checked");
  const menuRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  /**
   * The trigger is found through the wrapper, not held in a ref of its own.
   *
   * `MenuTriggerProps` used to carry a `ref`, so the render prop handed a
   * callback ref out and the caller spread it onto their button. That is a
   * legitimate pattern and it is indistinguishable — to a reader and to
   * `react-hooks/refs` — from writing a ref during render, because `trigger`
   * genuinely *is* invoked while rendering. The rule was right that it could
   * not tell; suppressing it would have been asserting something no one could
   * check.
   *
   * The ref was only ever used to restore focus on close. The wrapper element
   * is already here, and the trigger is the one descendant carrying
   * `aria-haspopup="menu"` — an attribute this component sets itself, not one
   * the caller supplies — so the query is exact and the ref is redundant.
   */
  const focusTrigger = useCallback(() => {
    wrapperRef.current
      ?.querySelector<HTMLElement>('[aria-haspopup="menu"]')
      ?.focus();
  }, []);

  const items = useCallback((): HTMLElement[] => {
    const node = menuRef.current;
    if (!node) return [];
    return Array.from(node.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR));
  }, []);

  const close = useCallback(
    (restoreFocus = true) => {
      setOpen(false);
      setActiveIndex(null);
      if (restoreFocus) focusTrigger();
    },
    [focusTrigger],
  );

  /**
   * Opening lands on the checked item when there is one.
   *
   * The APG says "the first item, or the currently-selected item on reopen".
   * For a settings menu — quality, playback speed, appearance — starting on
   * row 0 means a keyboard user's first two presses are always corrections.
   */
  const openMenu = useCallback((from: "checked" | "first" | "last") => {
    pendingRef.current = from;
    setActiveIndex(null);
    setOpen(true);
  }, []);

  // Apply the roving position. Runs after every open and every move, and is
  // the only place `tabindex` is written.
  useEffect(() => {
    if (!open) return;
    const list = items();
    if (list.length === 0) return;

    if (activeIndex === null) {
      const checked = list.findIndex(
        (item) => item.getAttribute("aria-checked") === "true",
      );
      setActiveIndex(
        pendingRef.current === "last"
          ? list.length - 1
          : pendingRef.current === "checked" && checked >= 0
            ? checked
            : 0,
      );
      return;
    }

    const index = Math.min(activeIndex, list.length - 1);
    list.forEach((item, i) => {
      item.setAttribute("tabindex", i === index ? "0" : "-1");
    });
    list[index]?.focus();
  }, [open, activeIndex, items]);

  // Pointer-down rather than click: a click that starts inside the menu and
  // ends outside (a drag over a label) should not close it, and `mousedown`
  // outside is what the user means by "dismiss".
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const move = useCallback(
    (delta: number) => {
      const count = items().length;
      if (count === 0) return;
      setActiveIndex((current) => ((current ?? 0) + delta + count) % count);
    },
    [items],
  );

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(Math.max(items().length - 1, 0));
        break;
      case "Escape":
        event.preventDefault();
        close();
        break;
      case "Tab":
        // Tab leaves the menu entirely — the whole popup is one stop. Focus is
        // not restored to the trigger here, because the user asked to move on.
        close(false);
        break;
      default:
        break;
    }
  };

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    // Down and Up open the menu from the keyboard, landing on the first and
    // last item respectively — both are in the pattern, and Up is what makes a
    // long menu's last row reachable in one press.
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openMenu(event.key === "ArrowDown" ? "first" : "last");
    }
  };

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      {/*
        eslint-disable-next-line react-hooks/refs --
        A false positive that this component cannot restructure away, recorded
        rather than worked around.

        The rule sees a function that (transitively) reads a ref being passed
        into ``trigger``, which *is* called during render, and cannot prove the
        function is not called during render too. It is not: `onClick` is
        handed to React and invoked on user interaction, and the ref it reaches
        is read inside `close`, from an event handler.

        Two restructures were tried before settling here. Removing the ref from
        the trigger props — the popup's own wrapper is already in the tree, and
        the trigger is the one descendant carrying ``aria-haspopup="menu"``, so focus
        restoration can find it by query — is kept, because it takes a ref out
        of a public API. It does not silence the rule, because the handler
        still reads a ref. Replacing the render prop with `cloneElement` would,
        and this file's own comment explains why that is worse: cloning
        silently drops attributes the caller also set.

        The behaviour the rule is protecting is asserted directly in
        `src/components/__tests__/primitives.test.tsx` — Escape closes and
        focus returns to the trigger.
      */}
      {trigger({
        "aria-haspopup": "menu",
        "aria-expanded": open,
        "aria-controls": open ? menuId : undefined,
        onClick: () => (open ? close(false) : openMenu("checked")),
        onKeyDown: onTriggerKeyDown,
      })}
      {open ? (
        <div
          id={menuId}
          ref={menuRef}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          style={width ? { width } : undefined}
          className={clsx(
            "absolute top-full z-[var(--yt-z-popup)] mt-2 min-w-[200px]",
            align === "end" ? "right-0" : "left-0",
            "overflow-hidden rounded-cozy",
            "bg-menu py-2",
            // The dark theme separates the popup from the page by colour
            // (#282828 on #0f0f0f); the light theme cannot — every surface
            // token is #ffffff there — so the shadow is what carries it.
            "shadow-[var(--yt-menu-shadow)]",
            className,
          )}
        >
          <MenuContext.Provider value={{ close }}>
            {children}
          </MenuContext.Provider>
        </div>
      ) : null}
    </div>
  );
}

export interface MenuItemProps
  extends Omit<ComponentPropsWithoutRef<"div">, "onSelect" | "role"> {
  /**
   * `menuitem` commands; `menuitemradio` is a mutually-exclusive choice.
   * Quality, playback speed and the Appearance submenu are all radios, not
   * commands, and announcing them as commands loses the "this one is current"
   * information entirely.
   */
  role?: "menuitem" | "menuitemradio" | "menuitemcheckbox";
  checked?: boolean;
  icon?: ReactNode;
  /**
   * The value shown at the right of the row.
   *
   * Measured: rows whose label is a setting render as `Label: Value` in one
   * string ("Appearance: Device theme"), so this is a *second* rendering for
   * rows that show a value beside the label rather than inside it.
   */
  hint?: ReactNode;
  /** Renders a trailing chevron and the ARIA that says a submenu opens. */
  hasSubmenu?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  children: ReactNode;
}

export function MenuItem({
  role = "menuitem",
  checked,
  icon,
  hint,
  hasSubmenu = false,
  disabled = false,
  onSelect,
  className,
  children,
  ...rest
}: MenuItemProps) {
  const menu = useContext(MenuContext);

  const activate = (): void => {
    if (disabled) return;
    onSelect?.();
    // A radio row closes the menu the same way a command does — the measured
    // Appearance submenu applies and dismisses in one press.
    if (!hasSubmenu) menu?.close();
  };

  return (
    <div
      role={role}
      // The roving position overwrites this on the active row; -1 is the
      // resting value for every row, which is what keeps the popup one stop.
      tabIndex={-1}
      // A radio row with no `aria-checked` is announced as having no state at
      // all rather than as unchecked, so the fallback is `false` and not
      // `undefined`. Only a plain `menuitem` legitimately has none.
      aria-checked={role === "menuitem" ? undefined : (checked ?? false)}
      aria-disabled={disabled || undefined}
      aria-haspopup={hasSubmenu ? "menu" : undefined}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate();
        }
      }}
      className={clsx(
        "relative flex h-10 cursor-pointer items-center px-4",
        "text-body font-[var(--yt-weight-regular)]",
        "text-primary outline-none",
        // Same overlay model as everything else: no background swap on hover.
        "[--yt-fill-color:var(--yt-touch-response)] [--yt-fill-opacity:0]",
        "hover:[--yt-fill-opacity:var(--yt-state-hover-opacity)]",
        "focus-visible:[--yt-fill-opacity:var(--yt-state-hover-opacity)]",
        "active:[--yt-fill-opacity:var(--yt-state-press-opacity)]",
        disabled && "cursor-default text-disabled",
        className,
      )}
      {...rest}
    >
      {/* 24px glyph at the 16px inset, so the label starts at 56px. */}
      {icon ? (
        <span className="mr-4 inline-flex size-6 shrink-0 items-center justify-center">
          {icon}
        </span>
      ) : null}
      <span className="flex-1 truncate">{children}</span>
      {hint ? (
        <span className="ml-4 shrink-0 text-secondary">
          {hint}
        </span>
      ) : null}
      {hasSubmenu ? (
        <ChevronIcon direction="right" size={24} className="ml-2 shrink-0" />
      ) : null}
      <span
        aria-hidden="true"
        data-touch-fill=""
        className="pointer-events-none absolute inset-0 bg-[var(--yt-fill-color)]"
        style={{ opacity: "var(--yt-fill-opacity)" }}
      />
    </div>
  );
}

/**
 * A group of rows.
 *
 * `role="group"` rather than a separator element: the measured account menu
 * has **no visible border** between its five sections — the 8px of padding on
 * each is the whole divider — so drawing a rule here would be adding something
 * the product does not have.
 */
export function MenuSection({
  label,
  className,
  children,
  ...rest
}: ComponentPropsWithoutRef<"div"> & { label?: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={clsx("py-2", className)}
      {...rest}
    >
      {children}
    </div>
  );
}
