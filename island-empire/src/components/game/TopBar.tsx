"use client";

import { OUTLINE, STONE, UI } from "@/render/palette";

import { useSession } from "./SessionContext";
import { TOUCH_MIN, pixelInk, pixelText } from "./styles";

/** Gear top-left, "Level: N" / map name top-right, HELP! bubble beneath it. */
export function TopBar({ title }: { title: string }) {
  const session = useSession();
  return (
    <>
      <button
        type="button"
        data-testid="settings-button"
        aria-label="Settings"
        onClick={() => session.setModal("settings")}
        className="absolute left-2 top-2 z-10 flex items-center justify-center text-2xl"
        style={{ width: TOUCH_MIN + 4, height: TOUCH_MIN + 4, background: STONE.mid, border: `3px solid ${OUTLINE}`, borderRadius: 8, color: STONE.dark }}
      >
        <span aria-hidden style={{ color: OUTLINE }}>
          ⚙
        </span>
      </button>
      <div className="absolute right-2 top-2 z-10 flex flex-col items-end gap-1">
        <div data-testid="level-label" className="text-lg" style={pixelText}>
          {title}
        </div>
        <button
          type="button"
          data-testid="help-button"
          aria-label="Help: strength chart"
          onClick={() => session.setModal("help")}
          className="relative text-sm"
          style={{
            minHeight: TOUCH_MIN - 8,
            padding: "6px 12px",
            background: UI.cardCream,
            border: `3px solid ${OUTLINE}`,
            borderRadius: 10,
            ...pixelInk,
          }}
        >
          HELP!
          <span
            aria-hidden
            className="absolute -top-[9px] left-4 block h-0 w-0"
            style={{ borderLeft: "6px solid transparent", borderRight: "6px solid transparent", borderBottom: `9px solid ${OUTLINE}` }}
          />
        </button>
      </div>
    </>
  );
}
