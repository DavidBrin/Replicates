import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { VideoTable, type StudioVideoRow } from "../video-table";
import type { ClaimView } from "../upload-machine";

/**
 * Studio's content table.
 *
 * The four `upload_status` values are the reason this table exists at all —
 * every public feed filters on `ready`, so this is the only surface in the
 * application where the other three are visible. Each therefore gets its own
 * assertion rather than one "renders rows" test.
 */

function row(overrides: Partial<StudioVideoRow> = {}): StudioVideoRow {
  return {
    id: "vid00000001",
    title: "A video",
    description: "",
    thumbnailUrl: null,
    durationSeconds: 125,
    visibility: "public",
    uploadStatus: "ready",
    pipeline: "laddered",
    viewCount: 1234,
    commentCount: 7,
    publishedAt: new Date("2026-08-10T12:00:00Z"),
    createdAt: new Date("2026-08-09T12:00:00Z"),
    claims: [],
    ...overrides,
  };
}

function claim(overrides: Partial<ClaimView> = {}): ClaimView {
  return {
    id: "clm-1",
    policy: "block",
    status: "active",
    matchStartMs: 0,
    matchEndMs: 5000,
    referenceOffsetMs: 0,
    score: 90,
    referenceTitle: "Night Drive",
    rightsHolder: "Kestrel Records",
    ...overrides,
  };
}

describe("VideoTable — the four upload states", () => {
  it("shows an incomplete upload as incomplete, with a way out of it", async () => {
    const onDiscard = vi.fn();
    render(
      <VideoTable
        videos={[row({ uploadStatus: "uploading", publishedAt: null })]}
        onDiscard={onDiscard}
      />,
    );

    // The resumability decision made visible: the row survives an abandoned
    // tab, says the encode cannot be resumed, and offers Delete.
    expect(screen.getByText("Upload incomplete")).toBeInTheDocument();
    expect(screen.getByText(/cannot be resumed/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDiscard).toHaveBeenCalledWith("vid00000001");
  });

  it("says a processed video is waiting for its author, not for a server", () => {
    // D1: there is no transcode queue. Copying YouTube's "Processing…" here
    // would describe a subsystem this project deliberately does not have.
    render(<VideoTable videos={[row({ uploadStatus: "processing" })]} />);
    expect(screen.getByText("Ready to publish")).toBeInTheDocument();
    expect(
      screen.getByText(/nothing is being transcoded on a server/),
    ).toBeInTheDocument();
  });

  it("offers a delete on a failed upload too", () => {
    render(<VideoTable videos={[row({ uploadStatus: "failed" })]} onDiscard={vi.fn()} />);
    expect(screen.getByText("Upload failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("shows counts only for a published row", () => {
    // A `0` next to a published `0` would be the same glyph for two different
    // facts: "nobody watched it" and "it is not watchable".
    const { unmount } = render(
      <VideoTable videos={[row({ uploadStatus: "uploading", publishedAt: null })]} />,
    );
    expect(screen.getAllByText("—")).toHaveLength(2);
    unmount();

    render(<VideoTable videos={[row()]} />);
    expect(screen.getByText(/1.2K views/)).toBeInTheDocument();
  });

  it("marks the progressive pipeline as the single quality it is", () => {
    render(<VideoTable videos={[row({ pipeline: "progressive" })]} />);
    expect(screen.getByText(/single quality/)).toBeInTheDocument();
  });

  it("says so when there is nothing at all", () => {
    render(<VideoTable videos={[]} />);
    expect(screen.getByText(/No content yet/)).toBeInTheDocument();
  });
});

describe("VideoTable — the Notices column", () => {
  it("counts live claims in the second column and expands to the detail", async () => {
    render(
      <VideoTable
        videos={[row({ claims: [claim(), claim({ id: "clm-2", policy: "track" })] })]}
        onDispute={vi.fn()}
      />,
    );

    const notices = screen.getByRole("button", { name: /2 copyright claims/ });
    expect(notices).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(notices);
    expect(screen.getByTestId("claims-list")).toBeInTheDocument();
    expect(within(screen.getByTestId("claims-list")).getAllByRole("article")).toHaveLength(2);
  });

  it("does not count a released claim against the video", () => {
    // A released claim is history, not a notice. Counting it would keep a
    // resolved dispute permanently on the row.
    render(<VideoTable videos={[row({ claims: [claim({ status: "released" })] })]} />);
    expect(screen.getByText("None")).toBeInTheDocument();
  });

  it("passes the dispute handler down to the expanded claim", async () => {
    const onDispute = vi.fn();
    render(<VideoTable videos={[row({ claims: [claim()] })]} onDispute={onDispute} />);

    await userEvent.click(screen.getByRole("button", { name: /1 copyright claim/ }));
    await userEvent.click(screen.getByRole("button", { name: /Dispute/ }));
    expect(onDispute).toHaveBeenCalledWith("clm-1");
  });
});

describe("VideoTable — the header", () => {
  it("marks the sorted column and re-sorts on click", async () => {
    const videos = [
      row({ id: "old00000001", title: "Older", viewCount: 9000, publishedAt: new Date("2026-01-01") }),
      row({ id: "new00000001", title: "Newer", viewCount: 5, publishedAt: new Date("2026-08-01") }),
    ];
    render(<VideoTable videos={videos} />);

    // Date is the default sort — §12.3 measured the Date column sorted, with
    // its label at weight 700 and a ↓ glyph.
    const dateHeader = screen.getByRole("columnheader", { name: /Date/ });
    expect(dateHeader).toHaveAttribute("aria-sort", "descending");
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("Newer");

    await userEvent.click(screen.getByRole("button", { name: /Views/ }));
    expect(screen.getByRole("columnheader", { name: /Views/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("Older");
  });

  it("names the columns in the measured order, Notices second", () => {
    // §12.3's x-origins put Notices immediately after Video. A claim the owner
    // has to go looking for is a claim they hear about from a viewer.
    render(<VideoTable videos={[row()]} />);
    expect(
      screen.getAllByRole("columnheader").map((header) => header.textContent),
    ).toEqual(["Video", "Notices", "Visibility", "Date", "Views", "Comments"]);
  });
});
