"use client";

/**
 * Small composite controls the toolbar and property menus reuse.
 *
 * These wrap the `Popover` primitive with the anchor-ref bookkeeping it needs,
 * so callers get a single self-contained widget instead of four pieces of
 * state each time.
 */

import { useCallback, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Popover } from "@/components/primitives/Popover";
import { MenuItem, MenuList } from "@/components/primitives/Menu";
import { cn } from "@/lib/utils/cn";

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

export interface DropdownProps<T extends string> {
  value: T | undefined;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  className?: string;
  width?: number;
  /** Report open/close to a parent popover — see `useNestedPopoverGuard`. */
  onOpenChange?: (open: boolean) => void;
}

/**
 * Keeps a popover open while one of its own dropdowns is open.
 *
 * `Popover` dismisses on any pointerdown outside its panel, and a nested
 * dropdown portals its menu to `document.body` — so picking an option in the
 * nested menu would otherwise tear down the panel that contains it. Both
 * dismiss handlers are capture-phase listeners on `document` and fire in
 * registration order, meaning the *outer* one runs first and still sees the
 * nested menu as open. That is exactly the moment to veto the close.
 */
export function useNestedPopoverGuard() {
  const openCount = useRef(0);

  const onNestedOpenChange = useCallback((open: boolean) => {
    openCount.current = Math.max(0, openCount.current + (open ? 1 : -1));
  }, []);

  /** Wraps a popover's `onOpenChange` so a nested menu suppresses the close. */
  const guardClose = useCallback(
    (close: () => void) => (open: boolean) => {
      if (open) return;
      if (openCount.current > 0) return;
      close();
    },
    [],
  );

  return { onNestedOpenChange, guardClose };
}

/**
 * A Notion-styled replacement for `<select>`.
 *
 * A native select cannot carry the coloured pills and type icons the filter,
 * sort and group-by rows need, and it renders with the OS chrome, which breaks
 * the illusion immediately.
 */
export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  placeholder = "Select…",
  className,
  width,
  onOpenChange,
}: DropdownProps<T>) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  const setOpenState = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpenState(!open)}
        style={{ background: "var(--bac-int)", color: "var(--tex-pri)" }}
        className={cn(
          "flex h-7 min-w-0 items-center gap-1 rounded-[4px] px-2 text-sm",
          "transition-colors duration-100 outline-hidden hover:bg-[var(--bac-int-strong)]",
          className,
        )}
      >
        {selected?.icon}
        <span
          className="min-w-0 flex-1 truncate text-left"
          style={{ color: selected ? "var(--tex-pri)" : "var(--tex-ter)" }}
        >
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown size={12} style={{ color: "var(--ico-sec)" }} />
      </button>

      <Popover open={open} onOpenChange={setOpenState} anchor={anchor} width={width ?? 200}>
        <MenuList className="max-h-72 overflow-y-auto">
          {options.map((option) => (
            <MenuItem
              key={option.value}
              icon={option.icon}
              selected={option.value === value}
              onSelect={() => {
                onChange(option.value);
                setOpenState(false);
              }}
            >
              {option.label}
            </MenuItem>
          ))}
        </MenuList>
      </Popover>
    </>
  );
}

/** Bare text input styled to match the popover surfaces. */
export function TextField({
  value,
  onChange,
  placeholder,
  autoFocus,
  onSubmit,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onSubmit?: () => void;
  className?: string;
}) {
  return (
    <input
      value={value}
      autoFocus={autoFocus}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onSubmit?.();
        }
      }}
      style={{ background: "var(--bac-int)", color: "var(--tex-pri)" }}
      className={cn(
        "h-7 w-full rounded-[4px] px-2 text-sm outline-hidden",
        "placeholder:text-[var(--tex-ter)]",
        "focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]",
        className,
      )}
    />
  );
}

/** Row of a settings popover: a label on the left, a control on the right. */
export function SettingRow({
  label,
  icon,
  children,
  onClick,
}: {
  label: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  onClick?: () => void;
}) {
  const content = (
    <>
      {icon ? (
        <span className="flex h-4 w-4 items-center justify-center" style={{ color: "var(--ico-sec)" }}>
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {children}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-2 px-3 py-[6px] text-sm transition-colors duration-75 hover:bg-[var(--bac-int)]"
        style={{ color: "var(--tex-pri)" }}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className="flex w-full items-center gap-2 px-3 py-[6px] text-sm"
      style={{ color: "var(--tex-pri)" }}
    >
      {content}
    </div>
  );
}

/** iOS-style switch used for the boolean options in the view-settings popover. */
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      style={{ background: checked ? "var(--accent)" : "var(--bor-str)" }}
      className="relative h-[14px] w-[26px] shrink-0 rounded-full transition-colors duration-150 outline-hidden"
    >
      <span
        className="absolute top-[2px] h-[10px] w-[10px] rounded-full bg-white transition-[left] duration-150"
        style={{ left: checked ? 14 : 2 }}
      />
    </button>
  );
}
