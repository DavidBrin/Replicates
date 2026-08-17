import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Claims } from "../claims";
import type { ClaimView } from "../upload-machine";

/**
 * The claims view.
 *
 * D12 calls Content ID "the one YouTube subsystem nobody clones", so the thing
 * worth asserting is not that a component renders — it is that the four facts
 * an uploader needs are all present and are not confused with one another. The
 * two that a reimplementation most plausibly gets wrong on its own:
 *
 *  - **"not checked" is not "nothing found"**, and
 *  - the two timestamps are in **different timelines**.
 */

function claim(overrides: Partial<ClaimView> = {}): ClaimView {
  return {
    id: "clm-1",
    policy: "monetise",
    status: "active",
    // 1:05 → 2:30 in this video, matching the reference from 0:10.
    matchStartMs: 65_000,
    matchEndMs: 150_000,
    referenceOffsetMs: 10_000,
    score: 412,
    referenceTitle: "Night Drive",
    rightsHolder: "Kestrel Records",
    ...overrides,
  };
}

describe("Claims — the three empty states are three different sentences", () => {
  it("says the check is still running while it is", () => {
    render(<Claims claims={[]} scanned={null} />);
    expect(screen.getByText(/Checking this video/)).toBeInTheDocument();
  });

  it("distinguishes 'did not run' from 'found nothing'", () => {
    const { unmount } = render(<Claims claims={[]} scanned={false} />);
    // The distinction is the point: a video whose audio could not be decoded
    // and a video with no matches count the same number of rows.
    expect(screen.getByText(/did not run/)).toBeInTheDocument();
    expect(screen.queryByText(/No copyright matches/)).not.toBeInTheDocument();
    unmount();

    render(<Claims claims={[]} scanned />);
    expect(screen.getByText(/No copyright matches/)).toBeInTheDocument();
  });
});

describe("Claims — a claim states what it is and what happens next", () => {
  it("names the reference, the holder and the consequence of the policy", () => {
    render(<Claims claims={[claim()]} scanned />);

    expect(screen.getByText("Night Drive")).toBeInTheDocument();
    expect(screen.getByText("Kestrel Records")).toBeInTheDocument();
    expect(
      screen.getByText(/revenue goes to the rights holder/),
    ).toBeInTheDocument();
  });

  it("writes each policy out rather than relying on a colour", () => {
    const claims = [
      claim({ id: "a", policy: "block" }),
      claim({ id: "b", policy: "monetise" }),
      claim({ id: "c", policy: "track" }),
    ];
    render(<Claims claims={claims} scanned />);

    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByText("Monetised by the rights holder")).toBeInTheDocument();
    expect(screen.getByText("Tracked")).toBeInTheDocument();
  });

  it("shows the matched span and the reference offset as different numbers", () => {
    // `match_start_ms` is in the upload's timeline; `reference_offset_ms` is in
    // the work's. Rendering one for both is the defect this catches.
    render(<Claims claims={[claim()]} scanned />);

    expect(screen.getByText("1:05 – 2:30")).toBeInTheDocument();
    expect(screen.getByText("from 0:10")).toBeInTheDocument();
  });

  it("labels the score as the count it is", () => {
    // research/06 §2.3 defines the score as a number of matching, time-aligned
    // hash tokens — not a percentage, and not a confidence.
    render(<Claims claims={[claim()]} scanned />);
    expect(screen.getByText("Matching segments")).toBeInTheDocument();
    expect(screen.getByText("412")).toBeInTheDocument();
  });

  it("renders the policy the claim carries, not one derived at read time", () => {
    // `content-id.ts` copies the policy onto the claim so that changing a
    // work's default cannot rewrite the terms of a claim already raised.
    render(<Claims claims={[claim({ policy: "block" })]} scanned />);
    expect(
      screen.getByRole("article").getAttribute("data-claim-policy"),
    ).toBe("block");
  });
});

describe("Claims — the dispute affordance", () => {
  it("offers a dispute on an active claim and reports it back", async () => {
    const onDispute = vi.fn().mockResolvedValue(undefined);
    render(<Claims claims={[claim()]} scanned onDispute={onDispute} />);

    await userEvent.click(screen.getByRole("button", { name: /Dispute/ }));
    expect(onDispute).toHaveBeenCalledWith("clm-1");
  });

  it("does not offer one twice — a disputed claim shows its status instead", () => {
    render(
      <Claims claims={[claim({ status: "disputed" })]} scanned onDispute={vi.fn()} />,
    );

    expect(screen.getByText("Dispute under review")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Dispute/ })).not.toBeInTheDocument();
  });

  it("renders read-only when no handler is supplied", () => {
    // A surface that shows claims without being the owner's Studio must not
    // draw a button that does nothing.
    render(<Claims claims={[claim()]} scanned />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
