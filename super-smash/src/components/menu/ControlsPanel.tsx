"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { ModeTab, ScreenBanner } from "@/components/ui/Panel";
import { SkewPanel, SkewTag } from "@/components/ui/SkewPanel";
import { cn } from "@/lib/cn";
import {
  ACTION_LABELS,
  CONTROL_ACTIONS,
  CONTROL_SCHEMES,
  SCHEME_INFO,
  keyLabel,
  overlappingKeys,
  portColour,
  portTag,
  useMatchConfig,
  type Bindings,
  type ControlAction,
  type SchemeId,
} from "@/lib/matchConfig";

/**
 * The colour an action gets wherever it appears — on the diagram, in the list,
 * and (eventually) on the in-game prompt. One table, so a key highlighted blue
 * on the keyboard is the same blue as the "Move" chip beside it.
 */
const ACTION_TONE: Record<ControlAction, string> = {
  left: "var(--p2)",
  right: "var(--p2)",
  up: "var(--p2)",
  down: "var(--p2)",
  jump: "var(--p4)",
  attack: "var(--p1)",
  special: "var(--smash-yellow)",
  shield: "#8f6fe6",
  grab: "#ef7c1a",
};

type KeyCap = readonly [code: string, units: number];

/**
 * Enough of an ANSI keyboard to place every binding in §6 on it.
 *
 * The function row and the numeric keypad are omitted because nothing binds
 * there and a laptop may not have them — the diagram is meant to be the
 * keyboard in front of the player, not a catalogue.
 */
const KEY_ROWS: readonly (readonly KeyCap[])[] = [
  [
    ["Backquote", 1],
    ["Digit1", 1],
    ["Digit2", 1],
    ["Digit3", 1],
    ["Digit4", 1],
    ["Digit5", 1],
    ["Digit6", 1],
    ["Digit7", 1],
    ["Digit8", 1],
    ["Digit9", 1],
    ["Digit0", 1],
    ["Minus", 1],
    ["Equal", 1],
    ["Backspace", 2],
  ],
  [
    ["Tab", 1.5],
    ["KeyQ", 1],
    ["KeyW", 1],
    ["KeyE", 1],
    ["KeyR", 1],
    ["KeyT", 1],
    ["KeyY", 1],
    ["KeyU", 1],
    ["KeyI", 1],
    ["KeyO", 1],
    ["KeyP", 1],
    ["BracketLeft", 1],
    ["BracketRight", 1],
    ["Backslash", 1.5],
  ],
  [
    ["CapsLock", 1.85],
    ["KeyA", 1],
    ["KeyS", 1],
    ["KeyD", 1],
    ["KeyF", 1],
    ["KeyG", 1],
    ["KeyH", 1],
    ["KeyJ", 1],
    ["KeyK", 1],
    ["KeyL", 1],
    ["Semicolon", 1],
    ["Quote", 1],
    ["Enter", 2.15],
  ],
  [
    ["ShiftLeft", 2.4],
    ["KeyZ", 1],
    ["KeyX", 1],
    ["KeyC", 1],
    ["KeyV", 1],
    ["KeyB", 1],
    ["KeyN", 1],
    ["KeyM", 1],
    ["Comma", 1],
    ["Period", 1],
    ["Slash", 1],
    ["ShiftRight", 2.6],
  ],
  [
    ["ControlLeft", 1.5],
    ["AltLeft", 1.25],
    ["Space", 7],
    ["AltRight", 1.25],
    ["ControlRight", 1.5],
  ],
];

