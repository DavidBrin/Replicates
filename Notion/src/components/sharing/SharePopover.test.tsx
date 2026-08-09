import { useRef } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SharePopover } from "./SharePopover";
import { useWorkspaceStore } from "@/lib/store/workspace-store";
import { createDemoSnapshot, SEED_IDS } from "@/lib/seed/demo-workspace";

/**
 * The invite flow, driven through the UI.
 *
 * Membership is one of the few places where a wrong write is invisible: a role
 * control that renders correctly but saves the wrong value looks identical to
 * a working one, so these assert on the store after each interaction.
 */

const pageId = SEED_IDS.homePageId;

beforeEach(() => {
  useWorkspaceStore.setState({ ...createDemoSnapshot(), hydrated: true });
});

/** The popover anchors to a trigger, so the harness supplies a real one. */
function Harness() {
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={anchor} type="button">
        Share
      </button>
      <SharePopover pageId={pageId} open anchor={anchor} onOpenChange={() => {}} />
    </>
  );
}

const members = () => useWorkspaceStore.getState().pages[pageId].members ?? [];
const userNamed = (name: string) =>
  Object.values(useWorkspaceStore.getState().users).find((u) => u.name === name)!;

describe("people with access", () => {
  it("lists the page's current members", () => {
    render(<Harness />);

    expect(screen.getByText("David Brin")).toBeInTheDocument();
    expect(screen.getByText("Rin Nakamura")).toBeInTheDocument();
    expect(screen.getByText("rin@pufferfish.io")).toBeInTheDocument();
  });

  it("shows each member's current role", () => {
    render(<Harness />);

    // Queried as buttons, not by text: the invite dropdown's <option>s carry
    // the same labels and would otherwise be counted as members.
    const roleOf = (label: string) => screen.getAllByRole("button", { name: label });

    // Two full-access owners, two editors, one commenter in the seed.
    expect(roleOf("Full access")).toHaveLength(2);
    expect(roleOf("Can edit")).toHaveLength(2);
    expect(roleOf("Can comment")).toHaveLength(1);
  });
});

describe("inviting", () => {
  it("adds the invited person as a pending member with the chosen role", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const before = members().length;
    await user.type(screen.getByPlaceholderText(/Email or group/i), "newcomer@example.com");
    await user.selectOptions(screen.getByLabelText("Invite role"), "can_comment");
    await user.click(screen.getByRole("button", { name: "Invite" }));

    await waitFor(() => expect(members()).toHaveLength(before + 1));

    const added = members().at(-1)!;
    expect(added.role).toBe("can_comment");
    expect(added.invitePending).toBe(true);

    const invited = useWorkspaceStore.getState().users[added.userId];
    expect(invited.email).toBe("newcomer@example.com");
    // The display name is derived from the address rather than left blank.
    expect(invited.name).toBe("Newcomer");
  });

  it("keeps Invite disabled until an address is entered", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const invite = screen.getByRole("button", { name: "Invite" });
    expect(invite).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/Email or group/i), "a@b.io");
    expect(invite).toBeEnabled();
  });

  it("clears the input after a successful invite", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByPlaceholderText(/Email or group/i);
    await user.type(input, "someone@example.com");
    await user.click(screen.getByRole("button", { name: "Invite" }));

    await waitFor(() => expect(input).toHaveValue(""));
  });

  it("invites on Enter as well as on the button", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const before = members().length;
    await user.type(
      screen.getByPlaceholderText(/Email or group/i),
      "keyboard@example.com{Enter}",
    );

    await waitFor(() => expect(members()).toHaveLength(before + 1));
  });
});

describe("changing a role", () => {
  it("writes the new role through to the page's membership", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const rin = userNamed("Rin Nakamura");
    expect(members().find((m) => m.userId === rin.id)!.role).toBe("can_comment");

    // The role control is a button that opens a menu, not a native select.
    await user.click(screen.getByRole("button", { name: "Can comment" }));
    await user.click(await screen.findByRole("menuitem", { name: /Can edit/ }));

    await waitFor(() => {
      expect(members().find((m) => m.userId === rin.id)!.role).toBe("can_edit");
    });
  });

  it("removes a member through the same menu", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const rin = userNamed("Rin Nakamura");
    const before = members().length;

    await user.click(screen.getByRole("button", { name: "Can comment" }));
    await user.click(await screen.findByRole("menuitem", { name: /Remove/ }));

    await waitFor(() => expect(members()).toHaveLength(before - 1));
    expect(members().some((m) => m.userId === rin.id)).toBe(false);
  });
});

describe("publishing", () => {
  it("toggles the page's published state", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(useWorkspaceStore.getState().pages[pageId].isPublished).toBeFalsy();

    await user.click(screen.getByRole("button", { name: "publish" }));
    await user.click(screen.getByRole("switch", { name: "Publish to web" }));

    await waitFor(() => {
      expect(useWorkspaceStore.getState().pages[pageId].isPublished).toBe(true);
    });
  });
});
