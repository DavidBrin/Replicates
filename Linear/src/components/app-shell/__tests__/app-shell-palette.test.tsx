import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AppShell } from "@/components/app-shell/app-shell";
import type { ShellData } from "@/components/app-shell/workspace-context";
import {
  usePaletteContribution,
  type PaletteContribution,
} from "@/components/command-palette/palette-registry";
import { ToastProvider } from "@/components/ui/toast-provider";
import { KeyboardDispatcher, KeyboardProvider } from "@/lib/keyboard";
import { subscribeToThemeChange, type ThemeChangeDetail } from "@/lib/theme";

import { routerMock, setPathname } from "../../../../vitest.setup";

/**
 * The palette, as the application actually mounts it.
 *
 * `CommandSurface` was mounted here with a workspace key and nothing else,
 * which is a palette that opens and cannot do anything: its context stayed
 * `EMPTY_CONTEXT`, so every navigation href was built from an empty workspace
 * key and no issue action was ever offered, and it had no `onCommand`, so
 * "New issue", "Toggle theme", "Keyboard shortcuts" and "Sign out" each closed
 * the palette and returned nothing.
 *
 * These assert the seam rather than the rows: the shell supplies what only the
 * shell knows (the workspace, its teams), the screen in view supplies its own
 * selection and handler through the registry, and every effect reaches an
 * owner — including the last resort, which says so out loud rather than
 * swallowing the command.
 */

const SHELL: ShellData = {
  workspace: { id: "wsp_1" as ShellData["workspace"]["id"], name: "Demo", urlKey: "demo" },
  workspaces: [
    { id: "wsp_1" as ShellData["workspace"]["id"], name: "Demo", urlKey: "demo" },
  ],
  user: {
    id: "usr_1" as ShellData["user"]["id"],
    name: "Dana Ortega",
    email: "dana@demo.test",
    avatarUrl: null,
    avatarColor: "#5e6ad2",
  },
  teams: [
    {
      id: "tem_eng" as ShellData["teams"][number]["id"],
      key: "ENG",
      name: "Engineering",
      icon: "Box",
      color: "#5e6ad2",
      private: false,
    },
  ],
  views: [],
  unreadCount: 0,
};

const ISSUE = { id: "iss_1", identifier: "ENG-12", title: "Fix the drift" };

/** A screen that publishes what it is looking at, the way `IssueView` does. */
function Screen({ contribution }: { contribution: PaletteContribution }) {
  usePaletteContribution(contribution);
  return <div data-testid="screen" />;
}

function mount(contribution?: PaletteContribution) {
  // A screen claims what it owns and declines the rest, exactly as `IssueView`
  // does — a handler that swallowed everything would hide the shell's half of
  // the seam, which is the half that was missing.
  const run = vi.fn((effect: { kind: string; action?: string }) =>
    effect.kind === "run" && (effect.action ?? "").startsWith("issue."),
  );
  const published: PaletteContribution = contribution ?? {
    surface: "list",
    selection: [ISSUE],
    statuses: [{ id: "sta_done", name: "Done", type: "completed", color: "#5e6ad2" }],
    people: [],
    labels: [],
    run,
  };
  render(
    <ToastProvider>
      <KeyboardProvider dispatcher={new KeyboardDispatcher()}>
        <AppShell data={SHELL}>
          <Screen contribution={published} />
        </AppShell>
      </KeyboardProvider>
    </ToastProvider>,
  );
  return { run };
}

/** `runCommand` from `e2e/fixtures.ts`, exactly: open, fill, Enter. */
async function runCommand(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
): Promise<void> {
  await user.keyboard("{Meta>}k{/Meta}");
  await user.type(screen.getByTestId("command-palette-input"), label);
  await user.keyboard("{Enter}");
}

