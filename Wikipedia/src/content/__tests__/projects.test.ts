import { describe, expect, it } from "vitest";
import { projects } from "@/content/projects";
import { articles } from "@/content/articles";

describe("projects.ts <-> articles registry", () => {
  it("registers exactly seven projects", () => {
    expect(projects).toHaveLength(7);
  });

  it("has a registered article for every project", () => {
    for (const project of projects) {
      expect(articles[project.slug], `no article registered for ${project.name}`).toBeDefined();
    }
  });

  it("has no duplicate project slugs", () => {
    const slugs = projects.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  // `liveUrl` is null for every project because nothing in the repo is
  // deployed yet (research/02-project-dossiers.md, "Root repo"). Update this
  // test — and the projects it names — the day a project's `liveUrl` is
  // filled in with a real deployment URL; it should then assert that
  // project's link renders as a normal (non-stub) external link instead.
  it("has liveUrl: null for every project (nothing is deployed yet)", () => {
    for (const project of projects) {
      expect(project.liveUrl, `${project.name} has a non-null liveUrl`).toBeNull();
    }
  });

  it("has a non-empty tagline, stack, testStats and builtWith for every project", () => {
    for (const project of projects) {
      expect(project.tagline.length).toBeGreaterThan(0);
      expect(project.stack.length).toBeGreaterThan(0);
      expect(project.testStats.length).toBeGreaterThan(0);
      expect(project.builtWith.length).toBeGreaterThan(0);
    }
  });
});
