import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  PlaylistCard,
  PlaylistItemList,
  PlaylistPanel,
  SYSTEM_PLAYLIST_REASON,
  SaveToPlaylist,
  systemKind,
  type SaveTarget,
} from "@/components/playlist";
import { formatViewCount } from "@/domain/format";
import type { PlaylistKind, VideoCard } from "@/domain/types";

/**
 * Playlists.
 *
 * The rules under test are the ones the repository enforces by throwing, and
 * the point of every assertion here is that the **UI never lets a user reach
 * the throw**:
 *
 * * `watch_later` and `liked` cannot be renamed or deleted
 *   (`SystemPlaylistIsFixedError`);
 * * `liked` cannot be added to or removed from at all
 *   (`LikedPlaylistIsDerivedError`) — liking the video is its only door.
 *
 * Each of those surfaces as a **disabled** affordance carrying the reason, and
 * the tests assert the disabling rather than asserting an error message,
 * because an error message would mean the press already happened.
 *
 * The save sheet's own rule is separate and just as easy to get wrong: it
 * writes **on the toggle**, and there is no confirm step. R9 §9.3 measured the
 * checkbox-plus-Cancel/Save dialog out of existence; a test that only checked
 * "the row can be ticked" would pass against the old design.
 */

const NOW = new Date("2026-08-16T12:00:00Z");

function makeVideo(overrides: Partial<VideoCard> = {}): VideoCard {
  return {
    id: "v1",
    title: "Impossible Muons",
    channelId: "c1",
    channelName: "minutephysics",
    channelHandle: "minutephysics",
    channelAvatarKey: null,
    channelVerified: true,
    thumbnailKey: "videos/v1/thumb.jpg",
    previewKey: null,
    durationSeconds: 274,
    viewCount: 1_200_000,
    publishedAt: new Date("2019-08-16T12:00:00Z"),
    isShort: false,
    watchedSeconds: null,
    ...overrides,
  };
}

function okResponse(): Response {
  return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
}

/**
 * A 409 — what the repository actually returns for a refused mutation.
 *
 * Not a rejected promise. That distinction is the whole point of these tests:
 * `SystemPlaylistIsFixedError` and `LikedPlaylistIsDerivedError` come back as
 * perfectly well-formed HTTP responses, which a `.then()` with no `response.ok`
 * check treats as success. A test that simulated failure by throwing would pass
 * against code that only handles the network dropping.
 */
function failedResponse(): Response {
  return { ok: false, status: 409, json: async () => ({}) } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;
/** Where `router.push` was asked to go. See the `next/navigation` mock. */
let pushed: string[];

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (href: string) => {
      pushed.push(href);
    },
    refresh: () => undefined,
  }),
}));