beforeEach(() => {
  setPathname("/demo/team/ENG/all");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("the shell supplies the palette's context", () => {
  it("builds navigation hrefs from the live workspace key", async () => {
    const user = userEvent.setup();
    mount();

    await runCommand(user, "Go to Inbox");

    // An empty context builds `//inbox` off an empty workspace key — a link
    // that goes nowhere, and the reason this asserts the whole path.
    expect(routerMock.push).toHaveBeenCalledWith("/demo/inbox");
  });

  it("offers every team in the workspace as a destination", async () => {
    const user = userEvent.setup();
    mount();

    await user.keyboard("{Meta>}k{/Meta}");
    expect(screen.getByTestId("command-nav.team.ENG")).toBeInTheDocument();
  });

  it("offers the screen's selection, headed by its identifier", async () => {
    const user = userEvent.setup();
    mount();

    await user.keyboard("{Meta>}k{/Meta}");
    expect(screen.getByTestId("command-issue.status")).toBeInTheDocument();
    expect(screen.getByText("ENG-12")).toBeInTheDocument();
  });

  it("offers no issue actions when the screen has published no selection", async () => {
    const user = userEvent.setup();
    mount({ surface: "other" });

    await user.keyboard("{Meta>}k{/Meta}");
    expect(screen.queryByTestId("command-issue.status")).toBeNull();
  });
});

describe("the shell routes every effect to an owner", () => {
  it("hands a mutation to the screen that published the handler", async () => {
    const user = userEvent.setup();
    const { run } = mount();

    await runCommand(user, "New issue");

    expect(run).toHaveBeenCalledWith(
      { kind: "run", action: "issue.create" },
      expect.objectContaining({ id: "issue.create" }),
    );
  });

  it("hands a sub-menu's chosen value to the screen", async () => {
    const user = userEvent.setup();
    const { run } = mount();

    await user.keyboard("{Meta>}k{/Meta}");
    await user.click(screen.getByTestId("command-issue.status"));
    await user.click(screen.getByTestId("command-status.sta_done"));

    expect(run).toHaveBeenCalledWith(
      { kind: "run", action: "issue.status", value: "sta_done" },
      expect.objectContaining({ label: "Done" }),
    );
  });

  it("changes the theme itself — nothing else owns the preference", async () => {
    const user = userEvent.setup();
    mount();

    // The preference is broadcast rather than read back: `localStorage` is
    // absent under this runner, and `lib/theme` is written to survive that
    // (private mode does the same thing) by applying the change anyway.
    const seen: ThemeChangeDetail[] = [];
    const unsubscribe = subscribeToThemeChange((detail) => seen.push(detail));

    await runCommand(user, "Toggle theme");

    await waitFor(() => {
      expect(seen).toHaveLength(1);
    });
    unsubscribe();
    expect(seen[0]?.preference).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("opens the shortcuts sheet, which lives inside the surface", async () => {
    const user = userEvent.setup();
    mount();

    await runCommand(user, "Keyboard shortcuts");

    expect(screen.getByTestId("shortcuts-help")).toBeInTheDocument();
  });

  it("signs out and lands somewhere unauthenticated", async () => {
    const user = userEvent.setup();
    mount();

    await runCommand(user, "Sign out");

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/auth/signout", {
        method: "POST",
      });
    });
    await waitFor(() => {
      expect(routerMock.push).toHaveBeenCalledWith("/signin");
    });
  });

  it("collapses the rail, from the palette and from its key", async () => {
    const user = userEvent.setup();
    mount();

    const rail = () =>
      screen.getByTestId("sidebar").parentElement as HTMLElement;
    expect(rail()).toHaveAttribute("data-collapsed", "false");

    await runCommand(user, "Toggle sidebar");
    expect(rail()).toHaveAttribute("data-collapsed", "true");

    // `[`, not Cmd+B — and now registered on the shared dispatcher.
    //
    // Doubled: user-event reads `[` as the opener of a `[KeyCode]` descriptor,
    // so a lone bracket is a parse error rather than a keystroke. `[[` is how
    // the library spells a literal one.
    await user.keyboard("[[");
    expect(rail()).toHaveAttribute("data-collapsed", "false");
  });

  it("says so when nobody owns the command, rather than closing on nothing", async () => {
    const user = userEvent.setup();
    // A screen with no handler at all: the inbox, the settings pages.
    mount({ surface: "other" });

    await runCommand(user, "New issue");

    expect(
      await screen.findByText(/New issue is not available on this screen/i),
    ).toBeInTheDocument();
  });
});
