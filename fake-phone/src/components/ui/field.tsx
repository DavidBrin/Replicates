"use client";

/**
 * Label + control + hint, with the accessibility wiring done once.
 *
 * The control is a render prop rather than plain children so that the ids can
 * only ever be correct: `Field` mints them, the control receives them, and
 * there is no way to write a label that points at nothing. Getting this wrong
 * silently is the normal outcome of hand-wiring `htmlFor` in eight places.
 *
 * `control="group"` switches the label from a real `<label>` to a plain span,
 * for controls that are a group of buttons rather than a native input — a
 * `<label for>` pointing at a `role="radiogroup"` div labels nothing, so those
 * controls take `aria-labelledby` instead.
 */

import { useId, type ReactNode } from "react";

export interface FieldControlProps {
  /** Put on a native control; the field's `<label>` points here. */
  readonly id: string;
  /** Put on `aria-labelledby` when the control is not a native input. */
  readonly labelId: string;
  /** Put on `aria-describedby`; undefined when the field has no hint. */
  readonly describedBy: string | undefined;
}

export interface FieldProps {
  readonly label: string;
  readonly hint?: ReactNode;
  /** Native inputs get a real `<label for>`; button groups get a span + id. */
  readonly control?: "native" | "group";
  readonly children: (props: FieldControlProps) => ReactNode;
}

export function Field({ label, hint, control = "native", children }: FieldProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  const describedBy = hint ? hintId : undefined;

  return (
    <div className="flex flex-col gap-2">
      {control === "native" ? (
        <label
          id={labelId}
          htmlFor={id}
          className="text-[13px] font-medium text-text-primary"
        >
          {label}
        </label>
      ) : (
        <span id={labelId} className="text-[13px] font-medium text-text-primary">
          {label}
        </span>
      )}

      {children({ id, labelId, describedBy })}

      {hint ? (
        <p id={hintId} className="text-[12px] leading-snug text-text-secondary">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
