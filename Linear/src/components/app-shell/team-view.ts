/**
 * The team view names, and the guard that validates one from a URL segment.
 *
 * This is a separate module from `view-tabs.tsx` for one reason: that file is
 * `"use client"`, and a server component that imports a plain function from a
 * client module does not get the function — it gets a client *reference*.
 * Calling it throws at request time:
 *
 *   Attempted to call isTeamView() from the server but isTeamView is on the
 *   client.
 *
 * Nothing catches that earlier. It typechecks, it lints, and the unit suite
 * renders the tabs happily; only loading the route finds it. Keeping the type
 * and its guard in a directive-free module means both sides can import them,
 * which is also the honest description of what they are — routing vocabulary,
 * not a component.
 */

export type TeamView = "active" | "backlog" | "all" | "board" | "dag";

export const TEAM_VIEWS: readonly TeamView[] = [
  "active",
  "backlog",
  "all",
  "board",
  "dag",
];

export function isTeamView(value: string): value is TeamView {
  return (TEAM_VIEWS as readonly string[]).includes(value);
}
