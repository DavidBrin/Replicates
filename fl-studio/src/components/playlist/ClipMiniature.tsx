import type { Pattern } from "@/domain/types";
import { PATTERN_LENGTH_TICKS } from "@/domain/types";

const MIN_PITCH = 24; // ~C1 — floor of the miniature's vertical range
const MAX_PITCH = 96; // ~C6 — ceiling
const PITCH_SPAN = MAX_PITCH - MIN_PITCH;
const VIEW_W = 100;
const VIEW_H = 40;

/**
 * The live mini-preview of a pattern's notes (SPEC.md §4.2, §4.3 "1-line
 * header strip + live miniature"): small pale rects at each note's real
 * pitch/time position, scaled to the clip body. Reads `pattern.notes`
 * directly — this is the entire reference-semantics story (SPEC.md §1.1
 * Playlist / lane 2 §4): a clip never copies notes, so editing the pattern
 * elsewhere re-renders every clip that references it for free.
 */
export function ClipMiniature({ pattern }: { pattern: Pattern }) {
  const notes = Object.values(pattern.notes);

  return (
    <svg
      className="fl-clip__miniature"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {notes.map((note) => {
        const x = (note.positionTicks / PATTERN_LENGTH_TICKS) * VIEW_W;
        const w = Math.max(1.5, (Math.max(note.lengthTicks, 6) / PATTERN_LENGTH_TICKS) * VIEW_W);
        const clampedPitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, note.pitch));
        const y = VIEW_H - ((clampedPitch - MIN_PITCH) / PITCH_SPAN) * VIEW_H;
        return (
          <rect
            key={note.id}
            x={x}
            y={Math.max(0, y - 1)}
            width={w}
            height={2}
            rx={0.5}
          />
        );
      })}
    </svg>
  );
}
