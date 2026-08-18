import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { articles } from "@/content/articles";
import { articleExists } from "@/lib/registry";

describe("every WikiLink target across the registered articles resolves", () => {
  for (const article of Object.values(articles)) {
    it(`"${article.meta.title}" has no red (broken) internal links`, () => {
      const { container } = render(<>{article.body}</>);
      // `ExternalLink` with a null `href` also renders an `/wiki/...` route
      // (the red-link stub for an undeployed *external* site, DECISIONS D3)
      // but carries an "external-link" class and isn't a `WikiLink` at all —
      // exclude it so this test only checks true internal WikiLink targets.
      const internalLinks = Array.from(
        container.querySelectorAll<HTMLAnchorElement>('a[href^="/wiki/"]:not(.external-link)'),
      );

      expect(internalLinks.length).toBeGreaterThan(0);

      for (const link of internalLinks) {
        const slug = decodeURIComponent(link.getAttribute("href")!.replace(/^\/wiki\//, ""));
        expect(articleExists(slug), `${article.meta.title} links to missing article "${slug}"`).toBe(true);
        expect(link.className).not.toContain("new");
      }
    });
  }
});
