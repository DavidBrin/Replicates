import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { projects } from "@/content/projects";
import { articles } from "@/content/articles";

describe("every project article has a non-empty References list", () => {
  it.each(projects)("$name", (project) => {
    const article = articles[project.slug];
    expect(article).toBeDefined();

    const { container } = render(<>{article.body}</>);
    const refEntries = container.querySelectorAll("ol.references > li");
    expect(refEntries.length).toBeGreaterThan(0);
  });
});
