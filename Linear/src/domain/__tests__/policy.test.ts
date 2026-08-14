// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ACTIONS,
  ALLOW,
  DENY,
  DEFAULT_WORKSPACE_POLICY_SETTINGS,
  POLICY,
  ROLE_KEYS,
  can,
  canViewTeam,
  checkProjectRoleChange,
  checkTeamRemoval,
  checkTeamRoleChange,
  checkWorkspaceRemoval,
  checkWorkspaceRoleChange,
  type Action,
  type Actor,
  type Cell,
  type PolicyRow,
  type Resource,
  type RoleKey,
} from "../policy";

/**
 * The authorization matrix, checked cell by cell against a second transcription.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  DO NOT DERIVE `EXPECTED` FROM `POLICY`. NOT PARTIALLY. NOT "JUST THE
 *  BORING ROWS". NOT WITH A HELPER THAT LOOPS OVER `POLICY` AND FLIPS SOME
 *  CELLS.
 *
 *  The table below is typed by hand from the markdown matrix in
 *  `research/05-oss-architecture.md` §2.2. Its only value is that it is an
 *  *independent* copy: two transcriptions of the same source disagree exactly
 *  when one of them is wrong. A table computed from `POLICY` — however
 *  cleverly — passes against any policy at all, including one where every cell
 *  denies, which is the failure this file exists to catch. `SPEC.md` §4 and
 *  §7.3 of the research note both say so explicitly.
 *
 *  If this file feels repetitive: that is the feature. Simplifying it deletes
 *  the test while leaving 384 green assertions behind, which is worse than
 *  having no test at all.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `"conditional"` marks a footnote cell — a predicate rather than a constant.
 * Those are not asserted as "true": the cell is exercised with facts that
 * satisfy the footnote *and* facts that violate it, so a predicate that always
 * returns true and one that always returns false both fail.
 */
type Expectation = true | false | "conditional";

