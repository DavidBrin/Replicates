"use client";

import type { Difficulty, PlayerColour } from "@/engine/types";

import { COLOUR_HEX, colourDisplayName } from "./colours";

export interface SeatRowProps {
  /** 0-based seat index; `data-testid`s are 1-based (`seat-1-kind`, ...). */
  index: number;
  colour: PlayerColour;
  kind: "human" | "ai";
  onKindChange: (kind: "human" | "ai") => void;
  aiDifficulty: Difficulty;
  onDifficultyChange: (difficulty: Difficulty) => void;
  /** Editable display name (hot-seat only); ignored unless `showName`. */
  name?: string;
  onNameChange?: (name: string) => void;
  /** Show the editable name field instead of a static colour label. */
  showName?: boolean;
}

const DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard"];

/** One seat's colour swatch, human/AI toggle, name and difficulty controls. */
export function SeatRow({
  index,
  colour,
  kind,
  onKindChange,
  aiDifficulty,
  onDifficultyChange,
  name,
  onNameChange,
  showName = false,
}: SeatRowProps) {
  const seatNumber = index + 1;
  const displayName = colourDisplayName(colour);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border-2 border-[#E3C798] bg-[#F1E2B2] p-2 text-[#1A1010]">
      <span
        aria-hidden="true"
        title={`${displayName} seat`}
        className="h-6 w-6 flex-none rounded-sm border-2 border-[#1A1010]"
        style={{ backgroundColor: COLOUR_HEX[colour] }}
      />

      {showName ? (
        <input
          data-testid={`seat-${seatNumber}-name`}
          aria-label={`Seat ${seatNumber} name`}
          className="min-h-11 min-w-0 flex-1 rounded border-2 border-[#E3C798] bg-white px-2 py-1 text-sm"
          value={name ?? displayName}
          onChange={(event) => onNameChange?.(event.target.value)}
          maxLength={20}
        />
      ) : (
        <span className="flex-1 text-sm font-bold">{displayName}</span>
      )}

      <button
        type="button"
        data-testid={`seat-${seatNumber}-kind`}
        aria-label={`Seat ${seatNumber} kind`}
        onClick={() => onKindChange(kind === "human" ? "ai" : "human")}
        className="min-h-11 min-w-11 rounded border-2 border-[#1A1010] px-3 text-xs font-bold uppercase text-white"
        style={{ backgroundColor: kind === "human" ? "#228F00" : "#3D4FC4" }}
      >
        {kind === "human" ? "Human" : "AI"}
      </button>

      {kind === "ai" ? (
        <select
          data-testid={`seat-${seatNumber}-difficulty`}
          aria-label={`Seat ${seatNumber} AI difficulty`}
          value={aiDifficulty}
          onChange={(event) => onDifficultyChange(event.target.value as Difficulty)}
          className="min-h-11 rounded border-2 border-[#E3C798] bg-white px-2 text-sm capitalize"
        >
          {DIFFICULTIES.map((difficulty) => (
            <option key={difficulty} value={difficulty}>
              {difficulty}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}

export default SeatRow;
