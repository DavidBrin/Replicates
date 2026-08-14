"use client";

import type { ReactNode, RefObject } from "react";

import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Popover } from "@/components/ui/popover";

/**
 * A property picker, anchored to its trigger.
 *
 * Thin on purpose. The keyboard model, the fuzzy matching, the "opens on the
 * applied value" rule and the Escape ladder all live in `ui/combobox` and
 * `ui/popover`; this adds exactly two things they cannot know about:
 *
 * 1. **The `data-testid` the e2e contract names** (`status-picker`,
 *    `priority-picker`, …). `Combobox` takes no arbitrary DOM props — correctly,
 *    it is a controlled primitive — so the id goes on a wrapper *inside* the
 *    popover panel rather than on the panel itself. Playwright's
 *    `getByTestId("status-picker").getByTestId("picker-option-done")` reads the
 *    same either way.
 * 2. **`picker-option-{value}` on each row.** Same constraint: an option is a
 *    plain data object, so the id rides in the `icon` slot, wrapped in
 *    `display: contents` so it adds a node and not a box. Clicking it hits the
 *    row's handler by bubbling, which is what a test does.
 *
 * There is **no Save button and no dirty state** anywhere in this component,
 * and that is a product rule rather than an omission: `onSelect` fires the
 * mutation, the chip behind the popover updates before the panel finishes
 * closing, and `Escape` therefore closes without reverting.
 */

export interface PropertyPickerOption extends Omit<ComboboxOption, "icon"> {
  /** The status glyph, priority glyph, avatar or colour dot for this row. */
  glyph?: ReactNode;
  /**
   * The stable handle the e2e contract addresses this option by, when that
   * differs from `value`.
   *
   * `value` is whatever the mutation needs — usually a generated id such as
   * `sta_7Kd…`, which changes every time the database is rebuilt and is
   * therefore useless to a test. The suite asks for `picker-option-started`
   * (a state *type*) and `picker-option-guest@demo.test` (an email), so the
   * caller supplies the semantic token and the id stays where it belongs.
   */
  token?: string;
}

export interface PropertyPickerProps {
  /** The e2e contract's id for this picker, e.g. `status-picker`. */
  testId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: RefObject<HTMLElement | null>;
  options: readonly PropertyPickerOption[];
  value?: string | null;
  values?: readonly string[];
  multiple?: boolean;
  onSelect: (value: string, meta: { close: boolean }) => void;
  onCreate?: (query: string) => void;
  placeholder?: string;
  emptyMessage?: string;
  /** Accessible name for the listbox. */
  label: string;
  width?: number;
}

export function PropertyPicker({
  testId,
  open,
  onOpenChange,
  anchor,
  options,
  value,
  values,
  multiple,
  onSelect,
  onCreate,
  placeholder,
  emptyMessage,
  label,
  width = 240,
}: PropertyPickerProps) {
  const decorated: ComboboxOption[] = options.map(({ glyph, token, ...option }) => ({
    ...option,
    icon: (
      <span
        data-testid={`picker-option-${token ?? option.value}`}
        className="contents"
      >
        {glyph}
      </span>
    ),
  }));

  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      anchor={anchor}
      className="p-0"
      style={{ width }}
      aria-label={label}
    >
      <div data-testid={testId}>
        <Combobox
          options={decorated}
          value={value ?? null}
          values={values}
          multiple={multiple ?? false}
          onSelect={onSelect}
          onRequestClose={() => onOpenChange(false)}
          onCreate={onCreate}
          placeholder={placeholder}
          emptyMessage={emptyMessage}
          label={label}
        />
      </div>
    </Popover>
  );
}
