"use client";

/**
 * Row-peek plumbing.
 *
 * A card, a table row, a list row and a calendar event all need to open the
 * peek panel, and they sit at four different depths. Threading a callback
 * through every view would couple each renderer to its parent's state shape,
 * so the open/close verb travels in context instead. Nothing else does —
 * data still arrives as props.
 */

import { createContext, useContext } from "react";
import type { Id } from "@/lib/model/types";

export interface DatabaseUiContextValue {
  databaseId: Id;
  /** Opens the right-hand peek panel on a row. */
  openRow: (rowId: Id) => void;
  /** The row currently peeked, if any — used to highlight its source row. */
  peekRowId: Id | null;
}

const DatabaseUiContext = createContext<DatabaseUiContextValue | null>(null);

export const DatabaseUiProvider = DatabaseUiContext.Provider;

export function useDatabaseUi(): DatabaseUiContextValue {
  const value = useContext(DatabaseUiContext);
  if (!value) {
    throw new Error("useDatabaseUi must be used inside a <DatabaseView>");
  }
  return value;
}
