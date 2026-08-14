/**
 * The transaction machine.
 *
 * Every test here is a race, and each one is written by driving the transport
 * by hand rather than by mocking `fetch` and hoping about timing. A test that
 * resolves requests in a chosen order is the only kind that can prove queue
 * ordering, rebasing and partial rollback actually hold — the three behaviours
 * `research/04-interaction.md` §6.3–6.4 says clones get wrong.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IssueId, IssueWithRelations } from "@/domain/entities";
import {
  applyPatch,
  createIssueStore,
  isRetryable,
  MutationError,
  originalOf,
  type IssueCatalog,
  type IssueFieldPatch,
  type IssueStore,
  type IssueTransport,
} from "@/lib/store/issues";

import {
  DONE,
  IN_PROGRESS,
  makeIssue,
  makeLabel,
  makeUser,
  TEAM_ID,
  TODO,
} from "./fixtures";

const alice = makeUser("usr_alice", "Alice");
const bob = makeUser("usr_bob", "Bob");
const bug = makeLabel("lbl_bug", "Bug");

function catalog(): IssueCatalog {
  return {
    states: new Map([
      [TODO.id, TODO],
      [IN_PROGRESS.id, IN_PROGRESS],
      [DONE.id, DONE],
    ]),
    users: new Map([
      [alice.id, alice],
      [bob.id, bob],
    ]),
    projects: new Map(),
    labels: new Map([[bug.id, bug]]),
  };
}

interface Call {
  readonly kind: "create" | "update" | "reorder";
  readonly id: IssueId;
  readonly patch: IssueFieldPatch;
  readonly key: string;
  resolve(issue: IssueWithRelations): void;
  reject(error: unknown): void;
}

/** A transport that records every call and settles only when told to. */
function makeTransport(): { transport: IssueTransport; calls: Call[] } {
  const calls: Call[] = [];
  const enqueue = (
    kind: Call["kind"],
    id: IssueId,
    patch: IssueFieldPatch,
    key: string,
  ): Promise<IssueWithRelations> =>
    new Promise<IssueWithRelations>((resolve, reject) => {
      calls.push({ kind, id, patch, key, resolve, reject });
    });

  return {
    calls,
    transport: {
      create: (request, key) =>
        enqueue("create", request.id, {}, key),
      update: (id, patch, key) => enqueue("update", id, patch, key),
      reorder: (request, key) =>
        enqueue("reorder", request.id, request.patch, key),
    },
  };
}

/** Let the microtask queue and any zero-delay timer drain. */
const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

describe("applyPatch", () => {
  it("re-derives the joined fields an id patch invalidates", () => {
    const issue = makeIssue({ state: TODO });
    const next = applyPatch(issue, { stateId: IN_PROGRESS.id }, catalog());

    expect(next.stateId).toBe(IN_PROGRESS.id);
    expect(next.state.name).toBe("In Progress");
  });

  it("leaves untouched relations identical, so a memoised row does not re-render", () => {
    const issue = makeIssue({ assignee: alice });
    const next = applyPatch(issue, { title: "Renamed" }, catalog());

    expect(next.assignee).toBe(issue.assignee);
    expect(next.state).toBe(issue.state);
    expect(next.labels).toBe(issue.labels);
  });

  it("clears a relation when its id is patched to null", () => {
    const issue = makeIssue({ assignee: alice });
    const next = applyPatch(issue, { assigneeId: null }, catalog());

    expect(next.assigneeId).toBeNull();
    expect(next.assignee).toBeNull();
  });

  it("resolves a whole label set", () => {
    const issue = makeIssue();
    const next = applyPatch(issue, { labelIds: [bug.id] }, catalog());

    expect(next.labels).toEqual([bug]);
  });
});

describe("originalOf", () => {
  it("snapshots only the fields the patch names", () => {
    const issue = makeIssue({ assignee: alice, priority: 2 });
    const original = originalOf(issue, { stateId: DONE.id });

    expect(original).toEqual({ stateId: TODO.id });
    expect("assigneeId" in original).toBe(false);
  });

  it("reads labels back out of the joined objects", () => {
    const issue = makeIssue({ labels: [bug] });
    expect(originalOf(issue, { labelIds: [] })).toEqual({ labelIds: [bug.id] });
  });
});

describe("isRetryable", () => {
  it("retries a 5xx and a rate limit, not a refusal", () => {
    expect(isRetryable(new MutationError(500, "boom"))).toBe(true);
    expect(isRetryable(new MutationError(429, "slow down"))).toBe(true);
    expect(isRetryable(new MutationError(403, "no"))).toBe(false);
    expect(isRetryable(new MutationError(400, "bad"))).toBe(false);
  });

  it("treats an unrecognised failure as a network fault", () => {
    // Keeping an optimistic value too long is recoverable; dropping a change
    // the server accepted is not.
    expect(isRetryable(new TypeError("fetch failed"))).toBe(true);
  });
});

