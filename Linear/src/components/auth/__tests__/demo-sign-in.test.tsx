import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DemoSignIn } from "@/components/auth/demo-sign-in";
import { routerMock } from "../../../../vitest.setup";

/**
 * The demo-account chooser — what `/signin` actually mounts.
 *
 * This is the whole sign-in surface now: no typable fields, no sign-up link,
 * just one button per seeded account. What matters is that a click posts the
 * seeded credentials the same way the archived form did (so the `httpOnly`
 * cookie is set the way the rest of the app expects) and then navigates with
 * `replace` + `refresh`.
 */

const ACCOUNTS = [
  { email: "owner@demo.test", label: "Owner", role: "all three teams" },
  { email: "guest@demo.test", label: "Guest", role: "Engineering only" },
] as const;

const originalFetch = global.fetch;

function mockFetch(response: {
  ok: boolean;
  status?: number;
  body?: unknown;
}): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async () => ({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 401),
    json: async () => response.body ?? {},
  }));
  global.fetch = spy as unknown as typeof fetch;
  return spy;
}

beforeEach(() => {
  routerMock.replace.mockClear();
  routerMock.refresh.mockClear();
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("DemoSignIn", () => {
  it("renders one button per seeded account, with its label and role", () => {
    render(<DemoSignIn demoAccounts={ACCOUNTS} demoPassword="demo1234" />);
    const owner = screen.getByTestId("demo-signin-owner");
    expect(owner).toHaveTextContent("Owner");
    expect(owner).toHaveTextContent("all three teams");
    expect(screen.getByTestId("demo-signin-guest")).toBeInTheDocument();
  });

  it("posts the seeded credentials and navigates on success", async () => {
    const user = userEvent.setup();
    const fetchSpy = mockFetch({ ok: true, body: {} });
    render(
      <DemoSignIn redirectTo="/" demoAccounts={ACCOUNTS} demoPassword="demo1234" />,
    );

    await user.click(screen.getByTestId("demo-signin-owner"));

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/auth/signin",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(
      String((fetchSpy.mock.calls[0]?.[1] as { body: string }).body),
    );
    expect(body).toEqual({ email: "owner@demo.test", password: "demo1234" });

    // `replace`, not `push`, then a refresh so the server re-reads the cookie.
    expect(routerMock.replace).toHaveBeenCalledWith("/");
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it("shows an error and does not navigate when the server refuses", async () => {
    const user = userEvent.setup();
    mockFetch({
      ok: false,
      status: 401,
      body: { error: "Incorrect email or password." },
    });
    render(<DemoSignIn demoAccounts={ACCOUNTS} demoPassword="demo1234" />);

    await user.click(screen.getByTestId("demo-signin-guest"));

    expect(await screen.findByTestId("signin-error")).toHaveTextContent(
      "Incorrect email or password.",
    );
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it("explains itself and stays put when the network fails", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    render(<DemoSignIn demoAccounts={ACCOUNTS} demoPassword="demo1234" />);

    await user.click(screen.getByTestId("demo-signin-owner"));

    expect(await screen.findByTestId("signin-error")).toHaveTextContent(
      /could not reach the server/i,
    );
    expect(routerMock.replace).not.toHaveBeenCalled();
  });
});
