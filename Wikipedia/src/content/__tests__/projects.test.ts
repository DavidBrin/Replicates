import { describe, expect, it } from "vitest";
import { projects } from "@/content/projects";
import { articles } from "@/content/articles";

describe("projects.ts <-> articles registry", () => {
  it("registers seven replicas and ten interactive demos", () => {
    expect(projects.filter((p) => p.kind !== "demo")).toHaveLength(7);
    expect(projects.filter((p) => p.kind === "demo")).toHaveLength(10);
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

  // The explicit expectation list README.md's "Adding a live project link"
  // step (4) refers to. `liveUrl` is null for every project because nothing
  // in the repo is deployed yet (research/02-project-dossiers.md, "Root
  // repo"). The day a project's `liveUrl` goes from `null` to a real
  // deployment URL, add that project's slug here — and only here.
  const EXPECTED_LIVE: string[] = [
    "Verilog",
    "Nocturnal_Neuro",
    "Signals_and_Systems_Lab",
    "Quantum_Playground",
    "HardHack_2026",
    "ESP32_Thermal_TinyML",
    "Organoids_on_Psychedelics",
    "Anatomy_of_a_Spike",
    "Computer_Vision",
    "ArXiv_Semantic_Graph",
  ];

  it("has a non-null liveUrl iff the project is listed in EXPECTED_LIVE (src/content/__tests__/projects.test.ts)", () => {
    for (const project of projects) {
      const shouldBeLive = EXPECTED_LIVE.includes(project.slug);
      if (shouldBeLive) {
        expect(
          project.liveUrl,
          `${project.name} is listed in EXPECTED_LIVE (src/content/__tests__/projects.test.ts) but still has liveUrl: null`,
        ).not.toBeNull();
      } else {
        expect(
          project.liveUrl,
          `${project.name} has a non-null liveUrl but isn't listed in EXPECTED_LIVE (src/content/__tests__/projects.test.ts) — add its slug there`,
        ).toBeNull();
      }
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
