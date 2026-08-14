import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  ActivityFeed,
  activitySentence,
  describeActivity,
} from "@/components/issue-detail/activity-feed";
import { formatAbsoluteTime } from "@/components/issue-detail/relative-time";
import type { DetailActivity } from "@/components/issue-detail/types";

import { activity, comment, DANA, MIRA } from "./fixtures";

/**
 * The activity feed reads as prose, and keeps reading as prose after the world
 * moves on.
 *
 * The second half is the one worth a suite. Every payload carries both the id
 * and the display label of each side precisely so an entry survives the state
 * it names being renamed or deleted; a feed that resolved ids against the
 * current workflow would look identical today and rewrite history tomorrow.
 *
 * `describeActivity` takes an activity and *nothing else* — no states, no
 * labels, no members — which is the structural version of that guarantee. The
 * tests below exercise it against payloads whose ids point at nothing.
 */

const noop = vi.fn();

function renderFeed(entries: Parameters<typeof ActivityFeed>[0]["activity"]) {
  return render(
    <ActivityFeed
      activity={entries}
      comments={[]}
      viewer={DANA}
      mentions={{}}
      canComment
      onReply={noop}
      onEditComment={noop}
      onDeleteComment={noop}
      onToggleCommentReaction={noop}
    />,
  );
}

describe("describeActivity — prose", () => {
  it("reads a status change as a sentence", () => {
    expect(
      activitySentence(
        activity({
          type: "state_changed",
          payload: {
            fromId: "sta_todo",
            fromLabel: "Todo",
            toId: "sta_doing",
            toLabel: "In Progress",
          },
        }),
      ),
    ).toBe("Dana Okafor changed status from Todo to In Progress");
  });

  it("says 'set' rather than 'changed from' when there is no previous value", () => {
    // "changed status from  to In Progress" is what a renderer that always
    // emits both sides produces, and it is the most common tell of one.
    expect(
      activitySentence(
        activity({
          type: "state_changed",
          payload: { toId: "sta_doing", toLabel: "In Progress" },
        }),
      ),
    ).toBe("Dana Okafor set status to In Progress");
  });

  it("distinguishes assigning, reassigning and unassigning", () => {
    const assign = activitySentence(
      activity({
        type: "assignee_changed",
        payload: { toId: MIRA.id, toLabel: MIRA.name },
      }),
    );
    const reassign = activitySentence(
      activity({
        type: "assignee_changed",
        payload: {
          fromId: DANA.id,
          fromLabel: DANA.name,
          toId: MIRA.id,
          toLabel: MIRA.name,
        },
      }),
    );
    const unassign = activitySentence(
      activity({
        type: "assignee_changed",
        payload: { fromId: MIRA.id, fromLabel: MIRA.name },
      }),
    );

    expect(assign).toBe("Dana Okafor assigned this to Mira Rossi");
    expect(reassign).toBe("Dana Okafor reassigned this from Dana Okafor to Mira Rossi");
    expect(unassign).toBe("Dana Okafor unassigned Mira Rossi");
  });

  it("reads creation, labels, projects and relations", () => {
    expect(activitySentence(activity({ type: "issue_created" }))).toBe(
      "Dana Okafor created the issue",
    );
    expect(
      activitySentence(
        activity({ type: "label_added", payload: { toId: "lbl_bug", toLabel: "Bug" } }),
      ),
    ).toBe("Dana Okafor added label Bug");
    expect(
      activitySentence(
        activity({
          type: "label_removed",
          payload: { fromId: "lbl_bug", fromLabel: "Bug" },
        }),
      ),
    ).toBe("Dana Okafor removed label Bug");
    expect(
      activitySentence(
        activity({
          type: "project_changed",
          payload: { toId: "prj_1", toLabel: "Platform" },
        }),
      ),
    ).toBe("Dana Okafor added this to project Platform");
    expect(
      activitySentence(
        activity({
          type: "relation_added",
          payload: { toId: "iss_9", toLabel: "ENG-9", relationType: "blocked_by" },
        }),
      ),
    ).toBe("Dana Okafor marked this as blocked by ENG-9");
  });

  it("degrades to something readable rather than to a blank", () => {
    // A payload with neither side is still an event that happened.
    expect(activitySentence(activity({ type: "priority_changed", payload: {} }))).toBe(
      "Dana Okafor updated priority",
    );
    expect(
      activitySentence(activity({ type: "issue_created", user: null })),
    ).toBe("Someone created the issue");
  });

  it("ignores payload values that are not strings", () => {
    // `payload` is JSON from a text column: nothing stops a bad writer putting
    // a number or an object in `toLabel`, and rendering `[object Object]` into
    // a sentence is worse than omitting the value.
    expect(
      activitySentence(
        activity({
          type: "state_changed",
          payload: JSON.parse(`{"toLabel":42,"fromLabel":{"name":"Todo"}}`) as DetailActivity["payload"],
        }),
      ),
    ).toBe("Dana Okafor updated status");
  });
});

