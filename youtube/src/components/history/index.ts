/**
 * Watch history.
 *
 * One file, because the page is one thing: a day-grouped list and the rail of
 * controls that acts on it (`research/09-youtube-signedin-surfaces.md` §6 —
 * `/feed/history` is the only browse page with a persistent right rail).
 *
 * The rows are `VideoRowView` at `density="history"`, which is the density that
 * exists for this page; the grouping is `adapters/repositories/history.ts`'s,
 * because doing it twice means doing it differently at the day boundary.
 */

export {
  HistoryControls,
  HistoryList,
  type HistoryControlsProps,
  type HistoryDayView,
  type HistoryListProps,
} from "./history-list";

// From the server-safe module, not the client one — see `./row-menu`.
export { historyRowMenu } from "./row-menu";
