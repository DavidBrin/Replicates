import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AcceptInvite } from "@/components/auth/accept-invite";
import { SignInForm } from "@/components/auth/sign-in-form";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { routerMock } from "../../../../vitest.setup";

/**
 * The three auth forms.
 *
 * Two things are being protected here, and only one of them is visual.
 *
 * **The test-id contract.** `e2e/fixtures.ts` signs every spec in the suite in
 * through `signin-email`, `signin-password` and `signin-submit`. Renaming one is
 * a breaking change to a file this slice does not own, so the ids are asserted
 * by name rather than reached through a label or a role.
 *
 * **The refusal.** `/api/auth/signin` answers every failure identically so it
 * cannot be used to ask whether an address has an account here. That property
 * lives on the server and is trivially destroyed in the browser — a field-level
 * "unknown email" hint, or a red border on only the password, reconstructs the
 * oracle out of a response that was careful not to contain it. The tests below
 * assert the UI does not.
 */

const originalFetch = global.fetch;

function mockFetch(
  response: { ok: boolean; status?: number; body?: unknown },
): ReturnType<typeof vi.fn> {
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

/* ================================================================ sign in = */

describe("SignInForm", () => {
  it("exposes the ids the e2e sign-in helper depends on", () => {
    render(<SignInForm />);
    expect(screen.getByTestId("signin-email")).toBeInTheDocument();
    expect(screen.getByTestId("signin-password")).toBeInTheDocument();
    expect(screen.getByTestId("signin-submit")).toBeInTheDocument();
  });

  it("posts the credentials and navigates on success", async () => {
    const user = userEvent.setup();
    const fetchSpy = mockFetch({ ok: true, body: { user: { id: "usr_1" } } });
    render(<SignInForm redirectTo="/" />);

    await user.type(screen.getByTestId("signin-email"), "owner@demo.test");
    await user.type(screen.getByTestId("signin-password"), "demo1234");
    await user.click(screen.getByTestId("signin-submit"));

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/auth/signin",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(
      String((fetchSpy.mock.calls[0]?.[1] as { body: string }).body),
    );
    expect(body).toEqual({ email: "owner@demo.test", password: "demo1234" });

    // `replace`, not `push`: pressing Back from inside the app must not show a
    // sign-in form for a session that is already live.
    expect(routerMock.replace).toHaveBeenCalledWith("/");
    // The cookie is httpOnly, so the client cannot see it. Only a refresh makes
    // the server re-decide who is asking.
    expect(routerMock.refresh).toHaveBeenCalled();
  });

  it("renders the server's refusal verbatim and adds nothing", async () => {
    const user = userEvent.setup();
    mockFetch({ ok: false, status: 401, body: { error: "Incorrect email or password." } });
    render(<SignInForm />);

    await user.type(screen.getByTestId("signin-email"), "nobody@demo.test");
    await user.type(screen.getByTestId("signin-password"), "wrong");
    await user.click(screen.getByTestId("signin-submit"));

    const error = await screen.findByTestId("signin-error");
    expect(error).toHaveTextContent("Incorrect email or password.");
    // Not "no account with that email", not "wrong password".
    expect(error.textContent).not.toMatch(/email.*(exists|found|unknown)/i);
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it("marks both fields invalid together, never one alone", async () => {
    // Marking only the password would say "the email was fine" — the same
    // oracle the constant-time endpoint exists to deny.
    const user = userEvent.setup();
    mockFetch({ ok: false, body: { error: "Incorrect email or password." } });
    render(<SignInForm />);

    await user.type(screen.getByTestId("signin-email"), "nobody@demo.test");
    await user.type(screen.getByTestId("signin-password"), "wrong");
    await user.click(screen.getByTestId("signin-submit"));

    await screen.findByTestId("signin-error");
    expect(screen.getByTestId("signin-email")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByTestId("signin-password")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("stays put and explains itself when the network fails", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    render(<SignInForm />);

    await user.type(screen.getByTestId("signin-email"), "owner@demo.test");
    await user.type(screen.getByTestId("signin-password"), "demo1234");
    await user.click(screen.getByTestId("signin-submit"));

    expect(await screen.findByTestId("signin-error")).toHaveTextContent(
      /could not reach the server/i,
    );
  });

  it("signs in as a seeded account in one click", async () => {
    const user = userEvent.setup();
    const fetchSpy = mockFetch({ ok: true, body: {} });
    render(
      <SignInForm
        demoAccounts={[{ email: "guest@demo.test", label: "Guest", role: "Design" }]}
        demoPassword="demo1234"
      />,
    );

    await user.click(screen.getByTestId("demo-signin-guest"));

    const body = JSON.parse(
      String((fetchSpy.mock.calls[0]?.[1] as { body: string }).body),
    );
    expect(body).toEqual({ email: "guest@demo.test", password: "demo1234" });
    // Filled as well as submitted, so a failure leaves a form the user can
    // retry from rather than an empty one.
    expect(screen.getByTestId("signin-email")).toHaveValue("guest@demo.test");
  });

  it("renders no demo panel when there are no seeded accounts", () => {
    render(<SignInForm />);
    expect(screen.queryByTestId("demo-accounts")).toBeNull();
  });
});

/* ================================================================ sign up = */

describe("SignUpForm", () => {
  it("exposes the signup ids", () => {
    render(<SignUpForm />);
    expect(screen.getByTestId("signup-name")).toBeInTheDocument();
    expect(screen.getByTestId("signup-email")).toBeInTheDocument();
    expect(screen.getByTestId("signup-password")).toBeInTheDocument();
    expect(screen.getByTestId("signup-submit")).toBeInTheDocument();
  });

  it("carries an invite token in the same request that creates the account", async () => {
    // One request, not two: the alternative leaves a window in which the
    // account exists and the membership does not, and a visitor who closes the
    // tab in it has spent their link on nothing.
    const user = userEvent.setup();
    const fetchSpy = mockFetch({ ok: true, status: 201, body: {} });
    render(<SignUpForm inviteToken="tok_abcdef0123456789" redirectTo="/demo/my-issues" />);

    await user.type(screen.getByTestId("signup-name"), "Nina");
    await user.type(screen.getByTestId("signup-email"), "nina@demo.test");
    await user.type(screen.getByTestId("signup-password"), "correct horse battery");
    await user.click(screen.getByTestId("signup-submit"));

    const body = JSON.parse(
      String((fetchSpy.mock.calls[0]?.[1] as { body: string }).body),
    );
    expect(body.inviteToken).toBe("tok_abcdef0123456789");
    expect(routerMock.replace).toHaveBeenCalledWith("/demo/my-issues");
  });

  it("says an address is taken, because pretending otherwise hands out a session", async () => {
    const user = userEvent.setup();
    mockFetch({
      ok: false,
      status: 409,
      body: { error: "An account with that email already exists." },
    });
    render(<SignUpForm />);

    await user.type(screen.getByTestId("signup-name"), "Nina");
    await user.type(screen.getByTestId("signup-email"), "owner@demo.test");
    await user.type(screen.getByTestId("signup-password"), "correct horse battery");
    await user.click(screen.getByTestId("signup-submit"));

    expect(await screen.findByTestId("signup-error")).toHaveTextContent(/already exists/i);
  });

  it("stops on a live account with a dead invitation rather than sending them on", async () => {
    // A 201 with `inviteError`: the account is real and the session is live,
    // only the invitation failed. Navigating would strand them in a workspace
    // list they are not in.
    const user = userEvent.setup();
    mockFetch({
      ok: true,
      status: 201,
      body: { inviteError: "That invitation has expired." },
    });
    render(<SignUpForm inviteToken="tok_abcdef0123456789" />);

    await user.type(screen.getByTestId("signup-name"), "Nina");
    await user.type(screen.getByTestId("signup-email"), "nina@demo.test");
    await user.type(screen.getByTestId("signup-password"), "correct horse battery");
    await user.click(screen.getByTestId("signup-submit"));

    expect(await screen.findByTestId("signup-notice")).toHaveTextContent(/expired/i);
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it("takes accept-invite-submit as its button id on the invite page", () => {
    // The invite page's signed-out path is this form, so the id that finishes
    // the job lives on its submit rather than on a second button.
    render(<SignUpForm submitTestId="accept-invite-submit" submitLabel="Join Acme" />);
    expect(screen.getByTestId("accept-invite-submit")).toHaveTextContent("Join Acme");
  });
});

/* ========================================================= accept invite = */

describe("AcceptInvite", () => {
  it("exposes accept-invite-submit and redeems the token", async () => {
    const user = userEvent.setup();
    const fetchSpy = mockFetch({ ok: true, body: { workspaceId: "wsp_1" } });
    render(<AcceptInvite token="tok_abcdef0123456789" redirectTo="/demo/my-issues" />);

    await user.click(screen.getByTestId("accept-invite-submit"));

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/invites/accept",
      expect.objectContaining({ method: "POST" }),
    );
    expect(routerMock.replace).toHaveBeenCalledWith("/demo/my-issues");
  });

  it("names the specific failure, because the caller demonstrably holds the link", async () => {
    const user = userEvent.setup();
    mockFetch({
      ok: false,
      status: 410,
      body: { error: "That invitation has already been used." },
    });
    render(<AcceptInvite token="tok_abcdef0123456789" redirectTo="/demo" />);

    await user.click(screen.getByTestId("accept-invite-submit"));

    expect(await screen.findByTestId("accept-invite-error")).toHaveTextContent(
      /already been used/i,
    );
  });
});
