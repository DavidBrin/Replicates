"use client";

/**
 * The normalised issue store, and the transaction machine in front of it.
 *
 * `research/04-interaction.md` §6.2 is explicit that what makes this product
 * feel like Linear is not the sync engine — it is that **no interaction ever
 * waits for the network**. So this module is the transaction layer without the
 * replication: one object pool, a per-entity FIFO queue, optimistic apply,
 * rebase-on-reconcile, and rollback of *only the fields a transaction touched*.
 *
 * ## Five rules, each of which exists because breaking it is a visible bug
 *
 * 1. **Optimistic apply is synchronous.** `mutate()` returns after the store
 *    has already changed. A caller that awaits anything has lost the point.
 * 2. **One FIFO queue per entity.** Two edits of one issue cannot land out of
 *    order, and edits of *different* issues do not queue behind each other —
 *    which is the whole reason mutations are Route Handlers rather than Server
 *    Actions (`DECISIONS.md` D6): selecting five issues and pressing `S` fires
 *    five requests that overlap.
 * 3. **Rollback restores only the touched fields, to the newest server truth.**
 *    A whole-object snapshot would clobber a concurrent edit to a *different*
 *    field — you set the assignee, a status edit fails, and the assignee
 *    silently reverts too. Restoring the value the transaction started from
 *    would clobber a *newer* one: a hydration that landed while the request was
 *    in flight is server truth, and undoing past it deletes somebody else's
 *    change from the screen.
 * 4. **Reconcile rebases.** Server truth is written, then every *still-queued*
 *    local patch is re-applied on top. Without it, the response to your first
 *    edit erases your second one for the ~50ms until its own response lands,
 *    which reads as the UI fighting you.
 * 5. **Network and 5xx failures do not roll back.** They retry, keeping the
 *    optimistic state. Only a 4xx — a refusal the server means — reverts, with
 *    a toast that says why. §6.4: this is what makes an app feel unbreakable on
 *    a flaky connection rather than fragile.
 *
 * ## Why the store owns the relation objects
 *
 * A row renders `issue.state.name`, not `issue.stateId`. An optimistic patch
 * that set only the id would leave the row showing the old status until the
 * response arrived — the exact latency the patch existed to hide. So the store
 * holds a {@link IssueCatalog} of the workspace's states, users, projects and
 * labels, and re-derives the joined fields whenever an id changes.
 *
 * ## Why the transport is injected
 *
 * Every behaviour above is a race, and a race tested through `fetch` is a race
 * tested through a mock of `fetch`. Injecting the transport lets the tests
 * resolve and reject individual requests by hand, in a chosen order, which is
 * the only way to assert that queue ordering and rebasing actually hold.
 */

import { createStore, type StoreApi } from "zustand/vanilla";

import type {
  IssueId,
  IssueWithRelations,
  Label,
  LabelId,
  Priority,
  Project,
  ProjectId,
  StateId,
  User,
  UserId,
  WorkflowState,
} from "@/domain/entities";

/* ================================================================ types == */

/**
 * The fields a client may change.
 *
 * `labelIds` is the one that is not a column: labels live in a join table, so
 * the patch carries the whole intended set and the server diffs it. Sending
 * add/remove deltas instead would make two concurrent label edits produce a
 * result neither client asked for.
 */
export interface IssueFieldPatch {
  readonly title?: string;
  readonly description?: string;
  readonly stateId?: StateId;
  readonly priority?: Priority;
  readonly assigneeId?: UserId | null;
  readonly projectId?: ProjectId | null;
  readonly estimate?: number | null;
  readonly dueDate?: string | null;
  readonly sortOrder?: string;
  readonly labelIds?: readonly LabelId[];
}

type MutablePatch = { -readonly [K in keyof IssueFieldPatch]: IssueFieldPatch[K] };

/** Everything the store needs to re-derive a row's joined fields locally. */
export interface IssueCatalog {
  readonly states: ReadonlyMap<StateId, WorkflowState>;
  readonly users: ReadonlyMap<UserId, User>;
  readonly projects: ReadonlyMap<
    ProjectId,
    Pick<Project, "id" | "name" | "icon" | "color">
  >;
  readonly labels: ReadonlyMap<LabelId, Label>;
}