describe("describeActivity — after the named state changes", () => {
  const renamedOrDeleted = activity({
    type: "state_changed",
    payload: {
      fromId: "sta_gone",
      fromLabel: "Todo",
      toId: "sta_also_gone",
      toLabel: "In Progress",
    },
  });

  it("renders from the payload's labels, not from a lookup", () => {
    // Neither id resolves to anything: `sta_gone` was deleted, and the state
    // that used to be called "In Progress" has since been renamed "Doing".
    // The entry must still say what was true when it happened.
    expect(activitySentence(renamedOrDeleted)).toBe(
      "Dana Okafor changed status from Todo to In Progress",
    );
  });

  it("takes no context argument at all, so it cannot consult one", () => {
    // The strongest available statement of the rule: the function's arity.
    expect(describeActivity.length).toBe(1);
  });

  it("renders the same sentence in the DOM", () => {
    renderFeed([renamedOrDeleted]);
    const entry = screen.getByTestId(`activity-${renamedOrDeleted.id}`);
    expect(entry.textContent).toContain(
      "Dana Okafor changed status from Todo to In Progress",
    );
  });
});

describe("ActivityFeed — timestamps and ordering", () => {
  it("shows a relative time with the absolute value in the title", () => {
    const entry = activity({
      createdAt: new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString(),
    });
    renderFeed([entry]);

    const time = screen.getByTestId(`activity-${entry.id}`).querySelector("time");
    expect(time?.textContent).toBe("29d ago");
    expect(time).toHaveAttribute("title", formatAbsoluteTime(entry.createdAt));
    expect(time).toHaveAttribute("datetime", entry.createdAt);
  });

  it("interleaves comment threads with property changes, oldest first", () => {
    render(
      <ActivityFeed
        activity={[
          activity({ id: "act_a", createdAt: "2026-08-01T00:00:00.000Z" }),
          activity({
            id: "act_b",
            type: "state_changed",
            payload: { fromLabel: "Todo", toLabel: "Done" },
            createdAt: "2026-08-03T00:00:00.000Z",
          }),
        ]}
        comments={[comment({ id: "cmt_mid", createdAt: "2026-08-02T00:00:00.000Z" })]}
        viewer={DANA}
        mentions={{}}
        canComment
        onReply={noop}
        onEditComment={noop}
        onDeleteComment={noop}
        onToggleCommentReaction={noop}
      />,
    );

    const feed = screen.getByTestId("issue-activity");
    const order = [...feed.querySelectorAll("[data-testid]")]
      .map((node) => node.getAttribute("data-testid"))
      .filter(
        (id): id is string =>
          id !== null && (id.startsWith("activity-") || id.startsWith("comment-thread-")),
      );

    expect(order).toEqual(["activity-act_a", "comment-thread-cmt_mid", "activity-act_b"]);
  });
});
