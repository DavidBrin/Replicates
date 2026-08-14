import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  PropertiesRail,
  type PickerKind,
  type PropertiesRailProps,
} from "@/components/issue-detail/properties-rail";

import { DANA, MIRA, STATES } from "./fixtures";

/**
 * The properties rail applies immediately.
 *
 * `research/04-interaction.md` §3: there is no Save, no OK, no Cancel and no
 * dirty state. Selecting fires the mutation. That rule is what makes `Escape`
 * safe on a picker — it closes the panel, it does not revert — and it is the
 * single most visible difference between a picker that feels like Linear's and
 * one that feels like a form.
 *
 * So the assertions are: the handler fires on selection, the picker closes, and
 * **no submit control exists anywhere in the panel**. The last one is the part
 * a refactor is most likely to reintroduce.
 */

const handlers = {
  onStateChange: vi.fn(),
  onPriorityChange: vi.fn(),
  onAssigneeChange: vi.fn(),
  onLabelToggle: vi.fn(),
  onProjectChange: vi.fn(),
  onDueDateChange: vi.fn(),
};

/** The rail is controlled; the harness owns the open flag, as the pane does. */
function Harness(overrides: Partial<PropertiesRailProps> = {}) {
  const [openPicker, setOpenPicker] = useState<PickerKind | null>(null);
  return (
    <PropertiesRail
      states={STATES}
      labels={[
        { id: "lbl_bug", name: "Bug", color: "#eb5757" },
        { id: "lbl_feature", name: "Feature", color: "#4cb782" },
      ]}
      projects={[{ id: "prj_1", name: "Platform", icon: "box", color: "#5e6ad2" }]}
      members={[DANA, MIRA]}
      subIssues={[]}
      stateId="sta_doing"
      priority={3}
      assigneeId={DANA.id}
      labelIds={[]}
      projectId={null}
      dueDate={null}
      openPicker={openPicker}
      onOpenPicker={setOpenPicker}
      {...handlers}
      {...overrides}
    />
  );
}

function resetHandlers(): void {
  for (const handler of Object.values(handlers)) handler.mockClear();
}

describe("PropertiesRail — the rows", () => {
  it("exposes the contract's ids and the current values", () => {
    render(<Harness />);
    expect(screen.getByTestId("issue-property-status")).toHaveTextContent("In Progress");
    expect(screen.getByTestId("issue-property-priority")).toHaveTextContent("Medium");
    expect(screen.getByTestId("issue-property-assignee")).toHaveTextContent("Dana Okafor");
    expect(screen.getByTestId("issue-property-labels")).toHaveTextContent("Add label");
    expect(screen.getByTestId("issue-property-project")).toHaveTextContent(
      "Add to project",
    );
  });

  it("shows sub-issue progress on the shared donut", () => {
    render(
      <Harness
        subIssues={[
          {
            id: "iss_a",
            identifier: "ENG-2",
            title: "a",
            stateType: "completed",
            stateName: "Done",
            stateColor: "#5e6ad2",
            assignee: null,
          },
          {
            id: "iss_b",
            identifier: "ENG-3",
            title: "b",
            stateType: "unstarted",
            stateName: "Todo",
            stateColor: "#8a8f98",
            assignee: null,
          },
        ]}
      />,
    );

    const row = screen.getByTestId("issue-property-sub-issues");
    expect(row).toHaveTextContent("1/2 sub-issues");
    const meter = within(row).getByRole("progressbar");
    expect(meter).toHaveAttribute("aria-valuenow", "1");
    expect(meter).toHaveAttribute("aria-valuemax", "2");
  });

  it("disables every row when the viewer may not edit", () => {
    render(<Harness readOnly />);
    for (const id of [
      "issue-property-status",
      "issue-property-priority",
      "issue-property-assignee",
      "issue-property-labels",
      "issue-property-project",
    ]) {
      expect(screen.getByTestId(id)).toBeDisabled();
    }
  });
});

