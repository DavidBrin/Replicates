import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DemoLoginDialog } from "./DemoLoginDialog";
import { demoLoginCopy } from "./copy";

/**
 * Purely presentational, so these drive the component through props only —
 * no store, no hooks from `src/lib/auth/*`.
 */

describe("disclaimer", () => {
  it("renders the disclaimer heading and body", () => {
    render(<DemoLoginDialog onSignIn={() => {}} onSkip={() => {}} />);

    expect(screen.getByText(demoLoginCopy.disclaimerHeading)).toBeInTheDocument();
    expect(screen.getByText(demoLoginCopy.disclaimerBody)).toBeInTheDocument();
  });
});

describe("submit", () => {
  it("disables Continue while the input is empty or whitespace-only", async () => {
    const user = userEvent.setup();
    render(<DemoLoginDialog onSignIn={() => {}} onSkip={() => {}} />);

    const submit = screen.getByRole("button", { name: demoLoginCopy.submit });
    expect(submit).toBeDisabled();

    await user.type(screen.getByPlaceholderText(demoLoginCopy.placeholder), "   ");
    expect(submit).toBeDisabled();
  });

  it("calls onSignIn with the trimmed name on Enter", async () => {
    const user = userEvent.setup();
    const onSignIn = vi.fn();
    render(<DemoLoginDialog onSignIn={onSignIn} onSkip={() => {}} />);

    await user.type(screen.getByPlaceholderText(demoLoginCopy.placeholder), "  Ada  {Enter}");

    expect(onSignIn).toHaveBeenCalledWith("Ada");
  });

  it("calls onSignIn with the trimmed name when clicking the submit button", async () => {
    const user = userEvent.setup();
    const onSignIn = vi.fn();
    render(<DemoLoginDialog onSignIn={onSignIn} onSkip={() => {}} />);

    await user.type(screen.getByPlaceholderText(demoLoginCopy.placeholder), "  Grace  ");
    await user.click(screen.getByRole("button", { name: demoLoginCopy.submit }));

    expect(onSignIn).toHaveBeenCalledWith("Grace");
  });
});

describe("dismissal", () => {
  it("calls onSkip when the skip button is clicked", async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn();
    render(<DemoLoginDialog onSignIn={() => {}} onSkip={onSkip} />);

    await user.click(screen.getByRole("button", { name: demoLoginCopy.skip }));

    expect(onSkip).toHaveBeenCalled();
  });

  it("calls onSkip on Escape", async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn();
    render(<DemoLoginDialog onSignIn={() => {}} onSkip={onSkip} />);

    await user.keyboard("{Escape}");

    expect(onSkip).toHaveBeenCalled();
  });

  it("calls onSkip when the outer scrim is clicked, but not when the card is clicked", async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn();
    render(<DemoLoginDialog onSignIn={() => {}} onSkip={onSkip} />);

    await user.click(screen.getByRole("dialog"));
    expect(onSkip).not.toHaveBeenCalled();

    // The scrim is the dialog's parent — click it directly, not the card.
    await user.click(screen.getByRole("dialog").parentElement!);
    expect(onSkip).toHaveBeenCalled();
  });
});
