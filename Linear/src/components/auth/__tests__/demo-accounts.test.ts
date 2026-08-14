// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/components/auth/home";

/**
 * The sign-in page's demo panel, checked against the fixture it advertises.
 *
 * `home.ts` transcribes the four addresses rather than importing them, because
 * `src/lib/seed.ts` is the fixture *builder*: importing it would pull the
 * schema, the order-key library and a scrypt implementation into a page's
 * module graph for the sake of four strings.
 *
 * A transcription needs a drift check, so this one reads the seed's **source**
 * and asserts each address still appears in it. Reading the text rather than
 * executing the module is the point — it costs nothing, boots no database, and
 * fails for exactly the reason that matters: someone renamed a demo account and
 * the sign-in page now offers a login that cannot work.
 *
 * `fileURLToPath`, not `URL.pathname`: this repository lives under a directory
 * with a space in its name, and `.pathname` hands back a percent-encoded path
 * that resolves to nothing (`vitest.config.mts` hit the same thing).
 */

const SEED_SOURCE = readFileSync(
  fileURLToPath(new URL("../../../lib/seed.ts", import.meta.url)),
  "utf8",
);

describe("demo accounts", () => {
  it("offers exactly the four seeded permission levels", () => {
    expect(DEMO_ACCOUNTS.map((account) => account.label)).toEqual([
      "Owner",
      "Admin",
      "Member",
      "Guest",
    ]);
  });

  it("names addresses the seed actually creates", () => {
    for (const account of DEMO_ACCOUNTS) {
      expect(SEED_SOURCE, account.email).toContain(`"${account.email}"`);
    }
  });

  it("advertises the password the seed uses", () => {
    expect(SEED_SOURCE).toContain(`export const DEMO_PASSWORD = "${DEMO_PASSWORD}"`);
  });

  it("describes the memberships the fixture builds, not the stale README", () => {
    // `e2e/README.md` puts the member in Design and the guest in Design only.
    // `src/lib/seed.ts` puts the member in Engineering and Operations and the
    // guest in Engineering alone — Design is private, with only the owner and
    // the admin in it. The panel follows the code.
    const guest = DEMO_ACCOUNTS.find((account) => account.label === "Guest");
    expect(guest?.role).toBe("Engineering only");

    const design = SEED_SOURCE.slice(
      SEED_SOURCE.indexOf('key: "des"'),
      SEED_SOURCE.indexOf('key: "ops"'),
    );
    expect(design).toContain("private: true");
    expect(design).not.toContain('user: "guest"');
  });
});