const EXPECTED = {
  /* -- workspace ------------------------------------------------------- */
  "workspace.view": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": true,
    "ws:guest": true, // fn 1 — the shell and their own settings only
    "team:admin": false,
    "team:member": false,
    "proj:lead": false,
    "proj:member": false,
  },
  "workspace.update": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": false,
    "ws:guest": false,
    "team:admin": false,
    "team:member": false,
    "proj:lead": false,
    "proj:member": false,
  },
  "workspace.delete": {
    "ws:owner": true,
    "ws:admin": false,
    "ws:member": false,
    "ws:guest": false,
    "team:admin": false,
    "team:member": false,
    "proj:lead": false,
    "proj:member": false,
  },
  "workspace.transfer_ownership": {
    "ws:owner": true,
    "ws:admin": false,
    "ws:member": false,
    "ws:guest": false,
    "team:admin": false,
    "team:member": false,
    "proj:lead": false,
    "proj:member": false,
  },
  "workspace.view_members": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": true,
    "ws:guest": false,
    "team:admin": false,
    "team:member": false,
    "proj:lead": false,
    "proj:member": false,
  },
  "workspace.view_audit_log": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": false,
    "ws:guest": false,
    "team:admin": false,
    "team:member": false,
    "proj:lead": false,
    "proj:member": false,
  },
  "workspace_label.manage": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": false,
    "ws:guest": false,
    "team:admin": false,
    "team:member": false,
    "proj:lead": false,
    "proj:member": false,
  },

  /* -- membership ------------------------------------------------------ */
  "member.invite": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": "conditional", // fn 2 — memberInvitePolicy
    "ws:guest": false,
    "team:admin": false,
    "team:member": false,
    "proj:lead": false,
    "proj:member": false,
  },
  "member.remove": {
    "ws:owner": true,
    "ws:admin": true, // fn 3 — rank limits are R2/R4, not this cell
    "ws:member": false,
    "ws:guest": false,
    "team:admin": false,
    "team:member": false,
    "proj:lead": false,
    "proj:member": false,
  },
  "member.change_role": {
    "ws:owner": true,
    "ws:admin": true, // fn 3
    "ws:member": false,
    "ws:guest": false,
    "team:admin": false,
    "team:member": false,
    "proj:lead": false,
    "proj:member": false,
  },
  "member.leave": {
    "ws:owner": true, // fn 4 — the last owner is stopped by R4
    "ws:admin": true,
    "ws:member": true,
    "ws:guest": true,
    "team:admin": false,
    "team:member": false,
    "proj:lead": false,
    "proj:member": false,
  },
  "invite.revoke": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": "conditional", // fn 5 — their own invitations
    "ws:guest": false,
    "team:admin": false,
    "team:member": false,
    "proj:lead": false,
    "proj:member": false,
  },

  /* -- team ------------------------------------------------------------ */
  "team.create": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": "conditional", // fn 6 — teamCreatePolicy
    "ws:guest": false,
    "team:admin": false,
    "team:member": false,
    "proj:lead": false,
    "proj:member": false,
  },
  "team.view": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": true,
    "ws:guest": false,
    "team:admin": true,
    "team:member": true,
    "proj:lead": false,
    "proj:member": false,
  },
  "team.view_private": {
    "ws:owner": true, // fn 7 — may list it, may self-join; reading needs a row
    "ws:admin": true, // fn 7
    "ws:member": false,
    "ws:guest": false,
    "team:admin": true,
    "team:member": true,
    "proj:lead": false,
    "proj:member": false,
  },
  "team.join": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": true,
    "ws:guest": false,
    "team:admin": false,
    "team:member": false,
    "proj:lead": false,
    "proj:member": false,
  },
  "team.update": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": false,
    "ws:guest": false,
    "team:admin": true,
    "team:member": false,
    "proj:lead": false,
    "proj:member": false,
  },
  "team.set_private": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": false,
    "ws:guest": false,
    "team:admin": true,
    "team:member": false,
    "proj:lead": false,
    "proj:member": false,
  },
  "team.delete": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": false,
    "ws:guest": false,
    "team:admin": true,
    "team:member": false,
    "proj:lead": false,
    "proj:member": false,
  },
  "team.add_member": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": false,
    "ws:guest": false,
    "team:admin": true,
    "team:member": "conditional", // fn 8 — team membershipPolicy
    "proj:lead": false,
    "proj:member": false,
  },
  "team.add_guest": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": false,
    "ws:guest": false,
    "team:admin": true,
    "team:member": false,
    "proj:lead": false,
    "proj:member": false,
  },
  "team.remove_member": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": false,
    "ws:guest": false,
    "team:admin": true,
    "team:member": false,
    "proj:lead": false,
    "proj:member": false,
  },
  "team.change_member_role": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": false,
    "ws:guest": false,
    "team:admin": true, // fn 9 — never the last team admin (R5)
    "team:member": false,
    "proj:lead": false,
    "proj:member": false,
  },
  "state.manage": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": false,
    "ws:guest": false,
    "team:admin": true,
    "team:member": false,
    "proj:lead": false,
    "proj:member": false,
  },
  "label.create": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": false,
    "ws:guest": false,
    "team:admin": true,
    "team:member": true,
    "proj:lead": false,
    "proj:member": false,
  },
  "label.update_delete": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": false,
    "ws:guest": false,
    "team:admin": true,
    "team:member": false,
    "proj:lead": false,
    "proj:member": false,
  },
  "cycle.manage": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": false,
    "ws:guest": false,
    "team:admin": true,
    "team:member": false,
    "proj:lead": false,
    "proj:member": false,
  },

  /* -- project --------------------------------------------------------- */
  "project.create": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": false, // fn 10 — no team, no project scope
    "ws:guest": false,
    "team:admin": true,
    "team:member": true,
    "proj:lead": false,
    "proj:member": false,
  },
  "project.view": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": "conditional", // fn 11 — every attached team public
    "ws:guest": false,
    "team:admin": true,
    "team:member": true,
    "proj:lead": true,
    "proj:member": true,
  },
  "project.update": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": false,
    "ws:guest": false,
    "team:admin": true,
    "team:member": false,
    "proj:lead": true,
    "proj:member": true, // the deviation
  },
  "project.archive": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": false,
    "ws:guest": false,
    "team:admin": true,
    "team:member": false,
    "proj:lead": true,
    "proj:member": false,
  },
  "project.delete": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": false,
    "ws:guest": false,
    "team:admin": true,
    "team:member": false,
    "proj:lead": true,
    "proj:member": false,
  },
  "project.add_member": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": false,
    "ws:guest": false,
    "team:admin": true,
    "team:member": false,
    "proj:lead": true,
    "proj:member": true, // fn 12 — the deviation, narrowed by R1
  },
  "project.remove_member": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": false,
    "ws:guest": false,
    "team:admin": true,
    "team:member": false,
    "proj:lead": true,
    "proj:member": false,
  },
  "project.change_member_role": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": false,
    "ws:guest": false,
    "team:admin": true,
    "team:member": false,
    "proj:lead": true,
    "proj:member": false,
  },
  "project.add_team": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": false,
    "ws:guest": false,
    "team:admin": true,
    "team:member": false,
    "proj:lead": true,
    "proj:member": false,
  },
  "project.reorder": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": false,
    "ws:guest": false,
    "team:admin": true,
    "team:member": false,
    "proj:lead": true,
    "proj:member": true,
  },

  /* -- issue ----------------------------------------------------------- */
  "issue.view": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": "conditional", // fn 11
    "ws:guest": false,
    "team:admin": true,
    "team:member": true,
    "proj:lead": true,
    "proj:member": true,
  },
  "issue.create": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": "conditional", // fn 11
    "ws:guest": false,
    "team:admin": true,
    "team:member": true,
    "proj:lead": true,
    "proj:member": true,
  },
  "issue.update_own": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": "conditional", // fn 13 — author or assignee, public team
    "ws:guest": false,
    "team:admin": true,
    "team:member": true,
    "proj:lead": true,
    "proj:member": true,
  },
  "issue.update_any": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": false,
    "ws:guest": false,
    "team:admin": true,
    "team:member": true,
    "proj:lead": true,
    "proj:member": true, // the deviation
  },
  "issue.reorder": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": false,
    "ws:guest": false,
    "team:admin": true,
    "team:member": true,
    "proj:lead": true,
    "proj:member": true,
  },
  "issue.delete": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": false,
    "ws:guest": false,
    "team:admin": true,
    "team:member": "conditional", // fn 14 — issues they authored
    "proj:lead": true,
    "proj:member": "conditional", // fn 14
  },
  "comment.create": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": "conditional", // fn 11
    "ws:guest": false,
    "team:admin": true,
    "team:member": true,
    "proj:lead": true,
    "proj:member": true,
  },
  "comment.update_delete": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": "conditional", // fn 15 — their own comments
    "ws:guest": false,
    "team:admin": true,
    "team:member": "conditional", // fn 15
    "proj:lead": true,
    "proj:member": "conditional", // fn 15
  },

  /* -- views ----------------------------------------------------------- */
  "view.create_personal": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": true,
    "ws:guest": true,
    "team:admin": true,
    "team:member": true,
    "proj:lead": true,
    "proj:member": true,
  },
  "view.create_shared": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": false,
    "ws:guest": false,
    "team:admin": true,
    "team:member": true,
    "proj:lead": true,
    "proj:member": true,
  },
  "view.update_delete_shared": {
    "ws:owner": true,
    "ws:admin": true,
    "ws:member": false,
    "ws:guest": false,
    "team:admin": true,
    "team:member": "conditional", // fn 15 — their own shared views
    "proj:lead": true,
    "proj:member": "conditional", // fn 15
  },
} as const satisfies Record<Action, Record<RoleKey, Expectation>>;

