"use client";

import clsx from "clsx";
import { useState, type FormEvent, type ReactNode } from "react";

import {
  AccountIcon,
  BellIcon,
  MenuIcon,
  MicIcon,
  MoreVerticalIcon,
  PlayBadgeIcon,
  PlusIcon,
  SearchIcon,
} from "@/components/icons";
import {
  Avatar,
  Button,
  ButtonLink,
  Menu,
  MenuItem,
  MenuSection,
} from "@/components/primitives";
import { THEME_LABELS, THEME_PREFERENCES, useTheme } from "@/components/theme";

/**
 * The masthead.
 *
 * **56px at every measured viewport width**, from 1920 down to 360 — it is the
 * one piece of chrome that never changes size (R8 §3.1). `padding: 0 16px`,
 * and three flex children whose measured x-positions come out symmetric
 * (`#start` ends at 185, `#center` starts at 566, ends at 1298, `#end` starts
 * at 1679 and ends at 1904 = 1920 − 16): equal 381px gaps on both sides, which
 * is `justify-content: space-between` with three items and not a centred
 * absolute overlay.
 *
 * | slot | measured | contents |
 * |---|---|---|
 * | `#start` | 169×56 at x=16 | 40×40 guide toggle, then the 129×56 logo |
 * | `#center` | 732×40 at y=8 | 640 search lockup + 12px + 40×40 voice button |
 * | `#end` | 225×40 | logged out: kebab + Sign in. Signed in: Create, bell, avatar |
 *
 * The masthead's own background measures *transparent* — it is fixed over
 * `ytd-app`, which is the thing painting `base-background`. Because this one
 * is `position: fixed` over a scrolling column, it has to paint the same token
 * itself or the content scrolls through it.
 */

export interface MastheadProps {
  signedIn?: boolean;
  /** Toggles the guide. The shell owns which of the three states that means. */
  onToggleGuide?: () => void;
  /** Controlled query, for the search results page. */
  query?: string;
  onSubmitQuery?: (query: string) => void;
  /** Signed-in only. Supplies the 32px account avatar. */
  account?: { readonly name: string; readonly avatarUrl?: string | null };
  className?: string;
}

/**
 * The logo lockup.
 *
 * The measured slot is 129×56 with a 93×20 SVG inside it, and the mark is
 * **drawn here rather than reproduced** — see `src/components/icons.tsx`. What
 * is kept from the measurement is the lockup: a red play badge followed by the
 * product name at display weight, sitting in a 129px slot with the mark
 * starting 16px in.
 *
 * The badge is `--yt-static-brand-red` (#f03, not #ff0000 — R8 §0) and the
 * name takes `--yt-wordmark-text`, which is one of the few tokens that is a
 * flat #fff/#000 pair rather than a near-black.
 */
function Logo() {
  return (
    <a
      href="/"
      aria-label="YouTube Home"
      className="flex h-14 w-[129px] shrink-0 items-center pl-4"
    >
      <PlayBadgeIcon
        size={28}
        className="text-[var(--yt-static-brand-red)]"
        // The badge is 28×20 rather than square; `size` drives the height and
        // the viewBox supplies the ratio.
        style={{ width: 39, height: 28 }}
      />
      <span className="ml-1 text-[20px] leading-[20px] font-[var(--yt-weight-bold)] tracking-[-0.5px] text-[var(--yt-wordmark-text)]">
        YouTube
      </span>
    </a>
  );
}

/**
 * The search lockup.
 *
 * Three measured pieces and one measured behaviour:
 *
 * * The field is 536×40 with `border-radius: 40px 0 0 40px` and a 1px
 *   hairline, and it is the only control in the chrome with an inner shadow.
 * * The submit button is 64×40 with the mirrored radius, its own hairline, and
 *   a *lighter* fill than the field.
 * * **On focus the field grows 32px to the left; the right edge does not
 *   move.** 536 → 568 at x 642 → 610 (R8 §9). That is reproduced here as a
 *   32px left inset on the form that collapses on `:focus-within`, which gets
 *   the geometry right without measuring anything at runtime.
 * * The focused field also gains `padding-left: 48px` — a search glyph slides
 *   into the left inset. The border goes to `rgb(28,98,185)`, which is a
 *   Google blue rather than the theme's own `call-to-action`.
 */
function SearchBox({
  query,
  onSubmitQuery,
}: {
  query?: string;
  onSubmitQuery?: (query: string) => void;
}) {
  const [value, setValue] = useState(query ?? "");

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onSubmitQuery?.(value);
  };

  return (
    <form
      role="search"
      onSubmit={submit}
      className="flex h-10 flex-1 items-center pl-8 focus-within:pl-0"
    >
      <div
        className={clsx(
          "group relative flex h-10 flex-1 items-center",
          "rounded-l-[40px] border border-[var(--yt-search-border)]",
          "bg-[var(--yt-search-background)] pr-1 pl-4",
          "shadow-[var(--yt-search-inner-shadow)]",
          "focus-within:border-[var(--yt-search-border-focus)] focus-within:pl-12",
        )}
      >
        {/* Hidden until the field takes focus, when the 32px the form gives
            back becomes the glyph's inset. `group-focus-within` rather than a
            `peer` variant: the glyph precedes the input in the DOM, and peer
            variants only reach forwards. */}
        <SearchIcon
          size={24}
          className="absolute left-4 hidden text-primary group-focus-within:block"
        />
        <input
          type="search"
          name="search_query"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          // Measured placeholder, verbatim. The field has no visible label, so
          // the placeholder is not the accessible name — `aria-label` is.
          placeholder="Search"
          aria-label="Search"
          autoComplete="off"
          className={clsx(
            "h-[22px] w-full bg-transparent text-title",
            "text-primary outline-none",
            "placeholder:text-secondary",
            // Chrome paints its own clear affordance on `type=search`, which
            // the product does not have and which cannot be styled.
            "[&::-webkit-search-cancel-button]:appearance-none",
          )}
        />
      </div>
      <button
        type="submit"
        aria-label="Search"
        className={clsx(
          "relative flex h-10 w-16 shrink-0 items-center justify-center",
          "rounded-r-[40px] border border-l-0 border-[var(--yt-search-border)]",
          "bg-[var(--yt-search-button-background)]",
          "hover:bg-[var(--yt-search-button-background-hover)]",
          "text-primary",
        )}
      >
        <SearchIcon size={24} />
      </button>
    </form>
  );
}

