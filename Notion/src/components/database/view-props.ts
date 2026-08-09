/**
 * The prop shape every view renderer takes.
 *
 * All four views consume the *same* resolved data — `DatabaseView` runs the
 * view engine once and hands the result down, so board, table, list and
 * calendar can never disagree about which rows are visible or in what order.
 */

import type { RowGroup } from "@/lib/database/view-engine";
import type { Database, Page, PropertySchema, View } from "@/lib/model/types";

export interface ViewComponentProps {
  database: Database;
  view: View;
  /** Filtered + sorted rows, already narrowed by the toolbar's search box. */
  rows: Page[];
  /** Board/calendar columns; empty when the view is not grouped. */
  groups: RowGroup[];
  groupBy: PropertySchema | null;
}