/* ====================================================== fixture builders = */

const ACTOR_ID = "usr_actor";
const STRANGER_ID = "usr_stranger";
const TEAM_ID = "tem_alpha";
const OTHER_TEAM_ID = "tem_beta";
const PROJECT_ID = "prj_alpha";

interface Context {
  readonly actor: Actor;
  readonly resource: Resource;
}

/**
 * A resource that carries every fact any row might read, set to the values that
 * make the *unconditional* cells decidable. Conditional cells never use it as
 * given — {@link contextsFor} rewrites the one fact under test.
 */
function baseResource(overrides: Partial<Resource> = {}): Resource {
  return {
    kind: "issue",
    team: { id: TEAM_ID, private: false },
    project: { id: PROJECT_ID, allTeamsPublic: true },
    authorId: STRANGER_ID,
    assigneeId: null,
    ...overrides,
  };
}

/**
 * An actor holding one column of the matrix and, as far as possible, nothing
 * else.
 *
 * A team or project role cannot exist without a workspace membership — that is
 * a precondition of `can()`, not a detail — so those actors are workspace
 * guests, the role that grants least. Where the guest column of a row is
 * itself a grant, the isolation is imperfect and the `can()` half of the
 * assertion is skipped; see {@link isolatable}.
 */
function actorHolding(roleKey: RoleKey, overrides: Partial<Actor> = {}): Actor {
  const base: Actor = { userId: ACTOR_ID, workspaceRole: "guest" };
  switch (roleKey) {
    case "ws:owner":
      return { ...base, workspaceRole: "owner", ...overrides };
    case "ws:admin":
      return { ...base, workspaceRole: "admin", ...overrides };
    case "ws:member":
      return { ...base, workspaceRole: "member", ...overrides };
    case "ws:guest":
      return { ...base, ...overrides };
    case "team:admin":
      return { ...base, teamRoles: { [TEAM_ID]: "admin" }, ...overrides };
    case "team:member":
      return { ...base, teamRoles: { [TEAM_ID]: "member" }, ...overrides };
    case "proj:lead":
      return { ...base, projectRoles: { [PROJECT_ID]: "lead" }, ...overrides };
    case "proj:member":
      return { ...base, projectRoles: { [PROJECT_ID]: "member" }, ...overrides };
  }
}