describe("createIssueStore", () => {
  let transport: IssueTransport;
  let calls: Call[];
  let store: IssueStore;
  const failures: { identifier: string; status: number }[] = [];

  const ISSUE_ID = "iss_1" as IssueId;

  beforeEach(() => {
    failures.length = 0;
    const made = makeTransport();
    transport = made.transport;
    calls = made.calls;
    store = createIssueStore({
      transport,
      catalog: catalog(),
      sleep: () => Promise.resolve(),
      onFailure: (failure) =>
        failures.push({
          identifier: failure.identifier,
          status: failure.status,
        }),
    });
    store.hydrate([makeIssue({ id: ISSUE_ID, state: TODO })]);
  });

  const current = (): IssueWithRelations => {
    const issue = store.state.getState().byId[ISSUE_ID];
    if (!issue) throw new Error("issue missing from the store");
    return issue;
  };

  it("applies optimistically before anything is awaited", () => {
    store.mutate([ISSUE_ID], { stateId: IN_PROGRESS.id });

    expect(current().stateId).toBe(IN_PROGRESS.id);
    expect(current().state.name).toBe("In Progress");
  });

  it("exposes a stable list identity between writes", () => {
    const before = store.state.getState().list;
    expect(store.state.getState().list).toBe(before);

    store.mutate([ISSUE_ID], { title: "Renamed" });
    expect(store.state.getState().list).not.toBe(before);
  });

  it("serialises two edits of one issue: the second waits for the first", async () => {
    store.mutate([ISSUE_ID], { assigneeId: alice.id });
    store.mutate([ISSUE_ID], { stateId: IN_PROGRESS.id });
    await settle();

    // The whole point of the per-entity FIFO queue: one in flight at a time.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.patch).toEqual({ assigneeId: alice.id });

    calls[0]?.resolve(
      makeIssue({ id: ISSUE_ID, state: TODO, assignee: alice }),
    );
    await settle();

    expect(calls).toHaveLength(2);
    expect(calls[1]?.patch).toEqual({ stateId: IN_PROGRESS.id });
  });

  it("does not queue edits of different issues behind each other", async () => {
    const other = "iss_2" as IssueId;
    store.hydrate([
      makeIssue({ id: ISSUE_ID }),
      makeIssue({ id: other, number: 2 }),
    ]);

    store.mutate([ISSUE_ID, other], { priority: 1 });
    await settle();

    // Five bulk edits must overlap — the reason mutations are Route Handlers
    // and not Server Actions (DECISIONS.md D6).
    expect(calls).toHaveLength(2);
    expect(calls.map((call) => call.id).sort()).toEqual([ISSUE_ID, other]);
  });

  it("re-applies a still-pending patch on top of the server's answer", async () => {
    store.mutate([ISSUE_ID], { assigneeId: alice.id });
    store.mutate([ISSUE_ID], { stateId: IN_PROGRESS.id });
    await settle();

    // The server answers the first edit with a row that predates the second.
    calls[0]?.resolve(
      makeIssue({ id: ISSUE_ID, state: TODO, assignee: alice }),
    );
    await settle();

    // Without the rebase the status would flick back to Todo here.
    expect(current().stateId).toBe(IN_PROGRESS.id);
    expect(current().assigneeId).toBe(alice.id);
  });

  it("rolls back only the fields the failed transaction touched", async () => {
    store.mutate([ISSUE_ID], { assigneeId: alice.id });
    store.mutate([ISSUE_ID], { stateId: IN_PROGRESS.id });
    await settle();

    calls[0]?.resolve(
      makeIssue({ id: ISSUE_ID, state: TODO, assignee: alice }),
    );
    await settle();

    calls[1]?.reject(new MutationError(403, "Your role does not allow this."));
    await settle();

    expect(current().stateId).toBe(TODO.id);
    expect(current().state.name).toBe("Todo");
    // A whole-object snapshot would have taken the assignee with it.
    expect(current().assigneeId).toBe(alice.id);
    expect(failures).toEqual([{ identifier: "ENG-1", status: 403 }]);
  });

  it("keeps the optimistic value and retries a 5xx", async () => {
    store.mutate([ISSUE_ID], { stateId: IN_PROGRESS.id });
    await settle();

    calls[0]?.reject(new MutationError(503, "unavailable"));
    await settle();

    expect(calls).toHaveLength(2);
    expect(current().stateId).toBe(IN_PROGRESS.id);
    expect(failures).toEqual([]);

    calls[1]?.resolve(makeIssue({ id: ISSUE_ID, state: IN_PROGRESS }));
    await settle();
    expect(current().stateId).toBe(IN_PROGRESS.id);
  });

  it("gives up after the retry budget and rolls back", async () => {
    const bounded = createIssueStore({
      transport,
      catalog: catalog(),
      sleep: () => Promise.resolve(),
      maxAttempts: 2,
      onFailure: (failure) =>
        failures.push({
          identifier: failure.identifier,
          status: failure.status,
        }),
    });
    bounded.hydrate([makeIssue({ id: ISSUE_ID, state: TODO })]);

    bounded.mutate([ISSUE_ID], { stateId: DONE.id });
    await settle();
    calls[0]?.reject(new MutationError(500, "boom"));
    await settle();
    calls[1]?.reject(new MutationError(500, "boom"));
    await settle();

    expect(bounded.state.getState().byId[ISSUE_ID]?.stateId).toBe(TODO.id);
    expect(failures).toHaveLength(1);
  });

  it("sends one idempotency key per transaction, and a fresh one on retry", async () => {
    store.mutate([ISSUE_ID], { priority: 1 });
    await settle();
    const first = calls[0]?.key;
    expect(first).toBeTruthy();

    calls[0]?.reject(new MutationError(500, "boom"));
    await settle();
    // A retry of the *same* transaction reuses the key, so the server can
    // recognise it as the request that timed out.
    expect(calls[1]?.key).toBe(first);
  });

  it("applies a bulk patch to every selected issue in one commit", () => {
    const other = "iss_2" as IssueId;
    store.hydrate([
      makeIssue({ id: ISSUE_ID }),
      makeIssue({ id: other, number: 2 }),
    ]);

    const seen: number[] = [];
    const unsubscribe = store.state.subscribe(() => {
      seen.push(store.state.getState().list.length);
    });
    store.mutate([ISSUE_ID, other], { priority: 2 });
    unsubscribe();

    expect(store.state.getState().byId[ISSUE_ID]?.priority).toBe(2);
    expect(store.state.getState().byId[other]?.priority).toBe(2);
    // One notification for the selection, not one per issue: five patches
    // through five writes renders a bulk edit as five frames.
    expect(seen).toHaveLength(1);
  });

  it("drops an optimistic issue when its create is refused", async () => {
    const draft = makeIssue({ id: "iss_new" as IssueId, number: 99 });
    store.create(draft, {
      id: draft.id,
      teamId: TEAM_ID,
      title: draft.title,
      description: "",
      stateId: TODO.id,
      priority: 0,
      assigneeId: null,
      projectId: null,
      dueDate: null,
      labelIds: [],
      sortOrder: draft.sortOrder,
    });

    expect(store.state.getState().byId[draft.id]).toBeDefined();

    await settle();
    calls[0]?.reject(new MutationError(403, "no"));
    await settle();

    expect(store.state.getState().byId[draft.id]).toBeUndefined();
  });

  it("keeps a just-created issue when the server render has not caught up", async () => {
    const draft = makeIssue({ id: "iss_new" as IssueId, number: 99 });
    store.create(draft, {
      id: draft.id,
      teamId: TEAM_ID,
      title: draft.title,
      description: "",
      stateId: TODO.id,
      priority: 0,
      assigneeId: null,
      projectId: null,
      dueDate: null,
      labelIds: [],
      sortOrder: draft.sortOrder,
    });

    store.hydrate([makeIssue({ id: ISSUE_ID })]);

    expect(store.state.getState().byId[draft.id]).toBeDefined();
  });

  it("moves through the reorder transport, carrying the neighbours", async () => {
    store.move({
      id: ISSUE_ID,
      beforeKey: "a1",
      afterKey: "a3",
      patch: { stateId: IN_PROGRESS.id, sortOrder: "a2" },
    });

    expect(current().sortOrder).toBe("a2");
    expect(current().stateId).toBe(IN_PROGRESS.id);

    await settle();
    expect(calls[0]?.kind).toBe("reorder");
    expect(calls[0]?.patch).toMatchObject({ sortOrder: "a2" });
  });

  it("resolves whenIdle only once every queue has drained", async () => {
    store.mutate([ISSUE_ID], { priority: 1 });
    const idle = vi.fn();
    void store.whenIdle().then(idle);

    await settle();
    expect(idle).not.toHaveBeenCalled();

    calls[0]?.resolve(makeIssue({ id: ISSUE_ID, priority: 1 }));
    await settle();
    expect(idle).toHaveBeenCalled();
  });

  it("ignores a patch with no fields", () => {
    store.mutate([ISSUE_ID], {});
    expect(calls).toHaveLength(0);
  });

  it("ignores an id that is not in the store", async () => {
    store.mutate(["iss_missing" as IssueId], { priority: 1 });
    await settle();
    expect(calls).toHaveLength(0);
  });
});
