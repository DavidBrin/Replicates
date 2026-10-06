/**
 * `/play/solo` and `/play/pass-and-play`'s shell (SPEC §5.1, §7).
 *
 * The one thing worth asserting here that no other suite covers: the seat the
 * viewer plays carries the **display name the identity sheet claimed**, not
 * the `You` placeholder the setup store starts with.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { IDENTITY_KEY } from "@/adapters/localStorage/identity";
import { installMemoryStorage } from "@/adapters/localStorage/testStorage";
import { playMapSlugs } from "@/game/pending";
import { sessionConfigStore } from "@/game/sessionConfig";

import { PlayPage } from "./PlayPage";

function configureSolo(): void {
  const store = sessionConfigStore.getState();
  store.reset();
  store.setMode("solo");
  store.setSeatCount(2);
  store.setSource({ kind: "slug", slug: playMapSlugs()[0] as string });
  store.setReady(true);
}

beforeEach(() => {
  installMemoryStorage();
});

describe("PlayPage", () => {
  it("gives the viewer's seat the cached display name", async () => {
    window.localStorage.setItem(
      IDENTITY_KEY,
      JSON.stringify({ displayName: "Northern Warden 21", colour: "red" }),
    );
    configureSolo();
    render(<PlayPage mode="solo" />);

    const row = await screen.findByTestId("roster-row-0", undefined, { timeout: 5000 });
    await waitFor(() => expect(row).toHaveAttribute("aria-label", "Northern Warden 21"));
    // …and the avatar initial follows the name, skipping the generated number.
    expect(row.querySelector('[data-testid="avatar-disc"]')).toHaveTextContent("NW");
  });

  it("keeps the placeholder when no identity has been claimed", async () => {
    configureSolo();
    render(<PlayPage mode="solo" />);
    const row = await screen.findByTestId("roster-row-0", undefined, { timeout: 5000 });
    await waitFor(() => expect(row).toHaveAttribute("aria-label", "You"));
  });
});