export function ControlsPanel() {
  const router = useRouter();
  const players = useMatchConfig((s) => s.players);
  const bindings = useMatchConfig((s) => s.bindings);
  const setScheme = useMatchConfig((s) => s.setScheme);
  const rebind = useMatchConfig((s) => s.rebind);
  const resetBindings = useMatchConfig((s) => s.resetBindings);

  const [scheme, setSelectedScheme] = useState<SchemeId>("arrows");
  const [capturing, setCapturing] = useState<ControlAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const active = bindings[scheme];
  const owner = players.find((p) => p.kind === "human" && p.scheme === scheme) ?? null;

  /**
   * Capture on the window, in the capture phase.
   *
   * The player is holding a focused button when they start rebinding, so a
   * bubble-phase listener would let Space and Enter re-activate that button on
   * the way past. Taking the event before anything else sees it — and
   * cancelling it — is the only way "press the key you want" can mean any key.
   */
  useEffect(() => {
    if (!capturing) return;

    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setCapturing(null);
        setMessage("Rebinding cancelled.");
        return;
      }

      const result = rebind(scheme, capturing, event.code);
      setCapturing(null);
      if (result.ok) {
        setMessage(`${ACTION_LABELS[capturing]} is now ${keyLabel(event.code)}.`);
      } else {
        const port = result.conflictPort ?? 0;
        setMessage(
          `${keyLabel(event.code)} is already ${portTag(port)}'s ${
            result.conflictAction ? ACTION_LABELS[result.conflictAction] : "binding"
          }. A keydown does not say whose finger caused it, so the two cannot share it.`,
        );
      }
    };

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, rebind, scheme]);

  const mirrorOverlap = overlappingKeys(bindings.arrows, bindings.mirrored);
  const thirdOverlap = [
    ...overlappingKeys(bindings.rightCluster, bindings.arrows),
    ...overlappingKeys(bindings.rightCluster, bindings.mirrored),
  ];

  return (
    <main className="flex min-h-dvh flex-col bg-[#101215]">
      <ScreenBanner
        onBack={() => router.push("/menu")}
        backLabel="Back to the main menu"
        tab={<ModeTab label="Controls" caret={false} />}
      />

      <div className="mx-auto w-full max-w-6xl flex-1 px-5 pb-12 sm:px-8">
        {/* The mirror-image problem, stated plainly rather than discovered by
            two people who cannot work out why their fighters both jump. */}
        <SkewPanel
          className="border-[3px] border-panel-ink bg-[#181b20]"
          innerClassName="px-6 py-4"
        >
          <h2 className="font-display text-xl tracking-[0.1em] text-smash-yellow uppercase">
            Two configs, one player
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/70">
            Config 1 and Config 2 are reflections of each other, so{" "}
            <strong className="text-white">{mirrorOverlap.length} physical keys carry opposite meanings</strong>{" "}
            between them — {mirrorOverlap.map(keyLabel).join(", ")}. A <code>keydown</code> event does not say
            whose finger caused it, so they are alternative presets a single player chooses, not two players
            at once. For two people on one keyboard, use <strong className="text-white">Config 3</strong>, which
            shares {thirdOverlap.length === 0 ? "no key" : `${thirdOverlap.length} keys`} with either of them.
          </p>
        </SkewPanel>

        {/* Who is playing on what */}
        <section aria-label="Player control schemes" className="mt-5">
          <h2 className="mb-2 font-display text-lg tracking-[0.14em] text-white/70 uppercase">Ports</h2>
          <ul className="flex flex-wrap gap-3">
            {players.map((player) => (
              <li key={player.port}>
                <SkewPanel
                  className="border-[3px]"
                  style={{ borderColor: portColour(player.port), backgroundColor: "#181b20" }}
                  innerClassName="px-4 py-3"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="px-2 py-0.5 font-display text-sm leading-none text-panel-ink"
                      style={{ backgroundColor: portColour(player.port) }}
                    >
                      {portTag(player.port)}
                    </span>
                    <span className="text-xs font-bold text-white/60">
                      {player.kind === "cpu" ? "Computer — no keys" : "Human"}
                    </span>
                  </div>
                  {player.kind === "human" ? (
                    <div className="mt-2 flex gap-1">
                      {CONTROL_SCHEMES.map((id) => {
                        const takenByOther = players.some(
                          (p) => p.port !== player.port && p.kind === "human" && p.scheme === id,
                        );
                        return (
                          <button
                            key={id}
                            type="button"
                            aria-pressed={player.scheme === id}
                            disabled={takenByOther}
                            onClick={() => {
                              setScheme(player.port, id);
                              setSelectedScheme(id);
                            }}
                            className={cn(
                              "border-[2px] border-panel-ink px-2 py-1 text-[0.65rem] font-black tracking-wide uppercase",
                              player.scheme === id
                                ? "bg-smash-yellow text-panel-ink"
                                : takenByOther
                                  ? "cursor-not-allowed bg-[#26292f] text-white/20"
                                  : "bg-[#2a2d33] text-white/70",
                            )}
                          >
                            {SCHEME_INFO[id].name}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </SkewPanel>
              </li>
            ))}
          </ul>
        </section>

        {/* Scheme tabs */}
        <section aria-label="Control scheme" className="mt-6">
          <div role="tablist" aria-label="Control scheme" className="flex flex-wrap gap-2">
            {CONTROL_SCHEMES.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={scheme === id}
                onClick={() => {
                  setSelectedScheme(id);
                  setCapturing(null);
                  setMessage(null);
                }}
                className={cn(
                  "border-[3px] border-panel-ink px-5 py-2 font-display text-base tracking-[0.12em] uppercase",
                  scheme === id ? "bg-smash-yellow text-panel-ink" : "bg-[#2a2d33] text-white/70",
                )}
                style={{ transform: "skewX(-12deg)" }}
              >
                <span className="inline-block" style={{ transform: "skewX(12deg)" }}>
                  {SCHEME_INFO[id].name}
                </span>
              </button>
            ))}
            <SkewTag
              className="border-[3px] border-panel-ink bg-panel-ink"
              innerClassName="px-4 py-2 text-xs font-bold text-white/60"
            >
              {owner ? `In use by ${portTag(owner.port)}` : "Not assigned to a port"}
            </SkewTag>
          </div>

          <p className="mt-2 text-xs text-white/45">{SCHEME_INFO[scheme].hand}. {SCHEME_INFO[scheme].note}</p>
        </section>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_18rem]">
          <Keyboard bindings={active} />

          <section aria-label="Bindings">
            <ul className="flex flex-col gap-1.5">
              {CONTROL_ACTIONS.map((action) => (
                <li key={action}>
                  <button
                    type="button"
                    onClick={() => {
                      setMessage(null);
                      setCapturing(action);
                    }}
                    aria-label={`Rebind ${ACTION_LABELS[action]}, currently ${keyLabel(active[action])}`}
                    className={cn(
                      "flex w-full items-center gap-3 border-[3px] border-panel-ink bg-[#181b20] px-3 py-2 text-left transition-colors hover:bg-[#22262e]",
                      capturing === action && "bg-smash-yellow/20",
                    )}
                    style={{ transform: "skewX(-12deg)" }}
                  >
                    <span className="flex w-full items-center gap-3" style={{ transform: "skewX(12deg)" }}>
                      <span
                        className="size-3 shrink-0 border-2 border-panel-ink"
                        style={{ backgroundColor: ACTION_TONE[action] }}
                        aria-hidden
                      />
                      <span className="flex-1 font-display text-sm tracking-[0.1em] text-white uppercase">
                        {ACTION_LABELS[action]}
                      </span>
                      <span className="border-[2px] border-panel-ink bg-panel-bone px-2 py-0.5 font-display text-xs text-panel-ink">
                        {capturing === action ? "Press a key…" : keyLabel(active[action])}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={() => {
                resetBindings(scheme);
                setMessage(`${SCHEME_INFO[scheme].name} reset to its defaults.`);
              }}
              className="mt-3 w-full border-[3px] border-panel-ink bg-[#2a2d33] px-4 py-2 font-display text-sm tracking-[0.14em] text-white/75 uppercase hover:bg-[#383c44]"
              style={{ transform: "skewX(-12deg)" }}
            >
              <span className="inline-block" style={{ transform: "skewX(12deg)" }}>
                Reset {SCHEME_INFO[scheme].name}
              </span>
            </button>

            <p role="status" aria-live="polite" className="mt-3 min-h-[3rem] text-xs leading-snug text-white/60">
              {message}
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}

function Keyboard({ bindings }: { bindings: Bindings }) {
  const boundTo = new Map<string, ControlAction>();
  for (const action of CONTROL_ACTIONS) boundTo.set(bindings[action], action);

  return (
    <section aria-label="Keyboard diagram" className="overflow-x-auto">
      <SkewPanel
        className="min-w-[38rem] border-[3px] border-panel-ink bg-[#181b20]"
        innerClassName="flex flex-col gap-1.5 p-4"
      >
        {KEY_ROWS.map((row, i) => (
          <div key={i} className="flex gap-1.5">
            {row.map(([code, units]) => (
              <Key key={code} code={code} units={units} action={boundTo.get(code)} />
            ))}
          </div>
        ))}

        {/* The arrow cluster, drawn where it sits on the board: a lone up key
            over a row of three, offset to the right of the main block. */}
        <div className="mt-2 flex flex-col items-end gap-1.5 pr-1">
          <Key code="ArrowUp" units={1} action={boundTo.get("ArrowUp")} />
          <div className="flex gap-1.5">
            <Key code="ArrowLeft" units={1} action={boundTo.get("ArrowLeft")} />
            <Key code="ArrowDown" units={1} action={boundTo.get("ArrowDown")} />
            <Key code="ArrowRight" units={1} action={boundTo.get("ArrowRight")} />
          </div>
        </div>
      </SkewPanel>
    </section>
  );
}

const UNIT_REM = 2.5;

function Key({ code, units, action }: { code: string; units: number; action?: ControlAction }) {
  const bound = action !== undefined;
  return (
    <div
      data-key={code}
      data-bound={bound ? action : undefined}
      className={cn(
        "flex shrink-0 flex-col items-center justify-center rounded-[3px] border-[2px] border-panel-ink py-1 text-center",
        bound ? "text-panel-ink" : "bg-[#262a31] text-white/45",
      )}
      style={{
        width: `${units * UNIT_REM}rem`,
        height: `${UNIT_REM}rem`,
        backgroundColor: bound ? ACTION_TONE[action] : undefined,
      }}
    >
      <span className={cn("font-display leading-none", units > 1.4 ? "text-[0.6rem]" : "text-xs")}>
        {keyLabel(code)}
      </span>
      {bound ? (
        <span className="text-[0.5rem] leading-none font-black tracking-wide uppercase">
          {ACTION_LABELS[action]}
        </span>
      ) : null}
    </div>
  );
}