/** True when holding `roleKey` alone can be expressed as a real actor. */
function isolatable(action: Action, roleKey: RoleKey): boolean {
  if (roleKey.startsWith("ws:")) return true;
  return EXPECTED[action]["ws:guest"] === false;
}

/* ------------------------------------------------- the footnote fixtures - */

/**
 * Which fact each conditional cell turns on.
 *
 * Also hand-written, and cross-checked against `EXPECTED` below: a footnote
 * cell with no knob would otherwise be asserted as "some predicate exists",
 * which is not an assertion.
 */
type Knob =
  | "memberInvitePolicy"
  | "teamCreatePolicy"
  | "teamMembershipPolicy"
  | "publicTeam"
  | "publicProject"
  | "ownObject"
  | "ownIssueInPublicTeam";

const KNOBS: Partial<Record<Action, Partial<Record<RoleKey, Knob>>>> = {
  "member.invite": { "ws:member": "memberInvitePolicy" },
  "invite.revoke": { "ws:member": "ownObject" },
  "team.create": { "ws:member": "teamCreatePolicy" },
  "team.add_member": { "team:member": "teamMembershipPolicy" },
  "project.view": { "ws:member": "publicProject" },
  "issue.view": { "ws:member": "publicTeam" },
  "issue.create": { "ws:member": "publicTeam" },
  "issue.update_own": { "ws:member": "ownIssueInPublicTeam" },
  "issue.delete": { "team:member": "ownObject", "proj:member": "ownObject" },
  "comment.create": { "ws:member": "publicTeam" },
  "comment.update_delete": {
    "ws:member": "ownObject",
    "team:member": "ownObject",
    "proj:member": "ownObject",
  },
  "view.update_delete_shared": {
    "team:member": "ownObject",
    "proj:member": "ownObject",
  },
};

function contextsFor(
  roleKey: RoleKey,
  knob: Knob,
): { satisfying: Context[]; violating: Context[] } {
  const actor = actorHolding(roleKey);
  const settings = (overrides: Partial<typeof DEFAULT_WORKSPACE_POLICY_SETTINGS>) =>
    actorHolding(roleKey, {
      settings: { ...DEFAULT_WORKSPACE_POLICY_SETTINGS, ...overrides },
    });

  switch (knob) {
    case "memberInvitePolicy":
      return {
        satisfying: [
          { actor: settings({ memberInvitePolicy: "anyMember" }), resource: baseResource() },
        ],
        violating: [
          { actor: settings({ memberInvitePolicy: "adminsOnly" }), resource: baseResource() },
        ],
      };
    case "teamCreatePolicy":
      return {
        satisfying: [
          { actor: settings({ teamCreatePolicy: "anyMember" }), resource: baseResource() },
        ],
        violating: [
          { actor: settings({ teamCreatePolicy: "adminsOnly" }), resource: baseResource() },
        ],
      };
    case "teamMembershipPolicy":
      return {
        satisfying: [
          {
            actor,
            resource: baseResource({
              team: { id: TEAM_ID, private: false, membershipPolicy: "anyMember" },
            }),
          },
        ],
        violating: [
          {
            actor,
            resource: baseResource({
              team: { id: TEAM_ID, private: false, membershipPolicy: "adminsOnly" },
            }),
          },
        ],
      };
    case "publicTeam":
      return {
        satisfying: [
          { actor, resource: baseResource({ team: { id: TEAM_ID, private: false } }) },
        ],
        violating: [
          { actor, resource: baseResource({ team: { id: TEAM_ID, private: true } }) },
          // A caller who forgets to attach the team must be denied, not thrown at.
          { actor, resource: baseResource({ team: undefined }) },
        ],
      };
    case "publicProject":
      return {
        satisfying: [
          {
            actor,
            resource: baseResource({
              project: { id: PROJECT_ID, allTeamsPublic: true },
            }),
          },
        ],
        violating: [
          {
            actor,
            resource: baseResource({
              project: { id: PROJECT_ID, allTeamsPublic: false },
            }),
          },
          // fn 11: one private team on the project hides it, whatever the roll-up says.
          {
            actor,
            resource: baseResource({
              team: { id: TEAM_ID, private: true },
              project: { id: PROJECT_ID, allTeamsPublic: true },
            }),
          },
          { actor, resource: baseResource({ project: undefined }) },
        ],
      };
    case "ownObject":
      return {
        satisfying: [{ actor, resource: baseResource({ authorId: ACTOR_ID }) }],
        violating: [
          { actor, resource: baseResource({ authorId: STRANGER_ID }) },
          { actor, resource: baseResource({ authorId: null }) },
        ],
      };
    case "ownIssueInPublicTeam":
      return {
        satisfying: [
          { actor, resource: baseResource({ authorId: ACTOR_ID }) },
          // fn 13 counts the assignee as an owner of the issue.
          {
            actor,
            resource: baseResource({ authorId: STRANGER_ID, assigneeId: ACTOR_ID }),
          },
        ],
        violating: [
          { actor, resource: baseResource({ authorId: STRANGER_ID }) },
          {
            actor,
            resource: baseResource({
              authorId: ACTOR_ID,
              team: { id: TEAM_ID, private: true },
            }),
          },
        ],
      };
  }
}

