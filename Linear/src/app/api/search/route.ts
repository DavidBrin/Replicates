/**
 * `GET /api/search?workspace=demo&q=…&team=ENG`
 *
 * Issues and projects, by identifier and by text.
 *
 * ## Why this is a server route at all
 *
 * `research/04-interaction.md` §2.1 is emphatic that the *command palette* must
 * search a local in-memory pool and never touch the network. This is not the
 * command palette. The palette searches commands — a fixed list of a few dozen
 * — and global search searches every issue in the workspace, which is a set the
 * client does not have and must not be given: a guest's browser holding the
 * whole issue table so that search feels fast is the same permission leak as
 * rendering it, one `devtools` away.
 *
 * ## The authorization rule
 *
 * Two passes, and both are load-bearing:
 *
 * 1. **In SQL**, restricted to the team ids the actor may read. Without this
 *    the `limit` fills with rows the second pass then discards, and a guest's
 *    search for a common word returns nothing while the same search by an owner
 *    returns fifty — the guest's results were all filtered out *after* the
 *    limit. That is a correctness bug, not just a performance one.
 * 2. **In `can()`**, per row. Redundant by construction, and kept because the
 *    id list is a cache of a policy decision and this is the policy decision.
 *    If the two ever disagree, the answer that reaches the user is the one from
 *    `domain/policy.ts`.
 *
 * The e2e permission journey asserts the outcome directly: a guest in Design
 * must never see an Engineering issue here, whatever they type.
 *
 * ## `ilike`, not a trigram index
 *
 * PGlite ships no `pg_trgm` (`DECISIONS.md` D2), so matching is a substring
 * scan and ranking happens in `components/search/query.ts` where it is testable
 * without a database. At demo scale that is imperceptible; at real scale the
 * upgrade is an index, not a rewrite of this handler.
 */

import { getRepositories } from "@/adapters/repositories";
import type { SqlExecutor, SqlRow } from "@/adapters/db";
import type { TeamId, WorkspaceId } from "@/domain/entities";
import { formatIdentifier } from "@/domain/entities";
import { can, canViewTeam, type Actor } from "@/domain/policy";
import type { SessionUser } from "@/lib/auth/current-user";
import {
  accessForWorkspace,
  sessionForRequest,
  type WorkspaceAccess,
} from "@/components/members/workspace-access";
import {
  compareResults,
  IDENTIFIER_SCORE,
  likePattern,
  parseQuery,
  scoreTextMatch,
  type SearchGroup,
  type SearchResponse,
  type SearchResult,
} from "@/components/search/query";

/** Rows fetched per type before ranking. Well past what the dialog shows. */
const FETCH_LIMIT = 40;

/** Rows returned per group. Linear's search shows a handful and a "see all". */
const RESULT_LIMIT = 8;

interface IssueRow extends SqlRow {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly team_id: TeamId;
  readonly team_key: string;
  readonly team_name: string;
  readonly team_private: boolean;
  readonly project_id: string | null;
  readonly creator_id: string;
  readonly assignee_id: string | null;
  readonly state_type: string;
  readonly state_color: string;
}

interface ProjectRow extends SqlRow {
  readonly id: string;
  readonly name: string;
  readonly slug_id: string;
  readonly summary: string;
  readonly state: string;
  readonly all_teams_public: boolean;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const workspaceKey = url.searchParams.get("workspace")?.trim() ?? "";
  const parsed = parseQuery(url.searchParams.get("q") ?? "");
  const teamKeyScope = url.searchParams.get("team")?.trim().toUpperCase() ?? null;

  const session = await sessionForRequest(request);
  if (!session) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  // Resolving by URL key rather than trusting a workspace id from the client:
  // the id is a bearer of nothing, but the key is what the address bar holds
  // and re-deriving it here means the actor is always assembled for the
  // workspace the user is actually looking at.
  const access = await resolveAccess(workspaceKey, session.user);
  if (!access) {
    // Indistinguishable from "no such workspace", deliberately: a 403 here
    // would confirm that a workspace with this key exists.
    return Response.json({ error: "Not found." }, { status: 404, headers: session.headers });
  }

