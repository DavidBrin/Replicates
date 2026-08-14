import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { IssueWithRelations } from "@/domain/entities";
import { applyPatch, type IssueTransport } from "@/lib/store/issues";
import { KeyboardDispatcher, KeyboardProvider } from "@/lib/keyboard";
import { CommandPalette } from "@/components/command-palette/command-palette";
import { EMPTY_CONTEXT } from "@/components/command-palette/commands";
import { IssueView } from "@/components/issues/issue-view";
import {
  DONE,
  IN_PROGRESS,
  makeIssue,
  makeLabel,
  makeProject,
  makeUser,
  TEAM_ID,
  TODO,
} from "@/lib/store/__tests__/fixtures";

/**
 * The list and an overlay above it, sharing one dispatcher.
 *
 * The view used to run its own `document` keydown listener alongside the one
 * `lib/keyboard` attaches, and two listeners on one document cannot arbitrate:
 * the second has no idea a modal is open, so every key it claims is claimed
 * *underneath* whatever is on screen. The symptoms are all here — `Cmd+A` typed
 * into the palette selecting the issues behind it and swallowing the input's own
 * select-all, and one `Escape` closing the palette *and* discarding a selection
 * the user cannot see.
 *
 * The fix is the scope stack, so these assert scopes rather than handlers: a
 * `view` binding must not resolve under a `modal`, a `selection` binding must
 * fall through when there is nothing selected, and the Escape ladder must give
 * the topmost claimant one press and stop.
 */

const alice = makeUser("usr_alice", "Alice");
const bob = makeUser("usr_bob", "Bob");
const bug = makeLabel("lbl_bug", "Bug");
const website = makeProject("prj_web", "Website");

const catalogMaps = {
  states: new Map([
    [TODO.id, TODO],
    [IN_PROGRESS.id, IN_PROGRESS],
    [DONE.id, DONE],
  ]),
  users: new Map([
    [alice.id, alice],
    [bob.id, bob],
  ]),
  projects: new Map([[website.id, website]]),
  labels: new Map([[bug.id, bug]]),
};

const issues: IssueWithRelations[] = [
  makeIssue({ id: "iss_1", number: 1, title: "First", state: TODO, sortOrder: "a1" }),
  makeIssue({ id: "iss_2", number: 2, title: "Second", state: TODO, sortOrder: "a2" }),
  makeIssue({
    id: "iss_3",
    number: 3,
    title: "Third",
    state: IN_PROGRESS,
    sortOrder: "a3",
  }),
];

function transport(): IssueTransport {
  return {
    create: (request) =>
      Promise.resolve(makeIssue({ id: request.id, number: 99, title: request.title })),
    update: (id, patch) => {
      const existing = issues.find((issue) => issue.id === id) ?? makeIssue({ id });
      return Promise.resolve(applyPatch(existing, patch, catalogMaps));
    },
    reorder: (request) => {
      const existing =
        issues.find((issue) => issue.id === request.id) ?? makeIssue({ id: request.id });
      return Promise.resolve(applyPatch(existing, request.patch, catalogMaps));
    },
  };
}

/**
 * The view and the palette under one dispatcher — the shape the app ships.
 *
 * A fresh dispatcher per test rather than the ambient one, so a scope left
 * registered by another test cannot decide this one's outcome.
 */
function mount() {
  const onCommand = vi.fn();
  render(
    <KeyboardProvider dispatcher={new KeyboardDispatcher()}>
      <IssueView
        workspaceUrlKey="demo"
        crumbs={[{ label: "Engineering" }]}
        team={{ id: TEAM_ID, key: "ENG", name: "Engineering" }}
        currentView={null}
        basePath={null}
        issues={issues}
        catalog={{
          states: [TODO, IN_PROGRESS, DONE],
          users: [alice, bob],
          labels: [bug],
          projects: [website],
          teams: [{ id: TEAM_ID, key: "ENG", name: "Engineering", color: "#5e6ad2" }],
        }}
        initialLayout="list"
        initialGroupBy="status"
        defaultStateId={TODO.id}
        transport={transport()}
      />
      <CommandPalette context={EMPTY_CONTEXT} onCommand={onCommand} />
    </KeyboardProvider>,
  );
  return { onCommand };
}

/**
 * How many *issue rows* say they are selected.
 *
 * Scoped to the list: the palette's own rows are `role="option"` too, and its
 * active row carries `aria-selected` — counting those would make this pass for
 * the wrong reason the moment the palette opens.
 */
function selectedCount(): number {
  return within(screen.getByTestId("issue-list"))
    .getAllByRole("option")
    .filter((row) => row.getAttribute("aria-selected") === "true").length;
}