describe("PropertiesRail — a picker applies immediately", () => {
  it("fires on selection, with no Save button anywhere in the panel", async () => {
    const user = userEvent.setup();
    resetHandlers();
    render(<Harness />);

    await user.click(screen.getByTestId("issue-property-status"));
    const picker = screen.getByTestId("status-picker");

    // The absence assertion is the point: a picker with a submit control is a
    // form, and a form is not what this component is.
    expect(within(picker).queryByRole("button", { name: /save|apply|ok|done/i })).toBeNull();

    await user.click(within(picker).getByTestId("picker-option-completed"));

    expect(handlers.onStateChange).toHaveBeenCalledWith("sta_done");
    // …and it closed itself on the way out.
    expect(screen.queryByTestId("status-picker")).toBeNull();
  });

  it("opens on the applied value rather than on row 0", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByTestId("issue-property-status"));

    const input = within(screen.getByTestId("status-picker")).getByRole("combobox");
    const activeId = input.getAttribute("aria-activedescendant");
    expect(document.getElementById(activeId ?? "")?.textContent).toContain(
      "In Progress",
    );
  });

  it("applies a priority immediately", async () => {
    const user = userEvent.setup();
    resetHandlers();
    render(<Harness />);

    await user.click(screen.getByTestId("issue-property-priority"));
    await user.click(
      within(screen.getByTestId("priority-picker")).getByTestId("picker-option-1"),
    );

    expect(handlers.onPriorityChange).toHaveBeenCalledWith(1);
  });

  it("applies an assignee, and clears one through the no-assignee row", async () => {
    const user = userEvent.setup();
    resetHandlers();
    render(<Harness />);

    await user.click(screen.getByTestId("issue-property-assignee"));
    await user.click(
      within(screen.getByTestId("assignee-picker")).getByTestId(
        `picker-option-${MIRA.displayName}`,
      ),
    );
    expect(handlers.onAssigneeChange).toHaveBeenCalledWith(MIRA.id);

    await user.click(screen.getByTestId("issue-property-assignee"));
    await user.click(
      within(screen.getByTestId("assignee-picker")).getByTestId("picker-option-__none__"),
    );
    expect(handlers.onAssigneeChange).toHaveBeenLastCalledWith(null);
  });

  it("keeps a multi-select label picker open across selections", async () => {
    const user = userEvent.setup();
    resetHandlers();
    render(<Harness />);

    await user.click(screen.getByTestId("issue-property-labels"));
    const picker = screen.getByTestId("label-picker");
    await user.click(within(picker).getByTestId("picker-option-lbl_bug"));

    expect(handlers.onLabelToggle).toHaveBeenCalledWith("lbl_bug");
    // Labels are inherently multi-select: you are expected to add several.
    expect(screen.getByTestId("label-picker")).toBeInTheDocument();
  });

  it("closes on Escape without reverting what already landed", async () => {
    const user = userEvent.setup();
    resetHandlers();
    render(<Harness />);

    await user.click(screen.getByTestId("issue-property-status"));
    await user.click(
      within(screen.getByTestId("status-picker")).getByTestId("picker-option-unstarted"),
    );
    expect(handlers.onStateChange).toHaveBeenCalledWith("sta_todo");

    await user.click(screen.getByTestId("issue-property-status"));
    await user.keyboard("{Escape}");

    expect(screen.queryByTestId("status-picker")).toBeNull();
    // One call, from the selection. Escape did not undo it and did not re-fire.
    expect(handlers.onStateChange).toHaveBeenCalledTimes(1);
  });

  it("sets and clears a due date", async () => {
    const user = userEvent.setup();
    resetHandlers();
    render(<Harness />);

    await user.click(screen.getByTestId("issue-property-due-date"));
    const field = screen.getByTestId("due-date-input");
    await user.type(field, "2026-12-24");
    expect(handlers.onDueDateChange).toHaveBeenLastCalledWith("2026-12-24");

    await user.click(screen.getByTestId("due-date-clear"));
    expect(handlers.onDueDateChange).toHaveBeenLastCalledWith(null);
  });
});