  const empty: SearchResponse = { query: parsed.text, groups: [] };
  if (!parsed.valid) {
    return Response.json(empty, { headers: session.headers });
  }

  const teams = await getRepositories().teams.listForWorkspace(access.workspace.id);
  const visible = teams.filter(
    (team) =>
      canViewTeam(access.actor, team) &&
      can(access.actor, "issue.view", {
        kind: "issue",
        team: { id: team.id, private: team.private },
      }),
  );

  if (visible.length === 0) {
    // A guest with no teams cannot see an issue in this workspace, so there is
    // nothing to query. Returning early also avoids `in ()`, which is a syntax
    // error rather than an empty set.
    return Response.json(empty, { headers: session.headers });
  }

  const teamsById = new Map(visible.map((team) => [team.id, team]));
  const scopedTeam =
    teamKeyScope === null
      ? null
      : (visible.find((team) => team.key.toUpperCase() === teamKeyScope) ?? null);

  const [issues, projects] = await Promise.all([
    searchIssues(access.db, access.workspace.id, [...teamsById.keys()], parsed, scopedTeam?.id ?? null),
    searchProjects(access.db, access.workspace.id, parsed),
  ]);

  const issueResults = issues
    .filter((row) => canSeeIssue(access.actor, row))
    .map((row) => issueResult(row, access.workspace.urlKey, parsed))
    .sort(compareResults)
    .slice(0, RESULT_LIMIT);

  const projectResults = projects
    .filter((row) =>
      can(access.actor, "project.view", {
        kind: "project",
        project: { id: row.id, allTeamsPublic: row.all_teams_public },
      }),
    )
    .map((row) => projectResult(row, access.workspace.urlKey, parsed))
    .sort(compareResults)
    .slice(0, RESULT_LIMIT);

  const groups: SearchGroup[] = [];
  if (issueResults.length > 0) {
    groups.push({ type: "issue", label: "Issues", results: issueResults });
  }
  if (projectResults.length > 0) {
    groups.push({ type: "project", label: "Projects", results: projectResults });
  }

  return Response.json({ query: parsed.text, groups } satisfies SearchResponse, {
    headers: session.headers,
  });
}

/* =============================================================== queries = */

type Parsed = ReturnType<typeof parseQuery>;

async function searchIssues(
  db: SqlExecutor,
  workspaceId: WorkspaceId,
  teamIds: readonly TeamId[],
  parsed: Parsed,
  scopedTeamId: TeamId | null,
): Promise<IssueRow[]> {
  // `json_array_elements_text` rather than an `any($n::text[])`: the driver
  // interface carries only scalars (`SqlValue`), and `invites.ts` already
  // establishes this as the way an id list crosses it.
  const clauses = ["i.title ilike $3 escape '\\'"];
  const params: (string | number | null)[] = [
    workspaceId,
    JSON.stringify(teamIds),
    likePattern(parsed.text),
  ];

  if (parsed.identifier !== null) {
    params.push(parsed.identifier.teamKey, parsed.identifier.number);
    clauses.push(`(upper(t.key) = upper($4) and i.number = $5)`);
  } else if (parsed.number !== null && scopedTeamId !== null) {
    // A bare number only means an issue inside the team being looked at. Across
    // the workspace it would return one equally-wrong row per team.
    params.push(scopedTeamId, parsed.number);
    clauses.push(`(i.team_id = $4 and i.number = $5)`);
  }

  return db.query<IssueRow>(
    `select i.id, i.number, i.title, i.team_id, i.project_id,
            i.creator_id, i.assignee_id,
            t.key as team_key, t.name as team_name, t.private as team_private,
            s.type as state_type, s.color as state_color
       from issues i
       join teams t on t.id = i.team_id
       join workflow_states s on s.id = i.state_id
      where t.workspace_id = $1
        and i.team_id in (select value from json_array_elements_text($2::json))
        and i.archived_at is null and i.trashed_at is null
        and (${clauses.join(" or ")})
      order by i.updated_at desc
      limit ${FETCH_LIMIT}`,
    params,
  );
}

