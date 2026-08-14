import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { InboxList } from "@/components/inbox/inbox-list";
import type { InboxNotification } from "@/components/inbox/types";
import { ToastProvider } from "@/components/ui/toast-provider";
import { KeyboardDispatcher, KeyboardProvider } from "@/lib/keyboard";

/**
 * The Inbox's optimistic rollbacks.
 *
 * Two rows leaving the list for two different reasons is the ordinary case, not
 * a corner: `H` snoozes and `Backspace` deletes, both hide their row
 * immediately, and somebody working down an inbox fires the second before the
 * first has been answered. What a failed request may put back is therefore the
 * whole behaviour — a rollback that re-renders the array as it was resurrects
 * every row that was legitimately dismissed in between.
 *
 * The requests are real deferred promises settled concurrently, because the
 * ordering is the bug: a rollback that is correct when the two are settled one
 * at a time is exactly the rollback that was shipped.
 */

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function notification(
  id: string,
  overrides: Partial<InboxNotification> = {},
): InboxNotification {
  return {
    id,
    type: "issue_assigned",
    createdAt: "2026-08-01T09:00:00.000Z",
    readAt: null,
    snoozedUntilAt: null,
    actor: { id: "usr_dana", name: "Dana Ortega" },
    issue: {
      id: `iss_${id}`,
      identifier: `ENG-${id.slice(-1)}`,
      title: `Issue ${id}`,
      stateType: "started",
      stateColor: "#f2c94c",
      teamName: "Engineering",
      href: `/demo/issue/ENG-${id.slice(-1)}`,
    },
    project: null,
    ...overrides,
  };
}

const A = notification("ntf_1");
const B = notification("ntf_2");

function ok(): Response {
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}

function serverError(): Response {
  return new Response(JSON.stringify({ error: "nope" }), { status: 500 });
}

let calls: { url: string; method: string }[];
let inFlight: Deferred<Response>[];

beforeEach(() => {
  calls = [];
  inFlight = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      calls.push({ url, method: String(init.method ?? "GET") });
      const pending = deferred<Response>();
      inFlight.push(pending);
      return pending.promise;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mount(initial: readonly InboxNotification[]) {
  const dispatcher = new KeyboardDispatcher();
  render(
    <ToastProvider>
      <KeyboardProvider dispatcher={dispatcher}>
        <InboxList workspaceKey="demo" initial={initial} />
      </KeyboardProvider>
    </ToastProvider>,
  );
}

/** Settle the nth request once it exists, whenever it is issued. */
async function settle(index: number, response: () => Response): Promise<void> {
  for (let attempt = 0; attempt < 50 && inFlight[index] === undefined; attempt += 1) {
    await Promise.resolve();
  }
  inFlight[index]?.resolve(response());
}

describe("Inbox rollbacks", () => {
  it("puts back only the notification whose request failed", async () => {
    const user = userEvent.setup();
    mount([A, B]);

    // Snooze the first row. It leaves the list and its request is unanswered.
    await user.keyboard("h");
    expect(screen.queryByTestId(`notification-${A.id}`)).toBeNull();
    expect(screen.getByTestId(`notification-${B.id}`)).toBeInTheDocument();

    // The cursor has clamped onto the second row; delete it while the snooze is
    // still in flight.
    await user.keyboard("{Backspace}");
    expect(screen.queryByTestId(`notification-${B.id}`)).toBeNull();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.method).toBe("DELETE");

    // Both answers land together: the delete succeeded, the snooze did not.
    await act(async () => {
      await Promise.all([settle(0, serverError), settle(1, ok)]);
    });

    await waitFor(() => {
      expect(screen.getByTestId(`notification-${A.id}`)).toBeInTheDocument();
    });
    // The row the server agreed to delete must stay deleted. A whole-list
    // snapshot as the snooze's rollback brings it back from the dead.
    expect(screen.queryByTestId(`notification-${B.id}`)).toBeNull();
  });

  it("puts back only the notification whose deletion failed", async () => {
    const user = userEvent.setup();
    mount([A, B]);

    await user.keyboard("{Backspace}");
    await user.keyboard("h");
    expect(screen.queryByTestId(`notification-${A.id}`)).toBeNull();
    expect(screen.queryByTestId(`notification-${B.id}`)).toBeNull();

    await act(async () => {
      await Promise.all([settle(0, serverError), settle(1, ok)]);
    });

    await waitFor(() => {
      expect(screen.getByTestId(`notification-${A.id}`)).toBeInTheDocument();
    });
    expect(screen.queryByTestId(`notification-${B.id}`)).toBeNull();
  });

  it("restores a failed snooze to the position it left from", async () => {
    const user = userEvent.setup();
    mount([A, B]);

    // Snooze the *second* row, so a restore that appends rather than splices
    // would put it in the wrong place.
    await user.keyboard("j");
    await user.keyboard("h");
    expect(screen.queryByTestId(`notification-${B.id}`)).toBeNull();

    await act(async () => {
      await settle(0, serverError);
    });

    const rows = await screen.findAllByRole("option");
    expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
      `notification-${A.id}`,
      `notification-${B.id}`,
    ]);
  });
});
