// @vitest-environment node
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { findViolations, resolveToSrc, specifiersIn } from "./layering-guard";

const SRC = fileURLToPath(new URL("../../", import.meta.url));

describe("layering", () => {
  it("keeps the domain free of the framework and the adapters", () => {
    const violations = findViolations(SRC).filter((v) => v.file.startsWith("domain/"));
    expect(violations.map((v) => `${v.file} -> ${v.specifier} (${v.rule})`)).toEqual([]);
  });

  it("keeps components off the adapters", () => {
    const violations = findViolations(SRC).filter((v) =>
      v.file.startsWith("components/"),
    );
    expect(violations.map((v) => `${v.file} -> ${v.specifier} (${v.rule})`)).toEqual([]);
  });
});

describe("the guard itself", () => {
  // A guard that silently matches nothing passes forever. These pin the
  // extraction so a regex change cannot quietly disarm it.
  it("finds every shape of import", () => {
    const source = `
      import a from "one";
      import { b } from './two';
      export { c } from "three";
      export * from "four";
      const d = await import("five");
      const e = require("six");
      import "seven";
    `;
    expect(specifiersIn(source).sort()).toEqual([
      "./two",
      "five",
      "four",
      "one",
      "seven",
      "six",
      "three",
    ]);
  });

  it("resolves the alias and relative paths, and ignores packages", () => {
    const from = "/repo/src/domain/services/checkout.ts";
    expect(resolveToSrc("@/adapters/store", from, "/repo/src")).toBe(
      "/repo/src/adapters/store",
    );
    expect(resolveToSrc("../../adapters/store", from, "/repo/src")).toBe(
      "/repo/src/adapters/store",
    );
    expect(resolveToSrc("zod", from, "/repo/src")).toBeNull();
    expect(resolveToSrc("../../../outside", from, "/repo/src")).toBeNull();
  });
});