export function emptyCatalog(): IssueCatalog {
  return {
    states: new Map(),
    users: new Map(),
    projects: new Map(),
    labels: new Map(),
  };
}

/** What a create request carries beyond the optimistic row itself. */
export interface CreateIssueRequest {
  readonly id: IssueId;
  readonly teamId: string;
  readonly title: string;
  readonly description: string;
  readonly stateId: StateId;
  readonly priority: Priority;
  readonly assigneeId: UserId | null;
  readonly projectId: ProjectId | null;
  readonly dueDate: string | null;
  readonly labelIds: readonly LabelId[];
  readonly sortOrder: string;
}

export interface ReorderRequest {
  readonly id: IssueId;
  /** The order key of the row above the drop, or null for the top. */
  readonly beforeKey: string | null;
  /** The order key of the row below the drop, or null for the end. */
  readonly afterKey: string | null;
  /**
   * The grouped field the drop implies.
   *
   * A drop into another board column is one gesture that means two things —
   * "set this field" and "put it here" — and splitting it into two requests
   * would let the first land without the second.
   */
  readonly patch: IssueFieldPatch;
}

export interface IssueTransport {
  create(
    request: CreateIssueRequest,
    idempotencyKey: string,
  ): Promise<IssueWithRelations>;
  update(
    id: IssueId,
    patch: IssueFieldPatch,
    idempotencyKey: string,
  ): Promise<IssueWithRelations>;
  reorder(
    request: ReorderRequest,
    idempotencyKey: string,
  ): Promise<IssueWithRelations>;
}

/**
 * A refusal with a status attached.
 *
 * The status is what decides rollback versus retry, so a transport that throws
 * a bare `Error` is treated as a network fault and retried — which is the safe
 * default: keeping an optimistic value too long is recoverable, dropping a
 * change the server accepted is not.
 */
export class MutationError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "MutationError";
  }
}

export function isRetryable(error: unknown): boolean {
  if (error instanceof MutationError) {
    return error.status >= 500 || error.status === 408 || error.status === 429;
  }
  return true;
}

export interface IssueStoreState {
  readonly byId: Readonly<Record<IssueId, IssueWithRelations>>;
  /**
   * The same issues as an array with a stable identity between writes.
   *
   * Selectors that build an array on every call defeat zustand's `Object.is`
   * bail-out and re-render the whole list on any unrelated store change.
   */
  readonly list: readonly IssueWithRelations[];
  /** In-flight transaction count per issue, for the "pending" row tint. */
  readonly pending: Readonly<Record<IssueId, number>>;
}

export interface MutationFailure {
  readonly issueId: IssueId;
  readonly identifier: string;
  readonly status: number;
  readonly message: string;
  /** Re-runs exactly the transaction that failed. Drives a toast's Retry. */
  readonly retry: () => void;
}

export interface IssueStoreOptions {
  readonly transport: IssueTransport;
  readonly catalog?: IssueCatalog;
  readonly issues?: readonly IssueWithRelations[];
  /** Raised once per rolled-back transaction, from the queue rather than a component. */
  readonly onFailure?: (failure: MutationFailure) => void;
  /** Attempts before a retryable failure is given up on and rolled back. */
  readonly maxAttempts?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly newKey?: () => string;
}

export interface IssueStore {
  readonly state: StoreApi<IssueStoreState>;
  /** Replace the catalog after a navigation brings a different team into view. */
  setCatalog(catalog: IssueCatalog): void;
  /** Server-rendered rows. Pending local patches are re-applied on top. */
  hydrate(issues: readonly IssueWithRelations[]): void;
  /** The same patch to every id — the list view's bulk edit, with no special case. */
  mutate(ids: readonly IssueId[], patch: IssueFieldPatch): void;
  /** Optimistically insert `issue` and post it. The id is the client's. */
  create(issue: IssueWithRelations, request: CreateIssueRequest): void;
  move(request: ReorderRequest): void;
  /** Resolves when every queue is empty. Tests await it; nothing else should. */
  whenIdle(): Promise<void>;
}

/* ========================================================= field plumbing = */

/**
 * Re-derive the joined fields an id patch invalidates.
 *
 * Only the ids present in the patch are looked up: a patch that does not
 * mention `projectId` must leave `project` exactly as it was, including its
 * object identity, so a `React.memo`'d row does not re-render.
 */
