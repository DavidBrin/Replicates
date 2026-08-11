import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { User } from "@/domain/entities";
import { ApiError } from "@/lib/api-client";
import { SignInBar } from "@/components/buy/SignInBar";

const signIn = vi.fn();
const signOut = vi.fn();

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    api: {
      signIn: (...args: unknown[]) => signIn(...args),
      signOut: (...args: unknown[]) => signOut(...args),
    },
  };
});

const USER: User = {
  id: "usr_1",
  handle: "ada",
  displayName: "Ada",
  createdAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  signIn.mockReset();
  signOut.mockReset();
});

describe("SignInBar", () => {
  it("signs in with a name and nothing else", async () => {
    signIn.mockResolvedValue({ user: USER });
    const onChange = vi.fn();
    render(<SignInBar user={null} onChange={onChange} />);

    await userEvent.type(screen.getByLabelText(/display name/i), "Ada");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(USER));
    expect(signIn).toHaveBeenCalledWith("Ada");
    expect(screen.queryByLabelText(/password/i)).toBeNull();
  });

  it("is honest that the name proves nothing", () => {
    render(<SignInBar user={null} onChange={vi.fn()} />);
    expect(screen.getByText(/anyone can sign in as any name/i)).toBeInTheDocument();
  });

  it("shows the current user and signs out", async () => {
    signOut.mockResolvedValue({ signedOut: true });
    const onChange = vi.fn();
    render(<SignInBar user={USER} onChange={onChange} />);

    expect(screen.getByText("Ada")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(null));
  });

  it("shows the server's message when sign-in fails", async () => {
    signIn.mockRejectedValue(new ApiError("invalid", "Give yourself a name.", 422));
    render(<SignInBar user={null} onChange={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/display name/i), "  x  ");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Give yourself a name.");
  });

  it("does not call the server with an empty name", async () => {
    render(<SignInBar user={null} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(signIn).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(/type a name/i);
  });
});