/**
 * The settings kebab.
 *
 * Its contents were never opened during the capture, so only one thing here is
 * measured: the three Appearance labels, which R9 §10 records verbatim as
 * "Device theme", "Dark theme", "Light theme" behind a row that renders as
 * `Appearance: <value>`. They are `menuitemradio` rather than `menuitem`
 * because they are a mutually-exclusive choice — announcing them as commands
 * loses the "this one is current" information entirely
 * (`research/07-captions-and-a11y.md` §7.4).
 *
 * This is also the app's theme switch. A one-button toggle exists in
 * `theme.tsx` for surfaces that want one, but the product puts the choice in a
 * menu, with the third `device` option visible — and a three-way cycle behind
 * a single icon gives the user no way to tell which mode they are in.
 */
function SettingsMenu() {
  const { preference, setPreference } = useTheme();

  return (
    <Menu
      label="Settings"
      align="end"
      width={300}
      trigger={(props) => (
        <Button
          {...props}
          variant="text"
          size="m"
          iconOnly
          aria-label="Settings"
        >
          <MoreVerticalIcon size={24} />
        </Button>
      )}
    >
      <MenuSection label="Appearance">
        {THEME_PREFERENCES.map((option) => (
          <MenuItem
            key={option}
            role="menuitemradio"
            checked={preference === option}
            onSelect={() => setPreference(option)}
          >
            {THEME_LABELS[option]}
          </MenuItem>
        ))}
      </MenuSection>
    </Menu>
  );
}

/**
 * The right cluster.
 *
 * Logged out it is a kebab and one outline Sign in button — 98.62×40 with a
 * 20px radius and 15px of padding, `Outline CallToAction SizeM IconLeading`.
 * Signed in the whole group changes: a tonal Create button with a leading
 * plus, a 40×40 notifications button, and a 32px avatar in a 54×34 hit box
 * whose padding is asymmetric (`1px 0 1px 6px` — measured). None of it exists
 * in the logged-out DOM, which is why the two branches share nothing.
 */
function EndCluster({
  signedIn,
  account,
}: {
  signedIn: boolean;
  account: MastheadProps["account"];
}): ReactNode {
  if (!signedIn) {
    return (
      <>
        <SettingsMenu />
        <ButtonLink
          href="/signin"
          variant="outline"
          palette="callToAction"
          size="m"
          className="ml-2"
          leading={<AccountIcon size={24} />}
        >
          Sign in
        </ButtonLink>
      </>
    );
  }

  return (
    <>
      <Button
        variant="tonal"
        size="m"
        className="mr-2"
        leading={<PlusIcon size={24} />}
      >
        Create
      </Button>
      <Button variant="text" size="m" iconOnly aria-label="Notifications">
        <BellIcon size={24} />
      </Button>
      <Menu
        label="Account"
        align="end"
        width={300}
        trigger={(props) => (
          <button
            {...props}
            type="button"
            aria-label="Account menu"
            className="ml-2 inline-flex h-[34px] items-center py-px pl-1.5"
          >
            <Avatar
              size="compact"
              name={account?.name ?? "Account"}
              src={account?.avatarUrl ?? null}
              decorative={false}
            />
          </button>
        )}
      >
        <MenuSection>
          <MenuItem>Your channel</MenuItem>
          <MenuItem>YouTube Studio</MenuItem>
          <MenuItem>Sign out</MenuItem>
        </MenuSection>
      </Menu>
    </>
  );
}

export function Masthead({
  signedIn = false,
  onToggleGuide,
  query,
  onSubmitQuery,
  account,
  className,
}: MastheadProps) {
  return (
    <header
      className={clsx(
        "fixed inset-x-0 top-0 z-[var(--yt-z-masthead)] flex h-14 items-center",
        "bg-base px-4",
        className,
      )}
    >
      {/*
        "Skip navigation" is the masthead's first DOM text in the real product
        (measured, `home-1920.json` `masthead.text`), so this is the shipped
        affordance rather than an addition. WCAG 2.4.1.
      */}
      <a href="#content" className="yt-skip-link">
        Skip navigation
      </a>

      <div className="flex shrink-0 items-center">
        <Button
          variant="text"
          size="m"
          iconOnly
          aria-label="Guide"
          onClick={onToggleGuide}
        >
          <MenuIcon size={24} />
        </Button>
        <Logo />
      </div>

      {/*
        `flex: 0 1 732px` — it shrinks but never grows past 732, which is what
        keeps the search field from stretching across a 2560px display.
      */}
      <div className="mx-auto flex h-10 w-full max-w-[732px] shrink items-center">
        <SearchBox query={query} onSubmitQuery={onSubmitQuery} />
        <Button
          variant="tonal"
          size="m"
          iconOnly
          aria-label="Search with your voice"
          className="ml-3"
        >
          <MicIcon size={24} />
        </Button>
      </div>

      <div className="flex min-w-[225px] shrink-0 items-center justify-end">
        <EndCluster signedIn={signedIn} account={account} />
      </div>
    </header>
  );
}
