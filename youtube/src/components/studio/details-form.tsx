"use client";

import clsx from "clsx";
import { useId } from "react";

/**
 * The Details step's form — `ytcp-video-metadata-editor`.
 *
 * This is the one part of the upload flow the research pass could actually
 * measure. R9 §13.1 is explicit that the four-step stepper does not exist in
 * the DOM until a file has been selected, so it captured the *video details
 * editor* instead (§12.6) — which is the same component the Details step
 * mounts. Every number below is from that capture:
 *
 *   left column        696 wide @ x=272        right column 376 @ x=968, pad-left 24
 *   title field        696 × 79   radius 8px   transparent, 1px outline, not filled
 *     its label        12/16  w500  #aaa       margin 8px 0 3px
 *     its input        16/22  w400  #f1f1f1
 *   description        696 × 225  radius 8px
 *   thumbnail tiles    153 × 84 each, 8px gaps, under a 16/22 w500 h3
 *
 * The field being *transparent with an outline* rather than a filled box is
 * the detail that reads wrong first if it is guessed: Studio's inputs do not
 * look like the main app's search field.
 *
 * ## The three thumbnail tiles are rendered and disabled
 *
 * «Upload file», «Select from video» and «A/B Testing» are all in the capture,
 * and all three are unavailable here for reasons this project can state rather
 * than hide: thumbnail storage exists (`blobKeys.thumbnail`) but nothing in
 * this slice extracts or uploads one, and the seed pipeline is what currently
 * writes them. Rendering them greyed with a reason is honest; dropping them
 * would quietly redesign the surface that was measured.
 */

/** YouTube's own cap, and the same number `/api/videos` enforces server-side. */
export const TITLE_MAX_LENGTH = 100;
export const DESCRIPTION_MAX_LENGTH = 5000;
/**
 * Tags are capped by total characters, not by count — 500 including the commas
 * that separate them, which is why the counter below measures the raw text
 * rather than the parsed array.
 */
export const TAGS_MAX_LENGTH = 500;

/**
 * The category list, matching `videos.category`'s default of `People & Blogs`.
 * These are YouTube's own upload categories; the column is free text, so this
 * list is the only thing that keeps two uploads from spelling one category two
 * ways.
 */
export const VIDEO_CATEGORIES = [
  "Film & Animation",
  "Autos & Vehicles",
  "Music",
  "Pets & Animals",
  "Sports",
  "Travel & Events",
  "Gaming",
  "People & Blogs",
  "Comedy",
  "Entertainment",
  "News & Politics",
  "Howto & Style",
  "Education",
  "Science & Technology",
  "Nonprofits & Activism",
] as const;

export const DEFAULT_CATEGORY = "People & Blogs";

export interface VideoDetails {
  readonly title: string;
  readonly description: string;
  readonly category: string;
  /** The raw comma-separated text. {@link parseTags} is the only reader. */
  readonly tagsText: string;
}

export const EMPTY_DETAILS: VideoDetails = {
  title: "",
  description: "",
  category: DEFAULT_CATEGORY,
  tagsText: "",
};

export interface DetailsErrors {
  readonly title?: string;
  readonly description?: string;
  readonly tagsText?: string;
}

/**
 * Tags, as a set.
 *
 * `setTags` in the repository already deduplicates and trims, and doing it here
 * too is not redundancy for its own sake: the counter and the chip list below
 * have to show the same set that will be stored, or the form says one thing and
 * the row holds another.
 */
export function parseTags(tagsText: string): string[] {
  const seen = new Set<string>();
  for (const raw of tagsText.split(",")) {
    const tag = raw.trim();
    if (tag.length > 0) seen.add(tag);
  }
  return [...seen];
}

/**
 * The validation, as a pure function.
 *
 * Exported and pure because three things need to agree about it: the field's
 * inline error, the stepper's Next button, and the test. A rule spelled once in
 * a component and once in a disabled-prop is a rule that drifts the first time
 * either moves.
 */
export function validateDetails(details: VideoDetails): DetailsErrors {
  const errors: { title?: string; description?: string; tagsText?: string } = {};

  const title = details.title.trim();
  if (title.length === 0) {
    errors.title = "A title is required.";
  } else if (title.length > TITLE_MAX_LENGTH) {
    errors.title = `Titles are at most ${TITLE_MAX_LENGTH} characters.`;
  }

  if (details.description.length > DESCRIPTION_MAX_LENGTH) {
    errors.description = `Descriptions are at most ${DESCRIPTION_MAX_LENGTH} characters.`;
  }

  if (details.tagsText.length > TAGS_MAX_LENGTH) {
    errors.tagsText = `Tags are at most ${TAGS_MAX_LENGTH} characters in total.`;
  }

  return errors;
}

export function detailsAreValid(details: VideoDetails): boolean {
  return Object.keys(validateDetails(details)).length === 0;
}

export interface DetailsFormProps {
  readonly value: VideoDetails;
  readonly onChange: (next: VideoDetails) => void;
  /**
   * Errors are shown only once the user has tried to move on. Marking a field
   * red before it has ever been filled is how a form scolds someone for not
   * having typed yet.
   */
  readonly showErrors?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
}