function decisionOf(cell: Cell): Expectation {
  if (cell === ALLOW) return true;
  if (cell === DENY) return false;
  return "conditional";
}

/* ================================================== the 384 assertions === */

describe("the matrix", () => {
  it("has the shape the research note describes", () => {
    expect(ACTIONS).toHaveLength(48);
    expect(ROLE_KEYS).toHaveLength(8);
    expect(Object.keys(EXPECTED)).toHaveLength(48);
    // Order matters only to a reader diffing against the markdown, but a
    // reordering usually means a row was pasted twice.
    expect(Object.keys(EXPECTED)).toStrictEqual([...ACTIONS]);
  });

  it("has a fixture for every conditional cell, and no others", () => {
    const fromExpectations: string[] = [];
    const fromKnobs: string[] = [];
    for (const action of ACTIONS) {
      for (const roleKey of ROLE_KEYS) {
        if (EXPECTED[action][roleKey] === "conditional") {
          fromExpectations.push(`${action}/${roleKey}`);
        }
        if (KNOBS[action]?.[roleKey]) fromKnobs.push(`${action}/${roleKey}`);
      }
    }
    expect(fromKnobs.sort()).toStrictEqual(fromExpectations.sort());
  });

  describe.each(ACTIONS)("%s", (action) => {
    it.each(ROLE_KEYS)("holding only %s", (roleKey) => {
      const expected: Expectation = EXPECTED[action][roleKey];
      const policyRow: PolicyRow = POLICY[action];

      expect(
        decisionOf(policyRow[roleKey]),
        `POLICY["${action}"]["${roleKey}"] disagrees with the transcribed matrix`,
      ).toBe(expected);

      if (expected === "conditional") {
        const knob = KNOBS[action]?.[roleKey];
        if (!knob) throw new Error(`no fixture for ${action}/${roleKey}`);
        const { satisfying, violating } = contextsFor(roleKey, knob);
        for (const context of satisfying) {
          expect(can(context.actor, action, context.resource)).toBe(true);
        }
        for (const context of violating) {
          expect(can(context.actor, action, context.resource)).toBe(false);
        }
        return;
      }

      if (isolatable(action, roleKey)) {
        expect(can(actorHolding(roleKey), action, baseResource())).toBe(expected);
      }
    });
  });
});

/* ================================================ can(), beyond the table = */

describe("preconditions", () => {
  it("denies every action to someone with no workspace membership", () => {
    const outsider: Actor = { userId: ACTOR_ID, workspaceRole: null };
    for (const action of ACTIONS) {
      expect(can(outsider, action, baseResource())).toBe(false);
    }
  });

  it("denies every action to an anonymous caller", () => {
    const anonymous: Actor = { userId: null, workspaceRole: "owner" };
    for (const action of ACTIONS) {
      expect(can(anonymous, action, baseResource())).toBe(false);
    }
  });

  it("denies every action to a suspended owner, leaving included", () => {
    const suspended: Actor = {
      userId: ACTOR_ID,
      workspaceRole: "owner",
      suspended: true,
      teamRoles: { [TEAM_ID]: "admin" },
      projectRoles: { [PROJECT_ID]: "lead" },
    };
    for (const action of ACTIONS) {
      expect(can(suspended, action, baseResource())).toBe(false);
    }
  });
});