async function searchProjects(
  db: SqlExecutor,
  workspaceId: WorkspaceId,
  parsed: Parsed,
): Promise<ProjectRow[]> {
  return db.query<ProjectRow>(
    // `bool_and(not t.private)` is footnote 11's roll-up computed in one pass;
    // `coalesce(…, true)` covers a project with no teams attached, which is
    // public by the same rule.
    `select p.id, p.name, p.slug_id, p.summary, p.state,
            coalesce(bool_and(not t.private), true) as all_teams_public
       from projects p
       left join project_teams pt on pt.project_id = p.id
       left join teams t on t.id = pt.team_id
      where p.workspace_id = $1
        and p.archived_at is null
        and (p.name ilike $2 escape '\\' or p.summary ilike $2 escape '\\')
      group by p.id
      order by p.updated_at desc
      limit ${FETCH_LIMIT}`,
    [workspaceId, likePattern(parsed.text)],
  );
}

/* =============================================================== mapping = */

/**
 * The per-row policy check.
 *
 * `authorId` and `assigneeId` are attached because footnote 13 counts both as
 * owners of an issue, and a resource that omits them fails closed — which here
 * would mean silently hiding a member's own issue from their own search.
 */
function canSeeIssue(actor: Actor, row: IssueRow): boolean {
  return can(actor, "issue.view", {
    kind: "issue",
    team: { id: row.team_id, private: row.team_private },
    // `allTeamsPublic: false` is the conservative value and never wrong here:
    // `issue.view` grants `proj:lead` and `proj:member` outright, so the flag
    // is only ever consulted for a role this row does not use.
    ...(row.project_id === null
      ? {}
      : { project: { id: row.project_id, allTeamsPublic: false } }),
    authorId: row.creator_id,
    assigneeId: row.assignee_id,
  });
}

function issueResult(
  row: IssueRow,
  workspaceKey: string,
  parsed: Parsed,
): SearchResult {
  const identifier = formatIdentifier(row.team_key, row.number);
  const exact =
    parsed.identifier !== null &&
    parsed.identifier.teamKey === row.team_key.toUpperCase() &&
    parsed.identifier.number === row.number;
  const numeric = parsed.identifier === null && parsed.number === row.number;

  return {
    type: "issue",
    id: row.id,
    identifier,
    title: row.title,
    subtitle: row.team_name,
    href: `/${workspaceKey}/issue/${identifier}`,
    stateType: row.state_type,
    stateColor: row.state_color,
    score:
      exact || numeric
        ? IDENTIFIER_SCORE
        : scoreTextMatch(row.title, parsed.text),
  };
}

function projectResult(
  row: ProjectRow,
  workspaceKey: string,
  parsed: Parsed,
): SearchResult {
  return {
    type: "project",
    id: row.id,
    identifier: null,
    title: row.name,
    subtitle: row.summary === "" ? row.state : row.summary,
    href: `/${workspaceKey}/project/${row.slug_id}`,
    stateType: null,
    stateColor: null,
    score: Math.max(
      scoreTextMatch(row.name, parsed.text),
      // A summary hit is a real hit, but never as good as a name hit.
      Math.floor(scoreTextMatch(row.summary, parsed.text) / 2),
    ),
  };
}

async function resolveAccess(
  workspaceKey: string,
  user: SessionUser,
): Promise<WorkspaceAccess | null> {
  if (workspaceKey === "") return null;
  const workspace = await getRepositories().workspaces.byUrlKey(workspaceKey);
  return accessForWorkspace(user, workspace?.id);
}