beforeEach(() => {
  fetchMock = vi.fn(async () => okResponse());
  pushed = [];
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function bodyOf(call: unknown[]): Record<string, unknown> {
  const init = call[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

/* --------------------------------------------------------------- kinds --- */

describe("systemKind", () => {
  it("names the two fixed playlists and nothing else", () => {
    expect(systemKind("user")).toBeNull();
    expect(systemKind("watch_later")).toBe("watch_later");
    expect(systemKind("liked")).toBe("liked");
  });
});

/* --------------------------------------------------------------- panel --- */

describe("PlaylistPanel", () => {
  function renderPanel(kind: PlaylistKind, editable = true) {
    return render(
      <PlaylistPanel
        playlistId="pl1"
        title={kind === "watch_later" ? "Watch later" : "Party Songs"}
        ownerName="A Person"
        visibility="private"
        kind={kind}
        itemCount={22}
        viewCount={0}
        updatedLabel="Updated 4 days ago"
        editable={editable}
      />,
    );
  }

  async function openMenu(): Promise<HTMLElement> {
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Actions for/ }));
    return screen.getByRole("menu");
  }

  it("renders the measured stats line, with the playlist's own view count", () => {
    renderPanel("user");
    expect(screen.getByText("22 videos")).toBeInTheDocument();
    // R9 §8.2 captured «No views» on a playlist of heavily-watched videos, so
    // the number is the playlist's and this schema has none — the page passes
    // 0 and the formatter produces exactly the measured string.
    expect(screen.getByText(formatViewCount(0))).toBeInTheDocument();
    expect(formatViewCount(0)).toBe("No views");
    expect(screen.getByText("Updated 4 days ago")).toBeInTheDocument();
    expect(screen.getByText("Private")).toBeInTheDocument();
  });

  it("offers Rename and Delete on an ordinary playlist the viewer owns", async () => {
    renderPanel("user");
    const menu = await openMenu();
    expect(
      within(menu).getByRole("menuitem", { name: "Rename" }),
    ).not.toHaveAttribute("aria-disabled");
    expect(
      within(menu).getByRole("menuitem", { name: "Delete playlist" }),
    ).not.toHaveAttribute("aria-disabled");
    expect(
      within(menu).queryByText(SYSTEM_PLAYLIST_REASON.watch_later),
    ).toBeNull();
  });

  it("disables Rename and Delete on Watch later, and says why", async () => {
    renderPanel("watch_later");
    const menu = await openMenu();
    expect(within(menu).getByRole("menuitem", { name: "Rename" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(
      within(menu).getByRole("menuitem", { name: "Delete playlist" }),
    ).toHaveAttribute("aria-disabled", "true");
    // The reason is in the menu itself, not only in a `title` tooltip that no
    // keyboard or screen-reader user will ever see.
    expect(
      within(menu).getByText(SYSTEM_PLAYLIST_REASON.watch_later),
    ).toBeInTheDocument();
  });

  it("disables them on Liked videos too, with the liked-specific reason", async () => {
    renderPanel("liked");
    const menu = await openMenu();
    expect(within(menu).getByRole("menuitem", { name: "Rename" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(within(menu).getByText(SYSTEM_PLAYLIST_REASON.liked)).toBeInTheDocument();
  });

  it("never posts a delete for a system playlist, even if the row is pressed", async () => {
    const user = userEvent.setup();
    renderPanel("watch_later");
    const menu = await openMenu();
    await user.click(within(menu).getByRole("menuitem", { name: "Delete playlist" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("disables both rows for a playlist the viewer does not own", async () => {
    renderPanel("user", false);
    const menu = await openMenu();
    expect(within(menu).getByRole("menuitem", { name: "Rename" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("renames in place, posting the new title", async () => {
    const user = userEvent.setup();
    renderPanel("user");
    const menu = await openMenu();
    await user.click(within(menu).getByRole("menuitem", { name: "Rename" }));

    const field = screen.getByLabelText("Playlist name");
    await user.clear(field);
    await user.type(field, "Party Songs 2");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(bodyOf(fetchMock.mock.calls[0] ?? [])).toEqual({
      action: "rename",
      playlistId: "pl1",
      title: "Party Songs 2",
    });
  });

  /**
   * What a refused mutation leaves behind.
   *
   * Every mutation on this panel used to be `void fetch(...)` with no branch on
   * the response, so all three tests below passed against a UI that had simply
   * assumed success. The refusals are not hypothetical: `rename` and `delete`
   * on a system playlist are 409s the repository raises by design, and the menu
   * rows that trigger them are `disabled` rather than absent — which stops a
   * pointer and not a scripted click or a stale page.
   */
  it("puts the old title back when a rename is refused", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(failedResponse());
    renderPanel("user");
    const menu = await openMenu();
    await user.click(within(menu).getByRole("menuitem", { name: "Rename" }));

    const field = screen.getByLabelText("Playlist name");
    await user.clear(field);
    await user.type(field, "Something The Server Hates");
    await user.click(screen.getByRole("button", { name: "Save" }));

    // The form reopens on the *server's* title. `router.refresh()` alone could
    // not fix this — the fresh title arrives as a prop and `name` is state
    // seeded from it once, so the panel would show a rejected name until a
    // full reload.
    await expect
      .poll(() => screen.getByLabelText("Playlist name").getAttribute("value"))
      .toBe("Party Songs");
    expect(screen.getByRole("status")).toHaveTextContent("could not be saved");
  });

  it("does not navigate away when a delete is refused", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(failedResponse());
    renderPanel("user");
    const menu = await openMenu();
    await user.click(within(menu).getByRole("menuitem", { name: "Delete playlist" }));

    // Leaving for the library from a playlist that still exists is worse than
    // doing nothing: the playlist reappears in that fresh server render, which
    // reads as the delete having been undone by something.
    await expect
      .poll(() => screen.queryByRole("status")?.textContent ?? "")
      .toContain("could not be deleted");
    expect(pushed).toEqual([]);
  });

  it("navigates away when a delete succeeds", async () => {
    // The other half — without it the test above passes against a Delete that
    // never navigates at all.
    const user = userEvent.setup();
    renderPanel("user");
    const menu = await openMenu();
    await user.click(within(menu).getByRole("menuitem", { name: "Delete playlist" }));

    await expect.poll(() => pushed).toEqual(["/feed/playlists"]);
  });

  it("greys Play all and Shuffle out on an empty playlist", () => {
    render(
      <PlaylistPanel
        playlistId="pl1"
        title="Empty"
        ownerName="A Person"
        visibility="private"
        kind="user"
        itemCount={0}
        viewCount={0}
        updatedLabel="Updated 1 day ago"
        playAllHref={null}
        shuffleHref={null}
      />,
    );
    expect(screen.getByRole("link", { name: /Play all/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("link", { name: /Shuffle/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});

/* ---------------------------------------------------------------- list --- */

describe("PlaylistItemList", () => {
  const items = [
    makeVideo({ id: "v1", title: "First" }),
    makeVideo({ id: "v2", title: "Second" }),
    makeVideo({ id: "v3", title: "Third" }),
  ];

  it("numbers the rows from one and links each into the playlist", () => {
    render(
      <PlaylistItemList playlistId="pl1" kind="user" items={items} now={NOW} />,
    );
    const indices = Array.from(
      document.querySelectorAll("[data-playlist-index]"),
    ).map((node) => node.textContent);
    expect(indices).toEqual(["1", "2", "3"]);
    expect(screen.getByRole("link", { name: "First" })).toHaveAttribute(
      "href",
      "/watch?v=v1&list=pl1",
    );
  });

  it("uses the shared history-density lockup rather than a sixth card", () => {
    render(
      <PlaylistItemList playlistId="pl1" kind="user" items={items} now={NOW} />,
    );
    const rows = document.querySelectorAll("[data-video-row]");
    expect(rows).toHaveLength(3);
    expect(rows[0]?.getAttribute("data-density")).toBe("history");
  });

  it("offers no row menu at all to a viewer who does not own the playlist", () => {
    render(
      <PlaylistItemList playlistId="pl1" kind="user" items={items} now={NOW} />,
    );
    expect(screen.queryByRole("button", { name: /^Actions for/ })).toBeNull();
  });

  it("removes a row and posts it, on a playlist that allows it", async () => {
    const user = userEvent.setup();
    render(
      <PlaylistItemList
        playlistId="pl1"
        kind="user"
        items={items}
        editable
        now={NOW}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Actions for Second" }));
    await user.click(
      screen.getByRole("menuitem", { name: "Remove from playlist" }),
    );

    expect(bodyOf(fetchMock.mock.calls[0] ?? [])).toEqual({
      action: "remove",
      playlistId: "pl1",
      videoId: "v2",
    });
    expect(screen.queryByRole("link", { name: "Second" })).toBeNull();
    // And the surviving rows renumber, which is what an `<ol>` of positions
    // has to do.
    expect(
      Array.from(document.querySelectorAll("[data-playlist-index]")).map(
        (node) => node.textContent,
      ),
    ).toEqual(["1", "2"]);
  });

  it("puts the row back when the removal is refused", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(failedResponse());
    render(
      <PlaylistItemList
        playlistId="pl1"
        kind="user"
        items={items}
        editable
        now={NOW}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Actions for Second" }));
    await user.click(
      screen.getByRole("menuitem", { name: "Remove from playlist" }),
    );

    // A row that vanished and stayed vanished while still being in the playlist
    // is the version of this bug that costs data on the *next* visit rather
    // than now — the viewer believes it is gone and does not remove it again.
    await expect
      .poll(() => screen.queryByRole("link", { name: "Second" }) !== null)
      .toBe(true);
    expect(
      Array.from(document.querySelectorAll("[data-playlist-index]")).map(
        (node) => node.textContent,
      ),
    ).toEqual(["1", "2", "3"]);
  });

  it("disables Remove on the liked playlist instead of letting it throw", async () => {
    const user = userEvent.setup();
    render(
      <PlaylistItemList
        playlistId="pl-liked"
        kind="liked"
        items={items}
        editable
        now={NOW}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Actions for First" }));
    const menu = screen.getByRole("menu");
    const remove = within(menu).getByRole("menuitem", {
      name: "Remove from playlist",
    });
    expect(remove).toHaveAttribute("aria-disabled", "true");
    expect(within(menu).getByText(SYSTEM_PLAYLIST_REASON.liked)).toBeInTheDocument();

    await user.click(remove);
    // `playlists.removeVideo` would have thrown `LikedPlaylistIsDerivedError`;
    // the request is never made and the row is still there.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "First" })).toBeInTheDocument();
  });

  it("says so when the playlist is empty", () => {
    render(<PlaylistItemList playlistId="pl1" kind="user" items={[]} />);
    expect(document.querySelector("[data-playlist-empty]")).not.toBeNull();
  });
});

/* ---------------------------------------------------------------- card --- */

describe("PlaylistCard", () => {
  it("renders the measured three metadata rows and the count badge", () => {
    render(
      <PlaylistCard
        href="/playlist?list=pl1"
        title="Party Songs"
        itemCount={27}
        visibility="public"
        kind="user"
        updatedLabel="Updated 5 days ago"
      />,
    );
    expect(screen.getByText("27 videos")).toBeInTheDocument();
    expect(screen.getByText("Public")).toBeInTheDocument();
    expect(screen.getByText("Updated 5 days ago")).toBeInTheDocument();
    expect(screen.getByText("View full playlist")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Party Songs" })).toHaveAttribute(
      "href",
      "/playlist?list=pl1",
    );
  });

  it("drops the Updated row when there is none — R9 §8.1 has it on owned lists only", () => {
    render(
      <PlaylistCard
        href="/playlist?list=pl1"
        title="Someone else's"
        itemCount={5}
        visibility="public"
        kind="user"
      />,
    );
    expect(document.querySelector("[data-playlist-card-updated]")).toBeNull();
  });

  it("uses the singular noun for a one-video playlist", () => {
    render(
      <PlaylistCard
        href="/playlist?list=pl1"
        title="One"
        itemCount={1}
        visibility="private"
        kind="user"
      />,
    );
    expect(screen.getByText("1 video")).toBeInTheDocument();
  });
});

/* ------------------------------------------------------- the save sheet --- */

describe("SaveToPlaylist", () => {
  const targets: SaveTarget[] = [
    {
      id: "pl-wl",
      title: "Watch later",
      kind: "watch_later",
      visibility: "private",
      saved: false,
    },
    {
      id: "pl-1",
      title: "Party Songs",
      kind: "user",
      visibility: "public",
      saved: true,
    },
    {
      id: "pl-liked",
      title: "Liked videos",
      kind: "liked",
      visibility: "private",
      saved: false,
    },
  ];

  async function open(): Promise<HTMLElement> {
    const user = userEvent.setup();
    render(<SaveToPlaylist videoId="v1" playlists={targets} />);
    await user.click(screen.getByRole("button", { name: "Save" }));
    return screen.getByRole("dialog");
  }

  it("opens a contextual sheet — a dialog with no scrim and no `aria-modal`", async () => {
    const sheet = await open();
    expect(sheet).toHaveAttribute("aria-labelledby");
    // R9 §9.3: `ytSheetViewModelContextual` in a `tp-yt-iron-dropdown`, no
    // scrim. The page behind stays operable, so claiming modality would be
    // false.
    expect(sheet).not.toHaveAttribute("aria-modal");
    expect(within(sheet).getByRole("heading", { name: "Save to..." })).toBeInTheDocument();
  });

  it("has no confirm step — the footer is an action, not a commit", async () => {
    const sheet = await open();
    // The old design was a checkbox list with Cancel and Save in the footer.
    // R9 §9.3 and §14 record that it is gone; this fails if it comes back.
    expect(within(sheet).queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(within(sheet).queryByRole("button", { name: /^Save$/ })).toBeNull();
    expect(
      within(sheet).getByRole("button", { name: "New playlist" }),
    ).toBeInTheDocument();
  });

  it("writes immediately when a row is toggled on", async () => {
    const user = userEvent.setup();
    const sheet = await open();

    const row = within(sheet).getByRole("menuitemcheckbox", { name: /Watch later/ });
    expect(row).toHaveAttribute("aria-checked", "false");
    await user.click(row);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] ?? [];
    expect(call[0]).toBe("/api/playlists");
    expect(bodyOf(call)).toEqual({
      action: "add",
      playlistId: "pl-wl",
      videoId: "v1",
    });
    expect(
      within(sheet).getByRole("menuitemcheckbox", { name: /Watch later/ }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("writes immediately when a row is toggled off", async () => {
    const user = userEvent.setup();
    const sheet = await open();

    const row = within(sheet).getByRole("menuitemcheckbox", { name: /Party Songs/ });
    expect(row).toHaveAttribute("aria-checked", "true");
    await user.click(row);

    expect(bodyOf(fetchMock.mock.calls[0] ?? [])).toEqual({
      action: "remove",
      playlistId: "pl-1",
      videoId: "v1",
    });
  });

  it("fills the bookmark rather than ticking a checkbox", async () => {
    const user = userEvent.setup();
    const sheet = await open();

    const row = within(sheet).getByRole("menuitemcheckbox", { name: /Watch later/ });
    expect(row.querySelector("[data-bookmark]")?.getAttribute("data-bookmark")).toBe(
      "outline",
    );
    await user.click(row);
    expect(
      within(sheet)
        .getByRole("menuitemcheckbox", { name: /Watch later/ })
        .querySelector("[data-bookmark]")
        ?.getAttribute("data-bookmark"),
    ).toBe("filled");
  });

  it("puts the row back and says so when the write fails", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({}),
    } as unknown as Response);

    const sheet = await open();
    await user.click(
      within(sheet).getByRole("menuitemcheckbox", { name: /Watch later/ }),
    );

    expect(
      within(sheet).getByRole("menuitemcheckbox", { name: /Watch later/ }),
    ).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("status")).toHaveTextContent("Could not update");
  });

  it("renders the liked playlist as an inoperable row carrying the reason", async () => {
    const user = userEvent.setup();
    const sheet = await open();

    // Not a toggle: `playlists.addVideo` throws `LikedPlaylistIsDerivedError`
    // for this list, so offering a switch would be offering a failure.
    expect(
      within(sheet).queryByRole("menuitemcheckbox", { name: /Liked videos/ }),
    ).toBeNull();
    const row = sheet.querySelector('[data-save-row="liked"]');
    expect(row).not.toBeNull();
    expect(row).toHaveAttribute("aria-disabled", "true");
    expect(within(sheet).getByText(SYSTEM_PLAYLIST_REASON.liked)).toBeInTheDocument();

    await user.click(row as Element);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("explains itself to a signed-out viewer instead of showing an empty list", async () => {
    const user = userEvent.setup();
    render(<SaveToPlaylist videoId="v1" playlists={targets} signedIn={false} />);
    await user.click(screen.getByRole("button", { name: "Save" }));

    const sheet = screen.getByRole("dialog");
    expect(sheet.querySelector("[data-save-signed-out]")).not.toBeNull();
    expect(
      within(sheet).queryByRole("menuitemcheckbox"),
    ).toBeNull();
  });
});
