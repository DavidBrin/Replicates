"use client";

/**
 * Picks a contact photo (or a live-mode avatar) and stores it downscaled.
 *
 * Caller ID realism — a name *and* a photo — is table stakes in every serious
 * competitor and matters more to believability than the voice does
 * (research/competitive-teardown.md §4 Q1). It is also the single heaviest
 * thing this app persists, so the file never reaches settings at full size;
 * see `image-downscale.ts` for why 512px.
 */

import clsx from "clsx";
import Image from "next/image";
import { useRef, useState } from "react";

import { fileToDownscaledDataUrl } from "./image-downscale";

export interface PhotoPickerProps {
  readonly id: string;
  readonly labelId: string;
  readonly describedBy?: string;
  /** A data URL, or "" for none. */
  readonly value: string;
  readonly onValueChange: (dataUrl: string) => void;
  /** Shown in the empty slot: the caller's or streamer's initial. */
  readonly monogram?: string;
  readonly testId?: string;
}

export function PhotoPicker({
  id,
  labelId,
  describedBy,
  value,
  onValueChange,
  monogram,
  testId,
}: PhotoPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errorId = `${id}-error`;

  async function handleFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      onValueChange(await fileToDownscaledDataUrl(file));
    } catch {
      // Never throw out of a settings control. The rest of the configuration
      // stays usable and the user simply picks a different picture.
      setError("That picture could not be used. Try another one.");
    } finally {
      setBusy(false);
      // Let the same file be picked again after a failure; without this the
      // input's value is unchanged and `change` never fires a second time.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-hairline bg-surface-2 text-lg text-text-secondary"
      >
        {value ? (
          // `unoptimized`: the source is a data URL the user just produced, so
          // there is nothing for the image optimiser to fetch or cache.
          <Image src={value} alt="" fill sizes="56px" unoptimized className="object-cover" />
        ) : (
          (monogram ?? "").slice(0, 1).toUpperCase()
        )}
      </span>

      <label
        htmlFor={id}
        className={clsx(
          "inline-flex min-h-11 cursor-pointer items-center rounded-xl border border-hairline bg-surface-2 px-4 text-[14px] text-text-primary",
          busy && "opacity-60",
        )}
      >
        {busy ? "Resizing…" : value ? "Change photo" : "Add a photo"}
      </label>

      {value ? (
        <button
          type="button"
          onClick={() => onValueChange("")}
          data-testid={testId ? `${testId}-clear` : undefined}
          className="min-h-11 rounded-xl px-3 text-[14px] text-text-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Remove
        </button>
      ) : null}

      <input
        ref={inputRef}
        id={id}
        type="file"
        accept="image/*"
        // The visible label above is the hit target; this stays in the layout
        // (not `display:none`) so it remains focusable and screen-reader
        // reachable.
        className="sr-only"
        aria-labelledby={labelId}
        aria-describedby={[describedBy, error ? errorId : null].filter(Boolean).join(" ") || undefined}
        data-testid={testId}
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />

      {error ? (
        <p id={errorId} role="status" className="text-[12px] text-text-secondary">
          {error}
        </p>
      ) : null}
    </div>
  );
}