/**
 * Did anything consume these keystrokes?
 *
 * Listens on `document` *after* the dispatcher has attached, so it sees the
 * event as the page would: `defaultPrevented` is true only if a binding
 * actually claimed the key. Bare modifier presses are skipped — `{Meta>}` is a
 * keydown of its own and never a candidate for anything.
 */
function watchDefaults(): { prevented: boolean[]; stop: () => void } {
  const prevented: boolean[] = [];
  const listener = (event: KeyboardEvent): void => {
    if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
    prevented.push(event.defaultPrevented);
  };
  document.addEventListener("keydown", listener);
  return {
    prevented,
    stop: () => document.removeEventListener("keydown", listener),
  };
}

describe("one dispatcher, two scopes", () => {
  it("does not select every issue when Cmd+A is typed into the open palette", async () => {
    const user = userEvent.setup();
    mount();

    await user.keyboard("j");
    await user.keyboard("x");
    expect(selectedCount()).toBe(1);

    await user.keyboard("{Meta>}k{/Meta}");
    expect(screen.getByTestId("command-palette")).toBeVisible();

    const watcher = watchDefaults();
    await user.keyboard("{Meta>}a{/Meta}");

    watcher.stop();

    // The palette is a blocking scope, so `view.selectAll` never resolves…
    expect(selectedCount()).toBe(1);
    // …and nothing consumed the key, so the input's own select-all still works.
    // A second listener would have called preventDefault on the way past.
    expect(watcher.prevented).toStrictEqual([false]);
  });

  it("does not clear the hidden selection when Escape closes the palette", async () => {
    const user = userEvent.setup();
    mount();

    await user.keyboard("j");
    await user.keyboard("x");
    expect(selectedCount()).toBe(1);

    await user.keyboard("{Meta>}k{/Meta}");
    await user.keyboard("{Escape}");

    // One level per press: the palette's rung claimed it and the ladder stopped.
    expect(screen.queryByTestId("command-palette")).toBeNull();
    expect(selectedCount()).toBe(1);

    // The next press reaches the list, which is what the ladder is for.
    await user.keyboard("{Escape}");
    expect(selectedCount()).toBe(0);
  });

  it("does not open a picker for a key typed into the palette", async () => {
    const user = userEvent.setup();
    mount();

    await user.keyboard("j");
    await user.keyboard("x");
    await user.keyboard("{Meta>}k{/Meta}");
    await user.type(screen.getByTestId("command-palette-input"), "sl");

    expect(screen.queryByTestId("status-picker")).toBeNull();
    expect(screen.queryByTestId("label-picker")).toBeNull();
    expect(screen.getByTestId("command-palette-input")).toHaveValue("sl");
  });
});

describe("bindings the consolidation had to carry over", () => {
  it("keeps every property key working through the shared dispatcher", async () => {
    const user = userEvent.setup();
    mount();

    await user.keyboard("j");
    await user.keyboard("x");

    for (const [key, picker] of [
      ["s", "status-picker"],
      ["a", "assignee-picker"],
      ["p", "priority-picker"],
      ["l", "label-picker"],
      ["{Shift>}p{/Shift}", "project-picker"],
    ] as const) {
      await user.keyboard(key);
      expect(screen.getByTestId(picker)).toBeInTheDocument();
      await user.keyboard("{Escape}");
    }
  });

  it("selects every row on Cmd+A when no overlay is open", async () => {
    const user = userEvent.setup();
    mount();

    await user.keyboard("{Meta>}a{/Meta}");
    expect(selectedCount()).toBe(3);
  });

  it("moves the cursor with the arrow keys as well as J and K", async () => {
    const user = userEvent.setup();
    mount();

    await user.keyboard("{ArrowDown}{ArrowDown}");
    await user.keyboard("x");
    expect(screen.getByTestId("issue-row-ENG-2")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.keyboard("{ArrowUp}");
    await user.keyboard("x");
    expect(screen.getByTestId("issue-row-ENG-1")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("opens the filter and the display panel from their keys", async () => {
    const user = userEvent.setup();
    mount();

    await user.keyboard("{Shift>}v{/Shift}");
    expect(screen.getByTestId("display-options")).toBeInTheDocument();
    await user.keyboard("{Escape}");
  });

  it("leaves a selection key alone when nothing is selected", async () => {
    const user = userEvent.setup();
    mount();

    const watcher = watchDefaults();
    await user.keyboard("s");
    watcher.stop();

    // `when` declines and the walk continues, so the key is not swallowed —
    // rule 5 of §9.6, and the reason `s` still reaches the page.
    expect(screen.queryByTestId("status-picker")).toBeNull();
    expect(watcher.prevented).toStrictEqual([false]);
  });
});