describe("union across axes", () => {
  it("gives a guest exactly what their team membership grants", () => {
    const guest: Actor = {
      userId: ACTOR_ID,
      workspaceRole: "guest",
      teamRoles: { [TEAM_ID]: "member" },
    };
    const inTeam = baseResource({ project: undefined });

    expect(can(guest, "issue.view", inTeam)).toBe(true);
    expect(can(guest, "issue.create", inTeam)).toBe(true);
    expect(can(guest, "issue.update_any", inTeam)).toBe(true);
    expect(can(guest, "comment.create", inTeam)).toBe(true);

    // …and nothing that only the workspace axis grants.
    expect(can(guest, "workspace.view_members", { kind: "workspace" })).toBe(false);
    expect(can(guest, "member.invite", { kind: "workspace" })).toBe(false);
    expect(can(guest, "team.update", inTeam)).toBe(false);
    expect(can(guest, "team.create", { kind: "workspace" })).toBe(false);
  });

  it("scopes a guest to the containers they are in", () => {
    const guest: Actor = {
      userId: ACTOR_ID,
      workspaceRole: "guest",
      teamRoles: { [TEAM_ID]: "member" },
    };
    const elsewhere = baseResource({
      team: { id: OTHER_TEAM_ID, private: false },
      project: undefined,
    });

    expect(can(guest, "issue.view", elsewhere)).toBe(false);
    expect(can(guest, "issue.create", elsewhere)).toBe(false);
    expect(canViewTeam(guest, { id: OTHER_TEAM_ID, private: false })).toBe(false);
    expect(canViewTeam(guest, { id: TEAM_ID, private: false })).toBe(true);
  });

  it("takes the highest grant when two axes disagree", () => {
    const memberInTeam: Actor = {
      userId: ACTOR_ID,
      workspaceRole: "member",
      teamRoles: { [TEAM_ID]: "member" },
    };
    const someoneElsesIssue = baseResource({ authorId: STRANGER_ID });

    // ws:member alone cannot edit someone else's issue; team:member can.
    expect(can({ userId: ACTOR_ID, workspaceRole: "member" }, "issue.update_any", someoneElsesIssue)).toBe(false);
    expect(can(memberInTeam, "issue.update_any", someoneElsesIssue)).toBe(true);
  });
});

describe("the project-membership deviation", () => {
  const projectMember: Actor = {
    userId: ACTOR_ID,
    workspaceRole: "member",
    projectRoles: { [PROJECT_ID]: "member" },
  };
  const project: Resource = {
    kind: "project",
    project: { id: PROJECT_ID, allTeamsPublic: false },
  };
  const issueInProject = baseResource({
    team: { id: TEAM_ID, private: true },
    authorId: STRANGER_ID,
  });

  it("grants edit on the project and its issues, even through a private team", () => {
    expect(can(projectMember, "project.update", project)).toBe(true);
    expect(can(projectMember, "project.add_member", project)).toBe(true);
    expect(can(projectMember, "project.view", project)).toBe(true);
    expect(can(projectMember, "issue.update_any", issueInProject)).toBe(true);
    expect(can(projectMember, "issue.reorder", issueInProject)).toBe(true);
  });

  it("is additive and nothing more", () => {
    expect(can(projectMember, "project.delete", project)).toBe(false);
    expect(can(projectMember, "project.archive", project)).toBe(false);
    expect(can(projectMember, "project.remove_member", project)).toBe(false);
    expect(can(projectMember, "project.add_team", project)).toBe(false);
    expect(can(projectMember, "team.update", issueInProject)).toBe(false);
  });

  it("does not follow the member into another project", () => {
    const other: Resource = {
      kind: "project",
      project: { id: "prj_other", allTeamsPublic: false },
    };
    expect(can(projectMember, "project.update", other)).toBe(false);
  });
});

describe("missing facts fail closed", () => {
  it("denies rather than throwing when the resource carries no container", () => {
    const member: Actor = { userId: ACTOR_ID, workspaceRole: "member" };
    expect(can(member, "issue.view", { kind: "issue" })).toBe(false);
    expect(can(member, "project.view", { kind: "project" })).toBe(false);
    expect(can(member, "issue.update_own", { kind: "issue" })).toBe(false);
  });
});

/* ============================================== transitions (R1–R7, R9) == */

