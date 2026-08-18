import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { projects } from "@/content/projects";
import { articles } from "@/content/articles";

/**
 * SPEC's promise that "references [are] numbered consistently" means more
 * than a non-empty list: every inline `<Ref n />` marker must point at a
 * `References` entry that exists, the set of distinct `n`s actually cited
 * must run 1..K with no gaps (you can't cite [1] and [3] without a [2]),
 * and every cited note must link back to a `cite_ref` anchor that exists —
 * the round trip Wikipedia's own "^" jump-up link relies on. Not every
 * `References` entry has to be cited inline (a few articles carry an extra,
 * uncited entry), so this only checks the entries that ARE cited.
 */
describe("every project article numbers its references consistently", () => {
  it.each(projects)("$name", (project) => {
    const article = articles[project.slug];
    expect(article).toBeDefined();

    const { container } = render(<>{article.body}</>);

    const noteEls = Array.from(container.querySelectorAll("ol.references > li"));
    expect(noteEls.length).toBeGreaterThan(0);
    const noteCount = noteEls.length;

    // The References list itself is numbered 1..noteCount with no gaps.
    expect(noteEls.map((li) => li.id)).toEqual(
      Array.from({ length: noteCount }, (_, i) => `cite_note-${i + 1}`),
    );

    const refMarkers = Array.from(container.querySelectorAll("sup.reference"));
    expect(refMarkers.length).toBeGreaterThan(0);

    const citedNs = refMarkers.map((marker) => {
      const match = marker.id.match(/^cite_ref-(\d+)$/);
      expect(match, `unexpected ref marker id "${marker.id}"`).not.toBeNull();
      return Number(match![1]);
    });

    // Every cited n falls within the References list.
    for (const n of citedNs) {
      expect(n).toBeGreaterThanOrEqual(1);
      expect(
        n,
        `Ref n=${n} exceeds the References list length (${noteCount})`,
      ).toBeLessThanOrEqual(noteCount);
    }

    // The distinct ns actually cited are contiguous from 1 (duplicates —
    // the same n cited more than once — always resolve to the same note,
    // since <Ref n> derives its target purely from n).
    const distinctNs = Array.from(new Set(citedNs)).sort((a, b) => a - b);
    expect(distinctNs).toEqual(Array.from({ length: distinctNs.length }, (_, i) => i + 1));

    // Every cite_ref anchor's href resolves to a cite_note that exists.
    for (const marker of refMarkers) {
      const link = marker.querySelector("a");
      expect(link).not.toBeNull();
      const href = link!.getAttribute("href");
      const target = href ? container.querySelector(href) : null;
      expect(target, `${marker.id} points to "${href}", which doesn't exist`).not.toBeNull();
    }

    // Every cited note links back to a cite_ref anchor that exists.
    for (const n of distinctNs) {
      const note = container.querySelector(`#cite_note-${n}`);
      expect(note).not.toBeNull();
      expect(
        note!.querySelector(`a[href="#cite_ref-${n}"]`),
        `cite_note-${n} has no jump-up link back to cite_ref-${n}`,
      ).not.toBeNull();
      expect(
        container.querySelector(`#cite_ref-${n}`),
        `cite_ref-${n} doesn't exist for cited note ${n}`,
      ).not.toBeNull();
    }
  });
});