export function applyPatch(
  issue: IssueWithRelations,
  patch: IssueFieldPatch,
  catalog: IssueCatalog,
): IssueWithRelations {
  const { labelIds, ...scalars } = patch;
  const merged: IssueWithRelations = { ...issue, ...scalars };

  return {
    ...merged,
    state:
      patch.stateId === undefined
        ? merged.state
        : (catalog.states.get(patch.stateId) ?? merged.state),
    assignee:
      patch.assigneeId === undefined
        ? merged.assignee
        : patch.assigneeId === null
          ? null
          : (catalog.users.get(patch.assigneeId) ?? null),
    project:
      patch.projectId === undefined
        ? merged.project
        : patch.projectId === null
          ? null
          : (catalog.projects.get(patch.projectId) ?? null),
    labels:
      labelIds === undefined
        ? merged.labels
        : labelIds.flatMap((id) => {
            const label = catalog.labels.get(id);
            return label ? [label] : [];
          }),
  };
}

/**
 * The values `patch` is about to overwrite — and nothing else.
 *
 * Written out key by key rather than looped, because the loop needs a cast to
 * index one record type with another's keys, and a cast here is a cast in the
 * one function whose job is to be exactly right about which fields were
 * touched.
 */
export function originalOf(
  issue: IssueWithRelations,
  patch: IssueFieldPatch,
): IssueFieldPatch {
  const original: MutablePatch = {};
  if ("title" in patch) original.title = issue.title;
  if ("description" in patch) original.description = issue.description;
  if ("stateId" in patch) original.stateId = issue.stateId;
  if ("priority" in patch) original.priority = issue.priority;
  if ("assigneeId" in patch) original.assigneeId = issue.assigneeId;
  if ("projectId" in patch) original.projectId = issue.projectId;
  if ("estimate" in patch) original.estimate = issue.estimate;
  if ("dueDate" in patch) original.dueDate = issue.dueDate;
  if ("sortOrder" in patch) original.sortOrder = issue.sortOrder;
  if ("labelIds" in patch) original.labelIds = issue.labels.map((l) => l.id);
  return original;
}

/* ================================================================= store = */

type Dispatch =
  | { readonly kind: "create"; readonly request: CreateIssueRequest }
  | { readonly kind: "update" }
  | {
      readonly kind: "reorder";
      readonly beforeKey: string | null;
      readonly afterKey: string | null;
    };

interface Txn {
  readonly key: string;
  readonly entityId: IssueId;
  readonly patch: IssueFieldPatch;
  readonly original: IssueFieldPatch;
  readonly dispatch: Dispatch;
}

const DEFAULT_BACKOFF = [200, 600, 1_500] as const;

function defaultKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // A counter is enough for the fallback: the key only has to be unique within
  // one tab's lifetime, which is the scope of an idempotency window here.
  fallbackCounter += 1;
  return `txn-${Date.now().toString(36)}-${fallbackCounter}`;
}
let fallbackCounter = 0;

