import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  HIGHLIGHT_END as ADAPTER_END,
  HIGHLIGHT_START as ADAPTER_START,
} from "@/adapters/search/postgres";

import {
  HIGHLIGHT_END,
  HIGHLIGHT_START,
  HighlightedSnippet,
  splitHighlight,
} from "../result-row";

/**
 * Highlight rendering, which is the one place this slice can produce output
 * that is silently wrong.
 *
 * The delimiters are U+0002 and U+0003. They are invisible: a renderer that
 * forgot to convert them would ship a snippet that reads correctly in a diff,
 * in a screenshot and in `textContent.trim()`, and is wrong only in the bytes.
 * So the assertions here are about *characters*, not about appearance.
 */

const marked = (text: string): string => `${HIGHLIGHT_START}${text}${HIGHLIGHT_END}`;

describe("the delimiters", () => {
  /**
   * The renderer keeps its own copy of the two characters, because importing
   * them from the adapter would pull `server-only` and a WASM Postgres into
   * every client bundle that renders a result row. This is the test that makes
   * the copy safe: a change to either side is a red line here rather than a
   * page full of unmarked snippets.
   */
  it("are identical to the adapter's", () => {
    expect(HIGHLIGHT_START).toBe(ADAPTER_START);
    expect(HIGHLIGHT_END).toBe(ADAPTER_END);
  });

  it("are the C0 controls the adapter documents", () => {
    expect(HIGHLIGHT_START).toBe("\u0002");
    expect(HIGHLIGHT_END).toBe("\u0003");
  });
});

describe("splitHighlight", () => {
  it("splits a fragment into unmarked and marked runs", () => {
    expect(splitHighlight(`From ${marked("surgical")} gloves`)).toEqual([
      { text: "From ", marked: false },
      { text: "surgical", marked: true },
      { text: " gloves", marked: false },
    ]);
  });

  it("handles several marked runs", () => {
    const runs = splitHighlight(
      `${marked("rust")} and more ${marked("rust")}`,
    );
    expect(runs.filter((run) => run.marked).map((run) => run.text)).toEqual([
      "rust",
      "rust",
    ]);
  });

  it("marks the tail of a fragment whose closing delimiter is missing", () => {
    // `ts_headline` is not expected to produce this. The scan is tolerant
    // anyway, because the alternative failure is a raw control character on
    // the page and nobody would see it.
    expect(splitHighlight(`chocolate ${HIGHLIGHT_START}made`)).toEqual([
      { text: "chocolate ", marked: false },
      { text: "made", marked: true },
    ]);
  });

  it("drops a stray closing delimiter rather than rendering it", () => {
    const runs = splitHighlight(`plain${HIGHLIGHT_END} text`);
    expect(runs).toEqual([{ text: "plain text", marked: false }]);
    expect(runs.map((run) => run.text).join("")).not.toContain(HIGHLIGHT_END);
  });

  it("emits no empty runs", () => {
    const runs = splitHighlight(`${marked("rust")}`);
    expect(runs).toEqual([{ text: "rust", marked: true }]);
  });

  it("returns nothing for an empty fragment", () => {
    expect(splitHighlight("")).toEqual([]);
  });
});

describe("HighlightedSnippet", () => {
  it("renders a marked run as a <mark> and the rest as plain text", () => {
    render(
      <HighlightedSnippet fragment={`From ${marked("surgical")} gloves`} />,
    );

    const mark = screen.getByText("surgical");
    expect(mark.tagName).toBe("MARK");
    expect(screen.getByText(/From/)).toBeInTheDocument();
  });

  /**
   * The assertion this file exists for.
   *
   * `textContent` is checked character by character rather than by eye: a
   * renderer that passed the fragment straight through would satisfy every
   * "the snippet says X" assertion in this suite and still emit two control
   * characters into the DOM.
   */
  it("never renders a delimiter as a literal character", () => {
    const { container } = render(
      <HighlightedSnippet
        fragment={`${marked("a")} b ${HIGHLIGHT_END}${marked("c")}${HIGHLIGHT_START}`}
      />,
    );

    const text = container.textContent ?? "";
    expect(text).not.toContain(HIGHLIGHT_START);
    expect(text).not.toContain(HIGHLIGHT_END);
    expect(text).toBe("a b c");
  });

  it("marks every matched run, not just the first", () => {
    const { container } = render(
      <HighlightedSnippet fragment={`${marked("one")} x ${marked("two")}`} />,
    );
    expect(container.querySelectorAll("mark")).toHaveLength(2);
  });

  it("escapes markup in the fragment rather than interpreting it", () => {
    // A description is uploader-controlled text. The adapter's delimiters are
    // control characters precisely so that no printable string in a document
    // can forge a highlight; this is the renderer's half of that claim.
    const { container } = render(
      <HighlightedSnippet fragment={`<b>${marked("bold")}</b>`} />,
    );

    expect(container.querySelectorAll("b")).toHaveLength(0);
    expect(container.textContent).toBe("<b>bold</b>");
  });
});
