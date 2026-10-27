import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { metadata as controls } from "@/app/controls/page";
import { metadata as fighters } from "@/app/fighters/page";
import { metadata as menu } from "@/app/menu/page";
import { metadata as notFound } from "@/app/not-found";
import { metadata as results } from "@/app/results/page";
import { metadata as rules } from "@/app/rules/page";
import { metadata as stage } from "@/app/stage/page";
import { DEFAULT_APP_ID } from "@/net/adapters/webrtc";
import { PRODUCT_NAME, PRODUCT_SLUG, pageTitle } from "./brand";
import { SRC_DIR, sourceFiles } from "./testing/sourceFiles";

describe("the product name", () => {
  it("is David-Smash, and its network slug matches", () => {
    expect(PRODUCT_NAME).toBe("David-Smash");
    expect(PRODUCT_SLUG).toBe("david-smash");
  });

  it("titles every screen", () => {
    expect(menu.title).toBe("Main Menu · David-Smash");
    const screens: [string, { title?: unknown }][] = [
      ["Main Menu", menu],
      ["Results", results],
      ["Character Select", fighters],
      ["Rules", rules],
      ["Stage Select", stage],
      ["Controls", controls],
      ["No Contest", notFound],
    ];
    for (const [screen, meta] of screens) expect(meta.title).toBe(pageTitle(screen));
  });

  it("namespaces Trystero rooms under the new name", () => {
    expect(DEFAULT_APP_ID).toBe(PRODUCT_SLUG);
  });

  it("leaves the old name nowhere a player can read it", () => {
    const offenders: string[] = [];
    for (const dir of ["app", "components"]) {
      for (const file of sourceFiles(join(SRC_DIR, dir))) {
        // "Super Smash Bros." is the game being replicated, and stays.
        if (/Super Smash(?! Bros)/.test(readFileSync(file, "utf8"))) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
