import "server-only";

/**
 * The repository composition point.
 *
 * One factory, one object, one place that knows which adapter implements which
 * port. Everything above this line asks for `Repositories` and gets domain
 * types; everything below it writes SQL.
 *
 * ## Why the set is memoised per database, not per process
 *
 * The database handle is already a per-process singleton (`adapters/db`), and
 * the repositories are stateless wrappers around it — so a second set would
 * work correctly and allocate for nothing. The `WeakMap` keys the set on the
 * handle rather than on a module-level `let` for the same reason `getDb` uses
 * `Symbol.for`: Next evaluates a module graph more than once, and a
 * module-scoped singleton is a singleton *per graph*. Keying on the handle also
 * means a test that swaps in its own in-memory database gets its own set
 * automatically, instead of a cached set still pointed at the previous one —
 * which is a bug that presents as "the test passes alone and fails in a suite".
 */

import { getDb } from "@/adapters/db";
import type { SqlDatabase } from "@/adapters/db/driver";
import type { Repositories } from "@/ports/repositories";

import { SqlActivityRepository } from "./activity";
import { SqlChangefeedRepository } from "./changefeed";
import { SqlCommentRepository } from "./comments";
import { SqlIssueRepository } from "./issues";
import { SqlLabelRepository } from "./labels";
import { SqlNotificationRepository } from "./notifications";
import { SqlProjectRepository } from "./projects";
import type { Clock, RepositoryContext } from "./shared";
import { SqlTeamRepository } from "./teams";
import { SqlViewRepository } from "./views";
import { SqlWorkspaceRepository } from "./workspaces";

export { SqlActivityRepository } from "./activity";
export { appendChangeEvent, SqlChangefeedRepository } from "./changefeed";
export { SqlCommentRepository } from "./comments";
export { mapIssueRow, SqlIssueRepository, transitionStamps } from "./issues";
export { SqlLabelRepository } from "./labels";
export { SqlNotificationRepository } from "./notifications";
export { SqlProjectRepository } from "./projects";
export { SqlTeamRepository } from "./teams";
export { SqlViewRepository } from "./views";
export { SqlWorkspaceRepository } from "./workspaces";
export type { Clock, RepositoryContext } from "./shared";

/**
 * Build a full set of repositories over one database.
 *
 * `clock` is injected rather than read from `Date.now()` inside the adapters so
 * that the seed can write a workspace with a plausible past in it and a test
 * can assert on an exact timestamp. Omitting it is the production case.
 */
export function createRepositories(
  db: SqlDatabase,
  clock?: Clock,
): Repositories {
  const context: RepositoryContext = { db, clock };
  return {
    workspaces: new SqlWorkspaceRepository(context),
    teams: new SqlTeamRepository(context),
    labels: new SqlLabelRepository(context),
    issues: new SqlIssueRepository(context),
    projects: new SqlProjectRepository(context),
    comments: new SqlCommentRepository(context),
    activity: new SqlActivityRepository(context),
    notifications: new SqlNotificationRepository(context),
    views: new SqlViewRepository(context),
    changefeed: new SqlChangefeedRepository(context),
  };
}

const CACHE = new WeakMap<SqlDatabase, Repositories>();

/** The repositories for this process's database. */
export function getRepositories(): Repositories {
  const db = getDb();
  const existing = CACHE.get(db);
  if (existing) return existing;
  const repositories = createRepositories(db);
  CACHE.set(db, repositories);
  return repositories;
}
