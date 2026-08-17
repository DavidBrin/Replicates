import type { ReactNode } from "react";

import { MenuItem } from "@/components/primitives";

/**
 * The row menu the history page hands to `HistoryList` — server-safe.
 *
 * This lived in `history-list.tsx`, which carries a `"use client"` directive.
 * Next turns **every** export of a client module into a client *reference*,
 * including a plain function, so the server-rendered `/feed/history` calling it
 * threw:
 *
 *   Attempted to call historyRowMenu() from the server but historyRowMenu is
 *   on the client.
 *
 * Returning JSX from a server-side module is fine — `MenuItem` is a client
 * component, and *rendering* one as an element is exactly what a server
 * component is allowed to do. What is not allowed is calling a function that
 * lives on the other side of the boundary. Moving the function moves the call.
 *
 * This was the third instance of the same shape in this project, after
 * `THEME_ATTRIBUTE` and `chipsForFeed`, and the three together are worth
 * stating as a rule: **a value or plain function a server component needs must
 * not live in a `"use client"` module**, however naturally it belongs there by
 * topic. Unit tests cannot catch it — they import modules directly and never
 * cross the boundary — so only booting a production build does.
 */
export function historyRowMenu(): ReactNode {
  /**
   * `Remove from watch history` is the product's row action, and it is the
   * same unbuilt write as the rail's Clear: `adapters/repositories/history.ts`
   * reads, and nothing deletes. It renders disabled with the reason rather
   * than as a control that silently does nothing.
   */
  return (
    <MenuItem disabled data-history-row-action="remove">
      Remove from watch history
    </MenuItem>
  );
}
