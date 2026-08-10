"use client";

import { useEffect, useState } from "react";
import { formatCountdown } from "@/domain/formatters";
import { cn } from "@/lib/cn";

export interface CountdownProps {
  target: Date;
  /** Server-rendered text for this exact `target`, so the client's first
   * paint matches the server's and there is no hydration mismatch — ticking
   * only starts after mount. */
  initialText: string;
  /** Overridable clock for tests. Defaults to `() => new Date()`. */
  now?: () => Date;
  className?: string;
}

/** Renders time-until-`target` (SPEC §3.2/§3.3 close countdowns), ticking
 * once per minute client-side. Client component: it owns a timer. */
export function Countdown({ target, initialText, now, className }: CountdownProps) {
  const [text, setText] = useState(initialText);

  useEffect(() => {
    const clock = now ?? (() => new Date());

    function tick() {
      setText(formatCountdown(target.getTime() - clock().getTime()));
    }

    tick();
    const interval = setInterval(tick, 60_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.getTime()]);

  return (
    <span className={cn("tabular-nums", className)} suppressHydrationWarning>
      {text}
    </span>
  );
}