describe("checkWorkspaceRoleChange", () => {
  const settings = DEFAULT_WORKSPACE_POLICY_SETTINGS;

  it("R4 — refuses to demote the last owner, and says why", () => {
    const result = checkWorkspaceRoleChange(
      "owner",
      { currentRole: "owner", isSelf: true },
      "admin",
      1,
      settings,
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.denial.code).toBe("LAST_OWNER");
  });

  it("R4 — allows the demotion once a second owner exists", () => {
    const result = checkWorkspaceRoleChange(
      "owner",
      { currentRole: "owner", isSelf: true },
      "admin",
      2,
      settings,
    );
    expect(result.ok).toBe(true);
  });

  it("R2 — an admin may not demote another admin", () => {
    const result = checkWorkspaceRoleChange(
      "admin",
      { currentRole: "admin", isSelf: false },
      "member",
      2,
      settings,
    );
    expect(result.ok === false && result.denial.code).toBe("RANK_NOT_ABOVE_TARGET");
  });

  it("R1 — an admin may not mint an owner", () => {
    const result = checkWorkspaceRoleChange(
      "admin",
      { currentRole: "member", isSelf: false },
      "owner",
      2,
      settings,
    );
    expect(result.ok === false && result.denial.code).toBe(
      "CANNOT_GRANT_ABOVE_OWN_RANK",
    );
  });

  it("R3 — admin-to-admin promotion is allowed by default and switchable off", () => {
    const promote = (adminCanPromoteToAdmin: boolean) =>
      checkWorkspaceRoleChange(
        "admin",
        { currentRole: "member", isSelf: false },
        "admin",
        2,
        { ...settings, adminCanPromoteToAdmin },
      );
    expect(promote(true).ok).toBe(true);
    expect(promote(false).ok).toBe(false);
  });

  it("an owner may promote a member all the way to owner", () => {
    expect(
      checkWorkspaceRoleChange(
        "owner",
        { currentRole: "member", isSelf: false },
        "owner",
        1,
        settings,
      ).ok,
    ).toBe(true);
  });
});

describe("checkWorkspaceRemoval", () => {
  it("R4 — the last owner cannot leave", () => {
    const result = checkWorkspaceRemoval(
      "owner",
      { currentRole: "owner", isSelf: true },
      1,
    );
    expect(result.ok === false && result.denial.code).toBe("LAST_OWNER");
  });

  it("R8 — anyone else may always leave", () => {
    for (const role of ["admin", "member", "guest"] as const) {
      expect(
        checkWorkspaceRemoval(role, { currentRole: role, isSelf: true }, 1).ok,
      ).toBe(true);
    }
  });

  it("R2 — an admin may not remove another admin", () => {
    expect(
      checkWorkspaceRemoval("admin", { currentRole: "admin", isSelf: false }, 2).ok,
    ).toBe(false);
  });
});

describe("checkTeamRoleChange", () => {
  it("R7 — a workspace guest can never become a team admin", () => {
    const result = checkTeamRoleChange(
      TEAM_ID,
      { workspaceRole: "owner", teamRole: null },
      { currentRole: "member", workspaceRole: "guest", isSelf: false },
      "admin",
      2,
    );
    expect(result.ok === false && result.denial.code).toBe("GUEST_CANNOT_HOLD_ROLE");
  });

  it("R5 — the last team admin cannot be demoted", () => {
    const result = checkTeamRoleChange(
      TEAM_ID,
      { workspaceRole: "owner", teamRole: null },
      { currentRole: "admin", workspaceRole: "member", isSelf: false },
      "member",
      1,
    );
    expect(result.ok === false && result.denial.code).toBe("LAST_TEAM_ADMIN");
  });

  it("R1 — a team member may not mint a team admin", () => {
    const result = checkTeamRoleChange(
      TEAM_ID,
      { workspaceRole: "member", teamRole: "member" },
      { currentRole: "member", workspaceRole: "member", isSelf: false },
      "admin",
      2,
    );
    expect(result.ok === false && result.denial.code).toBe(
      "CANNOT_GRANT_ABOVE_OWN_RANK",
    );
  });

  it("lets a workspace admin administer a team they hold no role in", () => {
    expect(
      checkTeamRoleChange(
        TEAM_ID,
        { workspaceRole: "admin", teamRole: null },
        { currentRole: "member", workspaceRole: "member", isSelf: false },
        "admin",
        2,
      ).ok,
    ).toBe(true);
  });
});

