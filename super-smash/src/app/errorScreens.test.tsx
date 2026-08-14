/**
 * The two screens the player only ever sees when something has gone wrong.
 *
 * Tested through the route components rather than through `StopScreen`, on
 * purpose. `StopScreen` is presentational and would stay green through every
 * failure that actually matters here — a reset button wired to nothing, a menu
 * link pointing at a route that no longer exists, a production digest quietly
 * dropped. Those are all properties of the *callers*, so the callers are what
 * these render.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { routerMock } from "../../vitest.setup";
import Error from "./error";
import NotFound from "./not-found";

let logged: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  routerMock.push.mockClear();
  // The boundary logs every error it catches, which is the point of it — but
  // an expected log in the test output is noise that hides an unexpected one.
  logged = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  logged.mockRestore();
});

describe("the error boundary", () => {
  it("hands the player back to a working game when they retry", () => {
    const reset = vi.fn();
    render(<Error error={new globalThis.Error("boom")} reset={reset} />);

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    // Called, and called with nothing else standing in for it: a boundary whose
    // retry button is decorative is worse than no boundary, because it looks
    // like it worked.
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("offers the menu as the second way out, and goes to the menu", () => {
    render(<Error error={new globalThis.Error("boom")} reset={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /main menu/i }));

    expect(routerMock.push).toHaveBeenCalledWith("/menu");
  });

  /**
   * A production build strips the message and leaves only the digest, so the
   * digest is the entire link between "the screen said no contest" and a line
   * in a server log. Asserted as the actual string — a test that only checked
   * *something* was rendered would pass on a screen showing the word "Digest"
   * and nothing after it, which is precisely the useless case.
   */
  it("shows the digest, which is all a production crash gives you to trace it", () => {
    const error = Object.assign(new globalThis.Error(""), { digest: "3f8a12cc9" });
    render(<Error error={error} reset={vi.fn()} />);

    expect(screen.getByText(/3f8a12cc9/)).toBeInTheDocument();
  });

  it("falls back to the message when there is no digest", () => {
    render(<Error error={new globalThis.Error("resolveCollision pinned y")} reset={vi.fn()} />);

    expect(screen.getByText(/resolveCollision pinned y/)).toBeInTheDocument();
    // And does not print the absent digest as the string "undefined", which is
    // what `Digest ${error.digest}` unguarded would produce.
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
  });

  it("shows no detail line at all when there is neither", () => {
    const { container } = render(
      <Error error={Object.assign(new globalThis.Error(""), { digest: "" })} reset={vi.fn()} />,
    );

    expect(container.querySelector("code")).toBeNull();
  });

  it("records the error, so a production crash leaves a trace somewhere", () => {
    const error = new globalThis.Error("boom");
    render(<Error error={error} reset={vi.fn()} />);

    expect(logged).toHaveBeenCalledWith(expect.stringContaining("Match stopped"), error);
  });
});

describe("the 404", () => {
  it("leads to the main menu, not back to the title screen", () => {
    // `/menu` rather than `/`: a player who mistyped a URL has already pressed
    // start once, and `/` would make them do it again.
    render(<NotFound />);

    expect(screen.getByRole("link", { name: /main menu/i })).toHaveAttribute("href", "/menu");
  });

  it("says the screen is missing rather than that the game broke", () => {
    render(<NotFound />);

    expect(screen.getByRole("heading", { name: /no contest/i })).toBeInTheDocument();
    expect(screen.getByText(/isn't in this build/i)).toBeInTheDocument();
  });
});
