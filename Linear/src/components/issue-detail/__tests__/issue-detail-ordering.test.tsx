import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { IssueDetailView } from "@/components/issue-detail/issue-detail-view";

import { detailData } from "./fixtures";

/**
 * Two edits of one field, overlapping.
 *
 * The pane is optimistic, so the second edit is on screen long before the first
 * has been answered — and from that point two things can go wrong, both of them
 * silent:
 *
 * 1. **The requests race.** Sent together, they reach the server in whichever
 *    order the network chooses, and the row keeps whichever *write* landed last.
 *    A user who corrects themselves within 50ms gets their first answer.
 * 2. **A late failure undoes a newer success.** A rollback carries the value the
 *    field held before *its* patch. Applying it after a later edit has already
 *    succeeded deletes the newer value from the screen while the server keeps
 *    it — the screen and the database disagree, and nothing says so.
 *
 * `lib/store/issues.ts` solved both for the list with a per-entity FIFO queue
 * and version-guarded rollback; this asserts the pane does the same. The
 * responses are real deferred promises settled concurrently, because the
 * interleaving is the bug — settling them one at a time tests the happy path
 * with extra steps.
 */

interface Deferred {
  readonly promise: Promise<Response>;
  resolve: (value: Response) => void;
}

const originalFetch = globalThis.fetch;

let sent: { url: string; body: unknown }[];
let inFlight: Deferred[];

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const ok = (): Response => jsonResponse(200, {});
const refused = (): Response =>
  jsonResponse(403, { error: "Your role does not allow this." });

/** Settle the nth request once it exists, whenever it is issued. */
async function settle(index: number, response: () => Response): Promise<void> {
  for (let attempt = 0; attempt < 100 && inFlight[index] === undefined; attempt += 1) {
    await Promise.resolve();
  }
  inFlight[index]?.resolve(response());
}

beforeEach(() => {
  sent = [];
  inFlight = [];
  globalThis.fetch = vi.fn((url: string, init: RequestInit = {}) => {
    sent.push({
      url,
      body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    let resolve!: (value: Response) => void;
    const promise = new Promise<Response>((res) => {
      resolve = res;
    });
    inFlight.push({ promise, resolve });
    return promise;
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function chooseStatus(
  user: ReturnType<typeof userEvent.setup>,
  token: string,
): Promise<void> {
  await user.click(screen.getByTestId("issue-property-status"));
  await user.click(
    within(screen.getByTestId("status-picker")).getByTestId(
      `picker-option-${token}`,
    ),
  );
}

describe("issue detail — overlapping edits of one field", () => {
  it("sends them one at a time, in the order they were made", async () => {
    const user = userEvent.setup();
    render(<IssueDetailView data={detailData()} />);

    await chooseStatus(user, "unstarted");
    expect(sent).toHaveLength(1);

    // The second edit lands on screen immediately and waits its turn on the
    // wire. Two overlapping PATCHes would let the server apply them backwards.
    await chooseStatus(user, "completed");
    expect(screen.getByTestId("issue-property-status")).toHaveTextContent("Done");
    expect(sent).toHaveLength(1);

    await act(async () => {
      await Promise.all([settle(0, ok), settle(1, ok)]);
    });

    await waitFor(() => {
      expect(sent).toHaveLength(2);
    });
    expect(sent.map((call) => call.body)).toStrictEqual([
      { stateId: "sta_todo" },
      { stateId: "sta_done" },
    ]);
    expect(screen.getByTestId("issue-property-status")).toHaveTextContent("Done");
  });

  it("does not let a failed edit undo the newer one that replaced it", async () => {
    const user = userEvent.setup();
    render(<IssueDetailView data={detailData()} />);

    await chooseStatus(user, "unstarted");
    await chooseStatus(user, "completed");

    // The first is refused; the second succeeds. The refusal has nothing left
    // to undo — the field it captured has moved on.
    await act(async () => {
      await Promise.all([settle(0, refused), settle(1, ok)]);
    });

    await waitFor(() => {
      expect(sent).toHaveLength(2);
    });
    // Not "In Progress" — the value the failed patch started from — and not
    // "Todo" either. The server was last told Done, and Done is what shows.
    expect(screen.getByTestId("issue-property-status")).toHaveTextContent("Done");
  });

  it("still rolls back a failure nothing newer has replaced", async () => {
    const user = userEvent.setup();
    render(<IssueDetailView data={detailData()} />);

    await chooseStatus(user, "completed");
    await act(async () => {
      await settle(0, refused);
    });

    await waitFor(() => {
      expect(screen.getByTestId("issue-property-status")).toHaveTextContent(
        "In Progress",
      );
    });
    // The guard is a version check, not a blanket refusal to roll back.
    expect(screen.getByTestId("issue-property-priority")).toHaveTextContent(
      "Medium",
    );
  });

  it("rolls back an unrelated field's failure without touching a newer edit", async () => {
    const user = userEvent.setup();
    render(<IssueDetailView data={detailData()} />);

    // Priority first, then a status change while it is unanswered.
    await user.click(screen.getByTestId("issue-property-priority"));
    await user.click(
      within(screen.getByTestId("priority-picker")).getByTestId(
        "picker-option-1",
      ),
    );
    await chooseStatus(user, "completed");

    await act(async () => {
      await Promise.all([settle(0, refused), settle(1, ok)]);
    });

    await waitFor(() => {
      expect(screen.getByTestId("issue-property-priority")).toHaveTextContent(
        "Medium",
      );
    });
    expect(screen.getByTestId("issue-property-status")).toHaveTextContent("Done");
  });
});
