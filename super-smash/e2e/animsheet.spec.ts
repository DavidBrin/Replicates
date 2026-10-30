import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { expect, test } from "@playwright/test";

/**
 * `scripts/animsheet.mjs` waits for the lab's contact sheet to say it is drawn (`data-drawn`) or that it cannot be
 * (`data-error`, with the reason: the bake did not load, or the fighter's model would not build). The lab's half of
 * that is pinned in `src/app/anim/Lab3D.test.tsx`; this pins the script's half (Task 21 re-review: dropping the
 * `data-error` wait left every test green, and a failure became a 30 s timeout). The page is the spec's own, the
 * lab's controls and a sheet that says one or the other: no game, no model. The PNG goes to Playwright's
 * git-ignored output folder.
 */

/** The lab's controls as the script drives them (`/anim`: Fighter, Action, the pause button, the title), around `sheet`. */
const labPage = (sheet: string) => `<!doctype html><html><head><title>lab</title></head><body>
<h1>land (4 frames)</h1>
<label>Fighter <select><option>mario</option></select></label>
<label>Action <select><option>land</option></select></label>
<button>pause</button>
${sheet}
</body></html>`;

/** Serve `html` at `/anim` on a free local port until `close`. */
async function serveLab(html: string): Promise<{ base: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    res.writeHead(req.url === "/anim" ? 200 : 404, { "content-type": "text/html" });
    res.end(req.url === "/anim" ? html : "");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

/** Run the script to its end: exit code, output and how long it took. */
function animsheet(args: string[]): Promise<{ code: number; stdout: string; stderr: string; ms: number }> {
  const start = Date.now();
  return new Promise((resolve) => {
    execFile(process.execPath, ["scripts/animsheet.mjs", ...args], { cwd: process.cwd(), timeout: 90_000 }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === "number" ? error.code : -1;
      resolve({ code, stdout, stderr, ms: Date.now() - start });
    });
  });
}

test.describe("animsheet.mjs waits for the sheet's own word", () => {
  test.describe.configure({ timeout: 120_000 });

  test("reports a sheet that cannot be drawn at once, with the lab's reason, instead of waiting out its 30 s", async () => {
    const lab = await serveLab(labPage(`<canvas aria-label="Contact sheet" width="40" height="20" data-error="the bake did not load (HTTP 404)"></canvas>`));
    try {
      const out = test.info().outputPath("anim-mario-land.png");
      const r = await animsheet(["land", "--base", lab.base, "--out", out]);
      expect(r.code, r.stderr).toBe(1);
      expect(r.stderr).toContain("the contact sheet could not be drawn: the bake did not load (HTTP 404)");
      // Its own wait is 30 s; a run that ignored `data-error` would sit that out, then fail on a timeout.
      expect(r.ms).toBeLessThan(20_000);
      expect(existsSync(out)).toBe(false);
    } finally {
      await lab.close();
    }
  });

  test("photographs a sheet that says it is drawn", async () => {
    const lab = await serveLab(labPage(`<canvas aria-label="Contact sheet" width="40" height="20" data-drawn="true"></canvas>`));
    try {
      const out = test.info().outputPath("anim-mario-land.png");
      const r = await animsheet(["land", "--base", lab.base, "--out", out]);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toContain("land (4 frames)");
      expect(existsSync(out)).toBe(true);
    } finally {
      await lab.close();
    }
  });
});