export function createIssueStore(options: IssueStoreOptions): IssueStore {
  const {
    transport,
    onFailure,
    maxAttempts = DEFAULT_BACKOFF.length + 1,
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    newKey = defaultKey,
  } = options;

  let catalog = options.catalog ?? emptyCatalog();
  const queues = new Map<IssueId, Txn[]>();
  const draining = new Set<IssueId>();
  let idleWaiters: (() => void)[] = [];

  /**
   * The newest server truth seen for each issue — a hydration or a response,
   * whichever landed last.
   *
   * Rollback needs it, and the value captured when a mutation *began* is not
   * it. Title is A, an edit optimistically sets B, a server render arrives with
   * C because somebody else renamed the issue, and then the edit is refused:
   * undoing to A discards C and puts a value on screen that no longer exists
   * anywhere. Undoing means "the field goes back to what the server says", and
   * this map is what the server says.
   */
  const base = new Map<IssueId, IssueWithRelations>();

  const state = createStore<IssueStoreState>(() => ({
    byId: {},
    list: [],
    pending: {},
  }));

  /* --- state writes ---------------------------------------------------- */

  function commit(byId: Record<IssueId, IssueWithRelations>): void {
    const pending: Record<IssueId, number> = {};
    for (const [id, queue] of queues) {
      if (queue.length > 0) pending[id] = queue.length;
    }
    state.setState({ byId, list: Object.values(byId), pending });
  }

  function writeIssue(issue: IssueWithRelations): void {
    commit({ ...state.getState().byId, [issue.id]: issue });
  }

  function dropIssue(id: IssueId): void {
    const byId = { ...state.getState().byId };
    delete byId[id];
    commit(byId);
  }

  /** Everything still queued for `id`, applied in order on top of `base`. */
  function rebase(base: IssueWithRelations): IssueWithRelations {
    let next = base;
    for (const txn of queues.get(base.id) ?? []) {
      next = applyPatch(next, txn.patch, catalog);
    }
    return next;
  }

  /* --- queue ----------------------------------------------------------- */

  function enqueue(txn: Txn): void {
    const queue = queues.get(txn.entityId);
    if (queue) queue.push(txn);
    else queues.set(txn.entityId, [txn]);
    void drain(txn.entityId);
  }

  function settleIdle(): void {
    if (draining.size > 0) return;
    for (const queue of queues.values()) if (queue.length > 0) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  async function drain(entityId: IssueId): Promise<void> {
    if (draining.has(entityId)) return;
    draining.add(entityId);
    try {
      for (;;) {
        const queue = queues.get(entityId);
        const txn = queue?.[0];
        if (!queue || !txn) break;
        await run(txn);
        // The transaction is removed *after* it settles, so `rebase` still sees
        // it while its own response is being reconciled — otherwise a patch
        // would vanish for one frame between the response and the dequeue.
        queue.shift();
        if (queue.length === 0) queues.delete(entityId);
      }
    } finally {
      draining.delete(entityId);
      commit(state.getState().byId);
      settleIdle();
    }
  }

  async function run(txn: Txn): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const server = await send(txn);
        reconcile(txn, server);
        return;
      } catch (error) {
        if (isRetryable(error) && attempt < maxAttempts) {
          await sleep(DEFAULT_BACKOFF[attempt - 1] ?? 0);
          continue;
        }
        rollback(txn, error);
        return;
      }
    }
  }

  function send(txn: Txn): Promise<IssueWithRelations> {
    switch (txn.dispatch.kind) {
      case "create":
        return transport.create(txn.dispatch.request, txn.key);
      case "reorder":
        return transport.reorder(
          {
            id: txn.entityId,
            beforeKey: txn.dispatch.beforeKey,
            afterKey: txn.dispatch.afterKey,
            patch: txn.patch,
          },
          txn.key,
        );
      case "update":
        return transport.update(txn.entityId, txn.patch, txn.key);
    }
  }

  /**
   * Server truth in, pending patches back on top.
   *
   * The response is authoritative and is written whole — no refetch, no
   * invalidate (§6.5, rule 1). The rebase immediately after is what keeps a
   * second edit made while the first was in flight from being erased by the
   * first one's answer.
   */
  function reconcile(txn: Txn, server: IssueWithRelations): void {
    base.set(txn.entityId, server);
    const queue = queues.get(txn.entityId) ?? [];
    let next = server;
    for (const other of queue) {
      if (other === txn) continue;
      next = applyPatch(next, other.patch, catalog);
    }
    writeIssue(next);
  }

  function rollback(txn: Txn, error: unknown): void {
    const current = state.getState().byId[txn.entityId];

    if (txn.dispatch.kind === "create") {
      base.delete(txn.entityId);
      dropIssue(txn.entityId);
    } else if (current) {
      // Only the fields this transaction wrote go back, and they go back to
      // the *latest* server truth rather than to the value the transaction
      // started from — a hydration may have landed in between with a newer one,
      // and reverting past it would erase a change this client never made.
      // `txn.original` is the fallback for an issue the server has never spoken
      // about, which is only ever a locally created row.
      const authoritative = base.get(txn.entityId);
      const restored =
        authoritative === undefined
          ? txn.original
          : originalOf(authoritative, txn.patch);

      // Later queued patches are then re-applied, so a failed status change
      // does not also undo the assignee someone set half a second afterwards.
      const queue = queues.get(txn.entityId) ?? [];
      let next = applyPatch(current, restored, catalog);
      for (const other of queue) {
        if (other === txn) continue;
        next = applyPatch(next, other.patch, catalog);
      }
      writeIssue(next);
    }

    onFailure?.({
      issueId: txn.entityId,
      identifier: current?.identifier ?? txn.entityId,
      status: error instanceof MutationError ? error.status : 0,
      message:
        error instanceof Error ? error.message : "The change could not be saved.",
      retry: () => {
        enqueue({ ...txn, key: newKey() });
      },
    });
  }

  /* --- commands -------------------------------------------------------- */

  return {
    state,

    setCatalog(next: IssueCatalog): void {
      catalog = next;
    },

    hydrate(issues: readonly IssueWithRelations[]): void {
      const byId: Record<IssueId, IssueWithRelations> = {};
      for (const issue of issues) {
        // A server render is authoritative even for a field an in-flight
        // transaction is about to be refused for.
        base.set(issue.id, issue);
        byId[issue.id] = rebase(issue);
      }
      // Rows created optimistically in this session are kept: a server render
      // that has not caught up yet must not make a just-created issue vanish.
      for (const [id, queue] of queues) {
        const existing = state.getState().byId[id];
        if (existing && !byId[id] && queue.length > 0) byId[id] = existing;
      }
      // An issue this render did not mention and nothing is waiting on has left
      // the view, so its base goes too — otherwise the map is every issue the
      // tab has ever displayed.
      for (const id of [...base.keys()]) {
        if (byId[id] === undefined && (queues.get(id)?.length ?? 0) === 0) {
          base.delete(id);
        }
      }
      commit(byId);
    },

    mutate(ids: readonly IssueId[], patch: IssueFieldPatch): void {
      if (Object.keys(patch).length === 0) return;
      const byId = { ...state.getState().byId };
      const txns: Txn[] = [];

      for (const id of ids) {
        const issue = byId[id];
        if (!issue) continue;
        byId[id] = applyPatch(issue, patch, catalog);
        txns.push({
          key: newKey(),
          entityId: id,
          patch,
          original: originalOf(issue, patch),
          dispatch: { kind: "update" },
        });
      }

      // One commit for the whole selection: applying five patches through five
      // separate writes renders the bulk edit as five frames.
      commit(byId);
      for (const txn of txns) enqueue(txn);
    },

    create(issue: IssueWithRelations, request: CreateIssueRequest): void {
      writeIssue(issue);
      enqueue({
        key: newKey(),
        entityId: issue.id,
        patch: {},
        original: {},
        dispatch: { kind: "create", request },
      });
    },

    move(request: ReorderRequest): void {
      const issue = state.getState().byId[request.id];
      if (!issue) return;
      const patch: IssueFieldPatch = request.patch;
      writeIssue(applyPatch(issue, patch, catalog));
      enqueue({
        key: newKey(),
        entityId: request.id,
        patch,
        original: originalOf(issue, patch),
        dispatch: {
          kind: "reorder",
          beforeKey: request.beforeKey,
          afterKey: request.afterKey,
        },
      });
    },

    whenIdle(): Promise<void> {
      if (draining.size === 0) {
        let empty = true;
        for (const queue of queues.values()) if (queue.length > 0) empty = false;
        if (empty) return Promise.resolve();
      }
      return new Promise<void>((resolve) => idleWaiters.push(resolve));
    },
  };
}

/* ============================================================= transport = */

/**
 * The production transport: one Route Handler per verb.
 *
 * The idempotency key rides in a header rather than the body so a retry after a
 * timeout is byte-identical to the request that timed out, which is what lets
 * the server recognise it (`research/04-interaction.md` §6.4).
 */
export function fetchTransport(): IssueTransport {
  async function post<T>(
    url: string,
    method: "POST" | "PATCH",
    body: unknown,
    idempotencyKey: string,
  ): Promise<T> {
    const response = await fetch(url, {
      method,
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new MutationError(
        response.status,
        detail?.error ?? `Request failed with ${response.status}`,
      );
    }
    const payload = (await response.json()) as { issue: T };
    return payload.issue;
  }

  return {
    create: (request, key) =>
      post<IssueWithRelations>("/api/issues", "POST", request, key),
    update: (id, patch, key) =>
      post<IssueWithRelations>(
        `/api/issues/${encodeURIComponent(id)}`,
        "PATCH",
        patch,
        key,
      ),
    reorder: (request, key) =>
      post<IssueWithRelations>("/api/issues/reorder", "POST", request, key),
  };
}