describe("checkTeamRemoval", () => {
  it("R5 — the last team admin cannot leave either", () => {
    const result = checkTeamRemoval(
      TEAM_ID,
      { workspaceRole: "member", teamRole: "admin" },
      { currentRole: "admin", isSelf: true },
      1,
    );
    expect(result.ok === false && result.denial.code).toBe("LAST_TEAM_ADMIN");
  });

  it("lets a plain member leave", () => {
    expect(
      checkTeamRemoval(
        TEAM_ID,
        { workspaceRole: "member", teamRole: "member" },
        { currentRole: "member", isSelf: true },
        1,
      ).ok,
    ).toBe(true);
  });

  it("stops a plain team member removing someone else", () => {
    expect(
      checkTeamRemoval(
        TEAM_ID,
        { workspaceRole: "member", teamRole: "member" },
        { currentRole: "member", isSelf: false },
        1,
      ).ok,
    ).toBe(false);
  });
});

describe("checkProjectRoleChange", () => {
  it("R7 — a workspace guest can never be a project lead", () => {
    const result = checkProjectRoleChange(
      { workspaceRole: "owner", projectRole: null },
      { workspaceRole: "guest" },
      "lead",
    );
    expect(result.ok === false && result.denial.code).toBe("GUEST_CANNOT_HOLD_ROLE");
  });

  it("fn 12 — a project member may add members but not leads", () => {
    const actor = { workspaceRole: "member", projectRole: "member" } as const;
    expect(checkProjectRoleChange(actor, { workspaceRole: "member" }, "member").ok).toBe(true);
    expect(checkProjectRoleChange(actor, { workspaceRole: "member" }, "lead").ok).toBe(false);
  });

  it("R6 — there is no last-lead rule: a lead may be demoted to member", () => {
    expect(
      checkProjectRoleChange(
        { workspaceRole: "member", projectRole: "lead" },
        { workspaceRole: "member" },
        "member",
      ).ok,
    ).toBe(true);
  });
});

/* ================================================= the one-place-only rule */

/**
 * `SPEC.md` §4: "No `if (user.role === "admin")` anywhere else in the codebase
 * — there is a unit test that greps for it."
 *
 * This is the test. A role comparison written inline is a policy decision that
 * lives outside the matrix, so no amount of coverage on `POLICY` can see it,
 * and it is exactly how a clone ends up with two authorization systems that
 * disagree about guests.
 */
describe("no role comparisons outside the policy module", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const srcRoot = join(here, "..", "..");

  /**
   * Declared exceptions — each one a debt, not a blessing.
   *
   * A path earns a line here only with a reason, so the exception is reviewable
   * and a new file cannot join the list by accident. The three repositories
   * below enforce two of the same invariants this module owns (R4's last owner,
   * R7's guest-cannot-administer), at the storage layer and without an actor.
   * That is defence in depth rather than a contradiction — but it *is*
   * duplication, and the day the two disagree, this list is where to look.
   */
  const ALLOWED = new Map([
    ["domain/policy.ts", "the matrix itself"],
    [
      "adapters/repositories/workspaces.ts",
      "re-checks R4 under its own row lock, with no actor to reason about",
    ],
    [
      "adapters/repositories/teams.ts",
      "re-checks R7 for the invite path, which has no actor at all",
    ],
    [
      "adapters/repositories/projects.ts",
      "denormalises `lead_id` from the role it was handed — storage, not policy",
    ],
  ]);

  // Deliberately broad on the left-hand side: `role`, `userRole`, `nextRole`
  // and `member.role` are all the same mistake.
  const ROLE_COMPARISON =
    /\b\w*[Rr]ole\b\s*(?:===|!==|==|!=)\s*["'](?:owner|admin|member|guest|lead)["']|["'](?:owner|admin|member|guest|lead)["']\s*(?:===|!==|==|!=)\s*\w*[Rr]ole\b/;

  function walk(dir: string, found: string[]): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "__tests__" || entry === "node_modules") continue;
        walk(full, found);
        continue;
      }
      if (!/\.tsx?$/.test(entry)) continue;
      const relativePath = relative(srcRoot, full).split(sep).join("/");
      if (ALLOWED.has(relativePath)) continue;
      if (ROLE_COMPARISON.test(readFileSync(full, "utf8"))) found.push(relativePath);
    }
    return found;
  }

  it("finds none", () => {
    expect(
      walk(srcRoot, []),
      "these files decide authorization outside src/domain/policy.ts",
    ).toStrictEqual([]);
  });
});
