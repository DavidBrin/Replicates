"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { routes } from "@/config/app.config";
import { IconButton } from "@/components/primitives/Button";
import { cn } from "@/lib/utils/cn";
import { NAV_ITEMS, type NavItem } from "./copy";
import { Burger, CaretDown, NotionMark } from "./icons";

/**
 * The marketing navigation bar.
 *
 * Three columns — mark, centred links, actions — pinned at 64px. Two of the
 * centre links open a full-bleed mega-menu on hover *or* keyboard focus; see
 * `.mkt-mega` in marketing.css for the asymmetric open/close timing and the
 * invisible bridge that stops the panel flickering shut mid-traverse.
 */
export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [openPanel, setOpenPanel] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  /** Deferred close, so leaving the trigger towards the panel is forgiven. */
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The nav has no border at rest and grows a hairline once the page moves.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 0);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenPanel(null);
        setMobileOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const clearClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const open = useCallback(
    (label: string) => {
      clearClose();
      setOpenPanel(label);
    },
    [clearClose],
  );

  const scheduleClose = useCallback(() => {
    clearClose();
    closeTimer.current = setTimeout(() => setOpenPanel(null), 120);
  }, [clearClose]);

  useEffect(() => clearClose, [clearClose]);

  return (
    <nav
      className="mkt-nav"
      data-scrolled={scrolled}
      aria-label="Main"
      onMouseLeave={scheduleClose}
    >
      <div className="mkt-nav__inner">
        {/* -- mark ------------------------------------------------------- */}
        <Link
          href={routes.home}
          className="flex shrink-0 items-center rounded-[4px]"
          aria-label="Notion home"
        >
          <NotionMark size={34} />
        </Link>

        {/* -- centre links ----------------------------------------------- */}
        <ul className="mkt-nav__links">
          {NAV_ITEMS.map((item) => (
            <li key={item.label}>
              <NavEntry
                item={item}
                isOpen={openPanel === item.label}
                onOpen={() => open(item.label)}
                onClose={scheduleClose}
                onToggle={() =>
                  setOpenPanel((current) =>
                    current === item.label ? null : item.label,
                  )
                }
              />
            </li>
          ))}
        </ul>

        {/* -- actions ----------------------------------------------------- */}
        <div className="mkt-nav__actions">
          <Link href={routes.workspace} className="mkt-nav__login">
            Log in
          </Link>
          <Link href={routes.workspace} className="mkt-cta--dark">
            Get Notion free
          </Link>
          <IconButton
            label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            className="mkt-nav__burger"
            onClick={() => setMobileOpen((v) => !v)}
          >
            <Burger />
          </IconButton>
        </div>
      </div>

      {/* -- mega menus (one panel per trigger, kept mounted so the open and
             close transitions both run) ---------------------------------- */}
      {NAV_ITEMS.filter((item) => item.panel).map((item) => (
        <div
          key={item.label}
          id={`mega-${item.label.toLowerCase()}`}
          className="mkt-mega"
          data-open={openPanel === item.label}
          onMouseEnter={() => open(item.label)}
          onMouseLeave={scheduleClose}
        >
          <ul className="mkt-mega__grid">
            {item.panel?.map((leaf) => (
              <li key={leaf.label}>
                <Link
                  href={leaf.href}
                  className="mkt-mega__row"
                  tabIndex={openPanel === item.label ? undefined : -1}
                >
                  <span className="mkt-mega__row-label">{leaf.label}</span>
                  <span className="mkt-mega__row-desc">{leaf.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {/* -- small-screen disclosure -------------------------------------- */}
      {mobileOpen && (
        <div className="mkt-nav__mobile">
          <ul>
            {NAV_ITEMS.map((item) => (
              <li key={item.label}>
                {item.panel ? (
                  <>
                    <p className="mkt-mock__section-label">{item.label}</p>
                    <ul className="pb-2">
                      {item.panel.map((leaf) => (
                        <li key={leaf.label}>
                          <Link
                            href={leaf.href}
                            className="mkt-nav__link mkt-nav__link--block"
                            onClick={() => setMobileOpen(false)}
                          >
                            {leaf.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <Link
                    href={item.href ?? routes.home}
                    className="mkt-nav__link mkt-nav__link--block"
                    onClick={() => setMobileOpen(false)}
                  >
                    {item.label}
                  </Link>
                )}
              </li>
            ))}
            <li>
              <Link
                href={routes.workspace}
                className="mkt-nav__link mkt-nav__link--block"
                onClick={() => setMobileOpen(false)}
              >
                Log in
              </Link>
            </li>
          </ul>
        </div>
      )}
    </nav>
  );
}

/** A single centre-column entry: either a plain link or a panel trigger. */
function NavEntry({
  item,
  isOpen,
  onOpen,
  onClose,
  onToggle,
}: {
  item: NavItem;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  onToggle: () => void;
}) {
  if (!item.panel) {
    return (
      <Link
        href={item.href ?? routes.home}
        className="mkt-nav__link"
        onMouseEnter={onClose}
      >
        {item.label}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={cn("mkt-nav__link")}
      data-open={isOpen}
      aria-expanded={isOpen}
      aria-controls={`mega-${item.label.toLowerCase()}`}
      onMouseEnter={onOpen}
      onFocus={onOpen}
      onClick={onToggle}
    >
      {item.label}
      <CaretDown className="mkt-nav__caret" />
    </button>
  );
}
