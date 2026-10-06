"use client";

/**
 * The identity sheet (SPEC §7, first row of the screen table).
 *
 * Shown on first arrival and re-openable from the Home settings affordance:
 * a generated `<Adjective> <Noun> <NN>` name prefilled and editable (2–20
 * characters), **nine colour swatches**, and `Continue`.
 *
 * The claim goes through the injected `IdentityPort` — the adapter POSTs
 * `/api/session` and falls back to a local identity when S5's route is not
 * there yet — and a `NameTakenError` (the 409) shows the three suggestions
 * inline as clickable chips.
 */
import { useMemo, useState } from "react";
import clsx from "clsx";

import { NameTakenError, PLAYER_COLOURS, generateName, isValidDisplayName } from "@/adapters/localStorage/identity";
import type { PlayerColour } from "@/engine/types";
import type { Identity, IdentityPort } from "@/ports/identity";

import { Pill } from "../ui/Pill";

export interface IdentitySheetProps {
  readonly identity: IdentityPort;
  readonly onDone: (identity: Identity) => void;
  /** Dismiss without claiming; absent when the sheet is the first arrival. */
  readonly onCancel?: () => void;
}

export function IdentitySheet({ identity, onDone, onCancel }: IdentitySheetProps) {
  const cached = useMemo(() => identity.readCached(), [identity]);
  const [name, setName] = useState(() => cached?.displayName ?? generateName());
  const [colour, setColour] = useState<PlayerColour>(cached?.colour ?? "red");
  const [suggestions, setSuggestions] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const valid = isValidDisplayName(name);

  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setFailure(null);
    setSuggestions([]);
    try {
      const claimed = await identity.claim(name.trim());
      const final = claimed.colour === colour ? claimed : await identity.setColour(colour);
      onDone(final);
    } catch (error) {
      if (error instanceof NameTakenError) {
        setSuggestions(error.suggestions);
        setFailure(error.message);
      } else {
        setFailure("Could not claim that name. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      data-testid="identity-sheet"
      role="dialog"
      aria-modal="true"
      aria-label="Choose your name and colour"
      className="fixed inset-0 flex items-center justify-center px-4"
      style={{ zIndex: "var(--z-modal)", background: "var(--scrim-heavy)" }}
    >
      <form
        className="flex w-full max-w-[520px] flex-col gap-5 p-6"
        onSubmit={(event) => { event.preventDefault(); void submit(); }}
        style={{
          background: "var(--chrome-800)",
          border: "2px solid var(--chrome-line)",
          borderRadius: "var(--r-panel)",
          boxShadow: "var(--sh-panel)",
        }}
      >
        <h2 className="on-board-text text-center" style={{ fontSize: "clamp(24px, 4vw, 38px)" }}>
          Who are you?
        </h2>

        <label className="flex flex-col gap-2 font-body" style={{ color: "var(--text-muted)" }}>
          Display name
          <input
            data-testid="identity-name"
            value={name}
            maxLength={20}
            autoComplete="off"
            onChange={(event) => { setName(event.target.value); setSuggestions([]); setFailure(null); }}
            className="w-full rounded-[10px] px-3 font-head font-bold outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            style={{
              height: 48,
              background: "var(--chrome-900)",
              border: "2px solid var(--chrome-line)",
              color: "var(--text)",
              fontSize: "clamp(18px, 2.6vw, 24px)",
            }}
          />
        </label>

        {!valid ? (
          <p data-testid="identity-error" className="font-body" style={{ color: "var(--danger)" }}>
            Pick a name of 2 to 20 characters.
          </p>
        ) : null}

        {failure && valid ? (
          <p data-testid="identity-failure" className="font-body" style={{ color: "var(--danger)" }}>
            {failure}
          </p>
        ) : null}

        {suggestions.length > 0 ? (
          <div data-testid="identity-suggestions" className="flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                data-testid={`identity-suggestion-${suggestion}`}
                onClick={() => { setName(suggestion); setSuggestions([]); setFailure(null); }}
                className="rounded-[var(--r-pill)] px-4 font-body outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                style={{
                  minHeight: 44,
                  background: "var(--chrome-700)",
                  border: "2px solid var(--chrome-line)",
                  color: "var(--text)",
                }}
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}

        <fieldset
          data-testid="identity-colours"
          className="flex flex-wrap justify-center gap-3 border-0 p-0"
          aria-label="Player colour"
        >
          {PLAYER_COLOURS.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={option === colour}
              aria-label={option}
              data-testid={`identity-colour-${option}`}
              data-selected={option === colour ? "true" : "false"}
              onClick={() => setColour(option)}
              className={clsx(
                "rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white/80",
                option === colour ? "scale-110" : "",
              )}
              style={{
                width: 44,
                height: 44,
                background: `var(--p-${option})`,
                border: `3px solid ${option === colour ? "var(--text)" : `var(--p-${option}-wall)`}`,
                transition: "transform 160ms ease-out",
              }}
            />
          ))}
        </fieldset>

        <div className="flex items-center justify-center gap-3">
          {onCancel ? (
            <button
              type="button"
              data-testid="identity-cancel"
              onClick={onCancel}
              className="rounded-[var(--r-pill)] px-4 font-body outline-none focus-visible:ring-2 focus-visible:ring-white/80"
              style={{ minHeight: 44, color: "var(--text-muted)", background: "transparent" }}
            >
              Cancel
            </button>
          ) : null}
          <Pill
            label="Continue"
            type="submit"
            testId="identity-continue"
            disabled={!valid || busy}
          />
        </div>
      </form>
    </div>
  );
}

export default IdentitySheet;
