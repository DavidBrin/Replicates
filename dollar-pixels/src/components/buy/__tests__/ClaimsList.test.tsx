import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { SnapshotClaim } from "@/domain/snapshot";
import { ClaimsList } from "@/components/buy/ClaimsList";

function claim(id: string, over: Partial<SnapshotClaim> = {}): SnapshotClaim {
  return {
    id,
    rect: { bx: 1, by: 2, bw: 3, bh: 4 },
    caption: `caption ${id}`,
    colour: "#1f9d2f",
    tile: null,
    ownerName: "Ada",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("ClaimsList", () => {
  it("says plainly when a page is untouched", () => {
    render(<ClaimsList claims={[]} />);
    expect(screen.getByText(/nothing has been bought/i)).toBeInTheDocument();
  });

  it("renders one row per claim with its size, position and price", () => {
    render(<ClaimsList claims={[claim("a")]} />);

    const row = screen.getByRole("row", { name: /caption a/i });
    expect(row).toHaveTextContent("Ada");
    expect(row).toHaveTextContent("12"); // 3 x 4 blocks
    expect(row).toHaveTextContent("3 × 4 at 1, 2");
    expect(row).toHaveTextContent("$12");
  });

  it("activates a claim from the keyboard, without the canvas", async () => {
    const onActivate = vi.fn();
    render(<ClaimsList claims={[claim("a")]} onActivate={onActivate} />);

    await userEvent.tab();
    await userEvent.keyboard("{Enter}");

    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
  });

  it("marks the claim the page is showing", () => {
    render(<ClaimsList claims={[claim("a"), claim("b")]} activeId="b" />);

    // Matched on content rather than accessible name: every row in a table
    // computes the same name from the table's own text, so a name query here
    // is ambiguous by construction.
    const rows = screen
      .getAllByRole("row")
      .filter((row) => row.textContent?.includes("caption b"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute("aria-current", "true");
  });

  it("pages long lists rather than rendering thousands of rows", async () => {
    const many = Array.from({ length: 150 }, (_, i) => claim(`c${i}`));
    render(<ClaimsList claims={many} />);

    expect(screen.getAllByRole("row")).toHaveLength(101); // header + 100
    expect(screen.getByText(/showing 100 of 150 claims/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /show 50 more/i }));
    expect(screen.getAllByRole("row")).toHaveLength(151);
  });
});
