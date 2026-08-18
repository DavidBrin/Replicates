import type { ReactNode } from "react";
import clsx from "clsx";

/**
 * MediaWiki's `wikitable` class: collapsed `#a2a9b1` borders, `#f8f9fa`
 * header cells. Styling for `th`/`td` lives in globals.css under
 * `.wikitable` so plain `<th>`/`<td>` markup inside works without every
 * caller re-specifying classes.
 */
export function WikiTable({ children, className }: { children: ReactNode; className?: string }) {
  return <table className={clsx("wikitable", className)}>{children}</table>;
}
