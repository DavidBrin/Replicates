import type {
  DetailActivity,
  DetailComment,
  DetailIssueRef,
  DetailReaction,
  DetailState,
  DetailUser,
  IssueDetailData,
} from "@/components/issue-detail/types";

/**
 * Fixtures for the issue detail suite.
 *
 * Built as overridable factories rather than as one shared constant, because
 * several of these tests are about a *specific* shape of data — an activity
 * payload naming a state that no longer exists, a reply attached to a reply, a
 * reaction from someone other than the viewer — and a shared mutable fixture
 * makes those cases read as mysterious setup instead of as the point.
 */

export const DANA: DetailUser = {
  id: "usr_dana",
  name: "Dana Okafor",
  displayName: "dana",
  avatarUrl: null,
  avatarColor: "#5e6ad2",
};

export const MIRA: DetailUser = {
  id: "usr_mira",
  name: "Mira Rossi",
  displayName: "mira",
  avatarUrl: null,
  avatarColor: "#4cb782",
};

export const STATES: DetailState[] = [
  { id: "sta_backlog", name: "Backlog", type: "backlog", color: "#8a8f98", groupIndex: 0, groupCount: 1 },
  { id: "sta_todo", name: "Todo", type: "unstarted", color: "#8a8f98", groupIndex: 0, groupCount: 1 },
  { id: "sta_doing", name: "In Progress", type: "started", color: "#f2c94c", groupIndex: 0, groupCount: 2 },
  { id: "sta_review", name: "In Review", type: "started", color: "#f2c94c", groupIndex: 1, groupCount: 2 },
  { id: "sta_done", name: "Done", type: "completed", color: "#5e6ad2", groupIndex: 0, groupCount: 1 },
];

export function comment(overrides: Partial<DetailComment> = {}): DetailComment {
  return {
    id: "cmt_1",
    body: "Looks right to me.",
    parentId: null,
    createdAt: "2026-08-01T09:00:00.000Z",
    editedAt: null,
    user: DANA,
    reactions: [],
    ...overrides,
  };
}

export function reaction(overrides: Partial<DetailReaction> = {}): DetailReaction {
  return {
    id: "rct_1",
    emoji: "👍",
    userId: DANA.id,
    userName: DANA.name,
    ...overrides,
  };
}

export function activity(overrides: Partial<DetailActivity> = {}): DetailActivity {
  return {
    id: "act_1",
    type: "issue_created",
    payload: {},
    createdAt: "2026-07-14T09:00:00.000Z",
    user: DANA,
    ...overrides,
  };
}

export function issueRef(overrides: Partial<DetailIssueRef> = {}): DetailIssueRef {
  return {
    id: "iss_2",
    identifier: "ENG-2",
    title: "Second issue",
    stateType: "unstarted",
    stateName: "Todo",
    stateColor: "#8a8f98",
    assignee: null,
    ...overrides,
  };
}

export function detailData(
  overrides: Partial<IssueDetailData> = {},
): IssueDetailData {
  return {
    workspaceUrlKey: "demo",
    viewer: DANA,
    canEdit: true,
    canComment: true,
    issue: {
      id: "iss_1",
      identifier: "ENG-1",
      title: "An issue title",
      description: "Since we depend on AWS, we could seek their partnership.",
      stateId: "sta_doing",
      priority: 3,
      assigneeId: DANA.id,
      projectId: null,
      labelIds: [],
      dueDate: null,
      estimate: null,
      teamKey: "ENG",
      teamName: "Engineering",
      createdAt: "2026-07-14T09:00:00.000Z",
    },
    states: STATES,
    labels: [
      { id: "lbl_bug", name: "Bug", color: "#eb5757" },
      { id: "lbl_feature", name: "Feature", color: "#4cb782" },
    ],
    projects: [{ id: "prj_1", name: "Platform", icon: "box", color: "#5e6ad2" }],
    members: [DANA, MIRA],
    subIssues: [],
    relations: [],
    relationCandidates: [issueRef()],
    comments: [],
    issueReactions: [],
    activity: [],
    siblings: {
      index: 1,
      total: 9,
      previousIdentifier: null,
      nextIdentifier: "ENG-2",
    },
    isFavorite: false,
    ...overrides,
  };
}

/** A `fetch` stub that records calls and resolves with a JSON body. */
export function stubFetch(
  handler: (url: string, init: RequestInit) => unknown = () => ({}),
): { calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = ((url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const body = handler(url, init);
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    } as Response);
  }) as unknown as typeof fetch;
  return { calls };
}
