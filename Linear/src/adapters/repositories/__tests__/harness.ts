/**
 * The repository suite's fixtures.
 *
 * Every test in this directory runs against a **real PGlite instance** — a
 * WASM build of Postgres 18 with `schema.sql` applied to it — rather than a
 * mocked `SqlDatabase`. A mock would assert that the repositories call the
 * methods the test expects them to call, which is a restatement of the
 * implementation; the things actually worth checking are whether the SQL parses,
 * whether `collate "C"` orders keys byte-wise, whether a `check` constraint
 * fires, and whether `update … returning` really is race-free. None of those
 * survive a mock.
 *
 * One instance per test file, closed in `afterAll`. Instances are in-memory, so
 * two files cannot see each other's rows and a run cannot leak into the next
 * one. Boot costs roughly a second, which is why the fixture builds a whole
 * workspace in one call rather than per test.
 *
 * Test files need `// @vitest-environment node` at the top: PGlite's WASM
 * loader does not work under jsdom.
 */

import { SCHEMA_SQL } from "@/adapters/db/schema";
import type { SqlDatabase } from "@/adapters/db/driver";
import { PgliteDatabase } from "@/adapters/db/pglite";
import { createRepositories } from "@/adapters/repositories";
import type { Clock } from "@/adapters/repositories/shared";
import type { StateType, WorkflowState } from "@/domain/entities";
import { deterministicId } from "@/lib/ids";
import type { Repositories } from "@/ports/repositories";

/** A booted, migrated, empty database. */
export async function createTestDatabase(): Promise<SqlDatabase> {
  const db = new PgliteDatabase(":memory:", SCHEMA_SQL);
  await db.migrate();
  return db;
}

/**
 * A clock that returns a fixed instant and can be advanced by the test.
 *
 * Timestamps are the one thing a repository reads from outside itself, and the
 * category-transition rules are entirely about *which* timestamp gets written.
 * Asserting on those with a real clock means asserting on "some value that is
 * roughly now", which passes against an implementation that stamps the wrong
 * column.
 */
export function fixedClock(start = "2026-03-16T09:00:00.000Z") {
  let current = Date.parse(start);
  const clock: Clock = () => new Date(current).toISOString();
  return {
    clock,
    now: () => new Date(current).toISOString(),
    advance(ms: number) {
      current += ms;
    },
  };
}

/**
 * Users are written directly rather than through a repository.
 *
 * There is no `UserRepository` in this slice — identity belongs to the auth
 * adapter — but every other aggregate needs a user to point at. This is the
 * smallest thing that satisfies the foreign keys.
 */
export async function createUser(
  db: SqlDatabase,
  email: string,
  name = email.split("@")[0] ?? email,
): Promise<string> {
  const id = deterministicId("usr", email);
  await db.execute(
    `insert into users (id, email, password_hash, name, display_name, avatar_color)
     values ($1,$2,'x',$3,$4,'#5e6ad2')
     on conflict (id) do nothing`,
    [id, email, name, name.toLowerCase()],
  );
  return id;
}

export interface Fixture {
  readonly db: SqlDatabase;
  readonly repos: Repositories;
  readonly workspaceId: string;
  /** Workspace owner, and the actor for most mutations. */
  readonly ownerId: string;
  readonly memberId: string;
  readonly guestId: string;
  readonly teamId: string;
  /** The team's states, by name. */
  readonly states: Readonly<Record<string, WorkflowState>>;
  /** The first state of each type, for tests that care about the category. */
  stateOfType(type: StateType): WorkflowState;
}

/**
 * A workspace with one team, its default workflow states, and three users at
 * three permission levels.
 *
 * Built through the repositories rather than by insert, so a fixture that stops
 * matching the schema fails in the fixture instead of somewhere downstream.
 */
export async function createFixture(
  db: SqlDatabase,
  clock?: Clock,
): Promise<Fixture> {
  const repos = createRepositories(db, clock);

  const ownerId = await createUser(db, "owner@test.local", "Owner");
  const memberId = await createUser(db, "member@test.local", "Member");
  const guestId = await createUser(db, "guest@test.local", "Guest");

  const workspace = await repos.workspaces.create({
    name: "Acme",
    urlKey: "acme",
    ownerId,
  });
  await repos.workspaces.addMember(workspace.id, memberId, "member");
  await repos.workspaces.addMember(workspace.id, guestId, "guest");

  const team = await repos.teams.create(
    { workspaceId: workspace.id, name: "Engineering", key: "ENG" },
    ownerId,
  );
  await repos.teams.addMember(team.id, memberId, "member");

  const states = Object.fromEntries(
    (await repos.teams.listStates(team.id)).map((state) => [state.name, state]),
  );

  return {
    db,
    repos,
    workspaceId: workspace.id,
    ownerId,
    memberId,
    guestId,
    teamId: team.id,
    states,
    stateOfType(type) {
      const match = Object.values(states).find((state) => state.type === type);
      if (match === undefined) {
        throw new Error(`Fixture team has no ${type} state`);
      }
      return match;
    },
  };
}
