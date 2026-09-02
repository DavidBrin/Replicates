"use client";

/**
 * Stereo peak meter beside the fader (SPEC §1.1 Mixer "Live peak meter per
 * strip"; lane 1 §5.2: "green body, yellow top" hexes, tall narrow vertical
 * bars). Reads `useMeter` — the mixer's one engine seam — and renders two
 * bars (left/right); only Master gets a clip indicator (lane 1 §5.4: "it is
 * practically IMPOSSIBLE to clip insert Mixer Tracks… only Master and
 * ASIO-routed tracks can clip").
 */

import type { MixerTrackId } from "@/domain/types";
import { useMeter } from "./useMeter";

export interface MeterBarsProps {
  trackId: MixerTrackId;
  /** Only the master strip renders the clip light (lane 1 §5.4). */
  showClipIndicator?: boolean;
}

/** Above this peak the master's clip light lights (post-limiter headroom is thin by design). */
const CLIP_THRESHOLD = 0.98;
/** Above this peak the bar's cap paints yellow instead of green (lane 1 §5.2). */
const YELLOW_THRESHOLD = 0.85;

function barStyle(peak: number): React.CSSProperties {
  return {
    height: `${Math.round(peak * 100)}%`,
    background:
      peak >= YELLOW_THRESHOLD
        ? "linear-gradient(180deg, var(--fl-meter-yellow) 0%, var(--fl-meter-green) 30%)"
        : "var(--fl-meter-green)",
  };
}

export function MeterBars({ trackId, showClipIndicator = false }: MeterBarsProps) {
  const { left, right } = useMeter(trackId);
  const clipped = showClipIndicator && (left >= CLIP_THRESHOLD || right >= CLIP_THRESHOLD);

  return (
    <div className="fl-meter" data-testid={`meter-${trackId}`}>
      {showClipIndicator ? (
        <div className="fl-meter__clip" data-testid={`clip-${trackId}`} data-clipped={clipped} />
      ) : null}
      <div className="fl-meter__bars">
        <div className="fl-meter__trough">
          <div className="fl-meter__fill" style={barStyle(left)} data-testid={`meter-left-${trackId}`} />
        </div>
        <div className="fl-meter__trough">
          <div className="fl-meter__fill" style={barStyle(right)} data-testid={`meter-right-${trackId}`} />
        </div>
      </div>
    </div>
  );
}
