import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { User } from "@/domain/entities";
import type { BlockRect, GridDims } from "@/domain/geometry";
import { ApiError } from "@/lib/api-client";
import { BuyPanel } from "@/components/buy/BuyPanel";

const buyBlocks = vi.fn();
const claimFree = vi.fn();

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    api: {
      buyBlocks: (...args: unknown[]) => buyBlocks(...args),
      claimFree: (...args: unknown[]) => claimFree(...args),
    },
  };
});

const DIMS: GridDims = { wBlocks: 400, hBlocks: 400 };
const SELECTION: BlockRect = { bx: 10, by: 20, bw: 4, bh: 3 };

const USER: User = {
  id: "usr_1",
  handle: "ada",
  displayName: "Ada",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function setup(overrides: Partial<React.ComponentProps<typeof BuyPanel>> = {}) {
  const props = {
    slug: "the-wall",
    dims: DIMS,
    selection: SELECTION as BlockRect | null,
    onSelectionChange: vi.fn(),
    user: USER as User | null,
    isOwner: false,
    allowance: null,
    onClaimed: vi.fn(),
    onRedirect: vi.fn(),
    ...overrides,
  };
  render(<BuyPanel {...props} />);
  return props;
}

beforeEach(() => {
  buyBlocks.mockReset();
  claimFree.mockReset();
});

describe("BuyPanel", () => {
  it("prices the selection in blocks, pixels and dollars", () => {
    setup();
    expect(screen.getByTestId("selection-summary")).toHaveTextContent(
      "12 blocks · 108 pixels · $12",
    );
  });

  it("counts the caption down as it is typed", async () => {
    setup();
    await userEvent.type(screen.getByLabelText(/caption/i), "hello");
    expect(screen.getByLabelText(/caption \(5\/60\)/i)).toBeInTheDocument();
  });

  it("sends the rectangle and artwork, and follows the provider's redirect", async () => {
    buyBlocks.mockResolvedValue({
      orderId: "ord_1",
      amountCents: 1200,
      redirectUrl: "/checkout/mock/ord_1",
    });
    const props = setup();

    await userEvent.type(screen.getByLabelText(/caption/i), "Ada was here");
    await userEvent.click(screen.getByRole("button", { name: /buy for \$12/i }));

    await waitFor(() => expect(props.onRedirect).toHaveBeenCalledWith("/checkout/mock/ord_1"));
    expect(buyBlocks).toHaveBeenCalledWith("the-wall", {
      rect: SELECTION,
      caption: "Ada was here",
      colour: "#c0182b",
      tile: null,
    });
  });

  it("never sends a price", async () => {
    buyBlocks.mockResolvedValue({ orderId: "o", amountCents: 1200, redirectUrl: "/x" });
    setup();

    await userEvent.type(screen.getByLabelText(/caption/i), "no amount here");
    await userEvent.click(screen.getByRole("button", { name: /buy for/i }));

    await waitFor(() => expect(buyBlocks).toHaveBeenCalled());
    const body = buyBlocks.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["caption", "colour", "rect", "tile"]);
  });

  it("shows the server's own message when a purchase is refused", async () => {
    buyBlocks.mockRejectedValue(
      new ApiError(
        "unavailable",
        "Some of those blocks have just been taken. Refresh and pick again.",
        409,
      ),
    );
    setup();

    await userEvent.type(screen.getByLabelText(/caption/i), "mine");
    await userEvent.click(screen.getByRole("button", { name: /buy for/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Some of those blocks have just been taken. Refresh and pick again.",
    );
  });

  it("refuses an empty caption before it costs a round trip", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /buy for/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/give your blocks a caption/i);
    expect(buyBlocks).not.toHaveBeenCalled();
  });

  it("offers the allowance to a page's owner and says how much is left", () => {
    setup({ isOwner: true, allowance: { total: 69, used: 4 } });
    expect(screen.getByRole("button", { name: /use a free block/i })).toBeInTheDocument();
    expect(screen.getByText(/65 of 69 free blocks left/i)).toBeInTheDocument();
  });

  it("hides the allowance button once it is spent, but still says so", () => {
    setup({ isOwner: true, allowance: { total: 69, used: 69 } });
    expect(screen.queryByRole("button", { name: /use a free block/i })).toBeNull();
    expect(screen.getByText(/0 of 69 free blocks left/i)).toBeInTheDocument();
  });

  it("offers nothing free to someone who does not own the page", () => {
    setup({ isOwner: false, allowance: null });
    expect(screen.queryByRole("button", { name: /use a free block/i })).toBeNull();
  });

  it("claims free blocks and asks the page to refetch", async () => {
    claimFree.mockResolvedValue({ orderId: "ord_free", claimId: "clm_1" });
    const props = setup({ isOwner: true, allowance: { total: 69, used: 0 } });

    await userEvent.type(screen.getByLabelText(/caption/i), "on the house");
    await userEvent.click(screen.getByRole("button", { name: /use a free block/i }));

    await waitFor(() => expect(props.onClaimed).toHaveBeenCalled());
    expect(claimFree).toHaveBeenCalledWith("the-wall", expect.objectContaining({
      rect: SELECTION,
      caption: "on the house",
    }));
    expect(props.onSelectionChange).toHaveBeenCalledWith(null);
  });

  it("prompts a signed-out visitor to sign in without hiding the panel", () => {
    setup({ user: null });
    expect(screen.queryByRole("button", { name: /buy for/i })).toBeNull();
    expect(screen.getByText(/anyone can sign in as any name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/caption/i)).toBeInTheDocument();
    expect(screen.getByTestId("selection-summary")).toBeInTheDocument();
  });

  it("selects by typed coordinates, for anyone who cannot drag", async () => {
    const props = setup({ selection: null });

    await userEvent.click(screen.getByText(/select by coordinates/i));
    await userEvent.clear(screen.getByLabelText("X"));
    await userEvent.type(screen.getByLabelText("X"), "5");
    await userEvent.clear(screen.getByLabelText("Width"));
    await userEvent.type(screen.getByLabelText("Width"), "3");
    await userEvent.click(screen.getByRole("button", { name: /set selection/i }));

    expect(props.onSelectionChange).toHaveBeenCalledWith({ bx: 5, by: 0, bw: 3, bh: 1 });
  });

  it("rejects coordinates that fall outside the grid", async () => {
    const props = setup({ selection: null, dims: { wBlocks: 120, hBlocks: 120 } });

    await userEvent.click(screen.getByText(/select by coordinates/i));
    await userEvent.clear(screen.getByLabelText("X"));
    await userEvent.type(screen.getByLabelText("X"), "500");
    await userEvent.click(screen.getByRole("button", { name: /set selection/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/not on this grid/i);
    expect(props.onSelectionChange).not.toHaveBeenCalled();
  });
});