export function DetailsForm({
  value,
  onChange,
  showErrors = false,
  disabled = false,
  className,
}: DetailsFormProps) {
  const titleId = useId();
  const descriptionId = useId();
  const categoryId = useId();
  const tagsId = useId();
  const errors = validateDetails(value);
  const tags = parseTags(value.tagsText);

  const patch = (next: Partial<VideoDetails>): void =>
    onChange({ ...value, ...next });

  return (
    <div className={clsx("flex flex-col gap-6", className)}>
      <Field
        id={titleId}
        label="Title (required)"
        counter={`${value.title.length}/${TITLE_MAX_LENGTH}`}
        error={showErrors ? errors.title : undefined}
      >
        <input
          id={titleId}
          type="text"
          value={value.title}
          disabled={disabled}
          // Not `maxLength`: silently swallowing keystrokes at 100 characters
          // is how a paste of 120 loses 20 without saying so. The counter turns
          // red and the step refuses to advance instead.
          onChange={(event) => patch({ title: event.target.value })}
          placeholder="Add a title that describes your video"
          aria-invalid={showErrors && errors.title !== undefined}
          className="ytcp-subheading w-full bg-transparent px-4 py-3 outline-none"
        />
      </Field>

      <Field
        id={descriptionId}
        label="Description"
        counter={`${value.description.length}/${DESCRIPTION_MAX_LENGTH}`}
        error={showErrors ? errors.description : undefined}
      >
        <textarea
          id={descriptionId}
          value={value.description}
          disabled={disabled}
          rows={8}
          onChange={(event) => patch({ description: event.target.value })}
          placeholder="Tell viewers about your video"
          aria-invalid={showErrors && errors.description !== undefined}
          className="ytcp-body1 min-h-[176px] w-full resize-y bg-transparent px-4 py-3 outline-none"
        />
      </Field>

      <section>
        <h3 className="ytcp-subheading2 m-0">Thumbnail</h3>
        <p className="ytcp-caption1 mt-1 mb-3 text-secondary">
          Pick an image that shows what your video is about.
        </p>
        <div className="flex flex-wrap gap-2">
          {THUMBNAIL_OPTIONS.map((option) => (
            <button
              key={option.label}
              type="button"
              disabled
              title={option.reason}
              className={clsx(
                "h-[84px] w-[153px] rounded-compact border border-dashed border-outline",
                "ytcp-caption1 px-2 text-disabled",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="ytcp-caption1 mt-2 mb-0 text-disabled">
          Thumbnails are generated at seed time in this build; the upload flow
          does not extract one.
        </p>
      </section>

      <Field id={categoryId} label="Category">
        <select
          id={categoryId}
          value={value.category}
          disabled={disabled}
          onChange={(event) => patch({ category: event.target.value })}
          className="ytcp-body1 w-full bg-transparent px-4 py-3 outline-none"
        >
          {VIDEO_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </Field>

      <Field
        id={tagsId}
        label="Tags"
        counter={`${value.tagsText.length}/${TAGS_MAX_LENGTH}`}
        error={showErrors ? errors.tagsText : undefined}
      >
        <input
          id={tagsId}
          type="text"
          value={value.tagsText}
          disabled={disabled}
          onChange={(event) => patch({ tagsText: event.target.value })}
          placeholder="Add tags, separated by commas"
          aria-invalid={showErrors && errors.tagsText !== undefined}
          aria-describedby={`${tagsId}-parsed`}
          className="ytcp-body1 w-full bg-transparent px-4 py-3 outline-none"
        />
      </Field>
      <p id={`${tagsId}-parsed`} className="ytcp-caption1 -mt-4 mb-0 text-secondary">
        {tags.length === 0
          ? "No tags yet."
          : `${tags.length} tag${tags.length === 1 ? "" : "s"}: ${tags.join(", ")}`}
      </p>
    </div>
  );
}

const THUMBNAIL_OPTIONS = [
  {
    label: "Upload file",
    reason: "No thumbnail upload in this slice — the key layout exists, the picker does not.",
  },
  {
    label: "Select from video",
    reason: "Frame extraction happens in the seed pipeline, not in the upload flow.",
  },
  {
    label: "A/B Testing",
    reason: "Not implemented: this needs per-impression thumbnail assignment and an experiment store.",
  },
] as const;

interface FieldProps {
  readonly id: string;
  readonly label: string;
  readonly counter?: string;
  readonly error?: string | undefined;
  readonly children: React.ReactNode;
}

/**
 * One outlined field.
 *
 * The label sits *inside* the outline at 12/16 w500 in `text-secondary`, above
 * the value, which is the shape §12.6 measured — not a floating label and not a
 * label above the box.
 */
function Field({ id, label, counter, error, children }: FieldProps) {
  return (
    <div>
      <div
        className={clsx(
          "rounded-compact border bg-transparent",
          error ? "border-[var(--yt-error-indicator)]" : "border-outline",
        )}
      >
        <div className="flex items-baseline justify-between px-4 pt-2">
          <label htmlFor={id} className="ytcp-caption2 text-secondary">
            {label}
          </label>
          {counter ? (
            <span className="ytcp-caption1 text-secondary">{counter}</span>
          ) : null}
        </div>
        {children}
      </div>
      {error ? (
        <p role="alert" className="ytcp-caption1 mt-1 mb-0 text-[var(--yt-error-indicator)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
