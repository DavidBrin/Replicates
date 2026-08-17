import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  DESCRIPTION_MAX_LENGTH,
  DetailsForm,
  EMPTY_DETAILS,
  TAGS_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  detailsAreValid,
  parseTags,
  validateDetails,
  type VideoDetails,
} from "../details-form";

/**
 * The Details step's form — the one part of the stepper R9 could measure
 * (§12.6, reached through an existing video's edit page rather than through an
 * upload).
 *
 * The validation is tested as a pure function *and* through the form, because
 * three things have to agree about it: the inline error, the stepper's Next
 * button, and the test. Testing only the rendered error would leave the
 * stepper free to disagree with it.
 */

function details(overrides: Partial<VideoDetails> = {}): VideoDetails {
  return { ...EMPTY_DETAILS, title: "A title", ...overrides };
}

describe("validateDetails", () => {
  it("requires a title, and does not accept whitespace as one", () => {
    expect(validateDetails(details({ title: "" })).title).toMatch(/required/);
    expect(validateDetails(details({ title: "   " })).title).toMatch(/required/);
    expect(validateDetails(details({ title: "ok" })).title).toBeUndefined();
  });

  it("caps the title at YouTube's own 100 characters", () => {
    expect(
      validateDetails(details({ title: "x".repeat(TITLE_MAX_LENGTH) })).title,
    ).toBeUndefined();
    expect(
      validateDetails(details({ title: "x".repeat(TITLE_MAX_LENGTH + 1) })).title,
    ).toMatch(/at most/);
  });

  it("caps the description and the tag text", () => {
    expect(
      validateDetails(details({ description: "x".repeat(DESCRIPTION_MAX_LENGTH + 1) }))
        .description,
    ).toMatch(/at most/);
    expect(
      validateDetails(details({ tagsText: "x".repeat(TAGS_MAX_LENGTH + 1) })).tagsText,
    ).toMatch(/at most/);
  });

  it("agrees with detailsAreValid", () => {
    expect(detailsAreValid(details())).toBe(true);
    expect(detailsAreValid(details({ title: "" }))).toBe(false);
  });
});

describe("parseTags", () => {
  it("trims, drops blanks and deduplicates — the same set setTags will store", () => {
    // The repository deduplicates too. Doing it here as well is what stops the
    // form claiming a different tag set from the one the row ends up with.
    expect(parseTags(" a , b ,, a , ")).toEqual(["a", "b"]);
    expect(parseTags("")).toEqual([]);
  });
});

describe("DetailsForm", () => {
  it("edits through the callback rather than holding its own copy", async () => {
    const onChange = vi.fn();
    render(<DetailsForm value={EMPTY_DETAILS} onChange={onChange} />);

    await userEvent.type(screen.getByLabelText(/Title/), "H");
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_DETAILS, title: "H" });
  });

  it("does not truncate a paste that exceeds the cap", async () => {
    // `maxLength` would swallow the overflow silently. The counter and the
    // step's refusal to advance are the feedback instead.
    const onChange = vi.fn();
    const overlong = "x".repeat(TITLE_MAX_LENGTH + 5);
    render(<DetailsForm value={EMPTY_DETAILS} onChange={onChange} />);

    await userEvent.click(screen.getByLabelText(/Title/));
    await userEvent.paste(overlong);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ title: overlong }),
    );
  });

  it("stays quiet until the user has tried to move on", () => {
    const { rerender } = render(
      <DetailsForm value={EMPTY_DETAILS} onChange={vi.fn()} />,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    rerender(<DetailsForm value={EMPTY_DETAILS} onChange={vi.fn()} showErrors />);
    expect(screen.getByRole("alert")).toHaveTextContent(/title is required/i);
    expect(screen.getByLabelText(/Title/)).toHaveAttribute("aria-invalid", "true");
  });

  it("counts what will be stored, not what was typed", async () => {
    render(
      <DetailsForm value={details({ tagsText: "a, b, a" })} onChange={vi.fn()} />,
    );
    expect(screen.getByText("2 tags: a, b")).toBeInTheDocument();
  });

  it("renders the three measured thumbnail tiles, disabled and explained", () => {
    // §12.6 captured all three. Dropping them would quietly redesign a surface
    // that was measured; rendering them live would promise a picker that does
    // not exist.
    render(<DetailsForm value={details()} onChange={vi.fn()} />);
    for (const label of ["Upload file", "Select from video", "A/B Testing"]) {
      expect(screen.getByRole("button", { name: label })).toBeDisabled();
    }
  });

  it("offers the category list rather than free text", () => {
    render(<DetailsForm value={details()} onChange={vi.fn()} />);
    const select = screen.getByLabelText("Category");
    expect(select.tagName).toBe("SELECT");
    expect(screen.getByRole("option", { name: "People & Blogs" })).toBeInTheDocument();
  });
});
