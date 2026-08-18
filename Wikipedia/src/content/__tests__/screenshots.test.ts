import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { projects } from "@/content/projects";

// `vitest.config.mts` sets no custom root, so `process.cwd()` is this
// package's directory (the repo's per-project convention — see
// research/01-repo-conventions.md's vitest.config.mts note on avoiding
// `URL.pathname`, which breaks on this repo's space-containing path).
const publicImagesDir = join(process.cwd(), "public", "images");

// Projects with at least one screenshot in the dossiers get one representative
// screenshot copied into public/images/<slug>.png for their infobox (Notion
// and Bet have no screenshots on disk, per research/02-project-dossiers.md).
describe("copied infobox screenshots exist on disk", () => {
  it.each(projects.filter((p) => p.screenshots.length > 0))("$name", (project) => {
    const path = join(publicImagesDir, `${project.slug}.png`);
    expect(existsSync(path), `missing public/images/${project.slug}.png`).toBe(true);
  });

  it("Notion and Bet have no screenshots (none exist in the dossiers)", () => {
    const notion = projects.find((p) => p.slug === "Notion_(replica)")!;
    const bet = projects.find((p) => p.slug === "Bet_(app)")!;
    expect(notion.screenshots).toEqual([]);
    expect(bet.screenshots).toEqual([]);
  });
});
