"use client";

import { useUi } from "./SessionContext";
import { pixelText } from "./styles";

/** "Next day..." — large outlined text sliding across the board (§8). */
export function DayBanner() {
  const banner = useUi((s) => s.banner);
  const toast = useUi((s) => s.toast);
  return (
    <>
      {banner && (
        <div
          data-testid="day-banner"
          role="status"
          className="pointer-events-none absolute left-0 right-0 top-1/3 z-20 text-center text-4xl motion-safe:animate-[bannerSlide_1.1s_ease-in-out_both]"
          style={{ ...pixelText, textTransform: "none" }}
        >
          {banner}
        </div>
      )}
      {toast && (
        <div
          data-testid="toast"
          role="alert"
          className="pointer-events-none absolute left-1/2 top-16 z-20 -translate-x-1/2 text-center text-base"
          style={pixelText}
        >
          {toast}
        </div>
      )}
      <style>{`
        @keyframes bannerSlide { 0% { transform: translateX(-40%); opacity: 0 } 25% { transform: none; opacity: 1 } 75% { transform: none; opacity: 1 } 100% { transform: translateX(40%); opacity: 0 } }
        @keyframes pop { 0% { transform: scale(0); } 100% { transform: scale(1); } }
      `}</style>
    </>
  );
}
