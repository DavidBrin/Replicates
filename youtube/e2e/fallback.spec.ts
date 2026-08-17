import { expect, gotoAndSettle, signIn, test } from "./support/fixtures";

/**
 * The path taken by a browser that cannot encode in the page.
 *
 * `playwright.config.ts` routes this file to the `no-webcodecs` project by
 * name, and the `withoutWebCodecs` fixture is what actually removes the API —
 * the project entry alone does nothing, which is the trap the config used to
 * describe as though it were configured.
 *
 * Roughly one browser in twenty lands here. The upload path becomes "send the
 * source untouched", the playback path becomes a single progressive rendition
 * over HTTP `Range`, and nothing in an ordinary run exercises either. It is
 * the half of the product most likely to rot, because it is invisible to
 * everyone developing it.
 */

test.describe("without WebCodecs", () => {
  test("the API really is gone before any page script runs", async ({
    page,
    withoutWebCodecs,
  }) => {
    void withoutWebCodecs;
    await gotoAndSettle(page, "/");

    // Both spellings: a detection may use `in` or a truthiness check, and a
    // fixture that only satisfies one of them tests the wrong thing.
    const state = await page.evaluate(() => ({
      present: "VideoEncoder" in globalThis,
      truthy: Boolean(
        (globalThis as unknown as Record<string, unknown>).VideoEncoder,
      ),
    }));

    expect(state.present).toBe(false);
    expect(state.truthy).toBe(false);
  });

  /**
   * The studio has to say what it will do, not fail.
   *
   * The distinction worth testing is between "this browser cannot upload" —
   * which is false and would lose the upload — and "this browser will upload
   * the file as-is", which is the real behaviour and is what the fallback
   * exists for.
   */
  test("the upload page still offers to upload", async ({
    page,
    withoutWebCodecs,
  }) => {
    void withoutWebCodecs;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    // Signed in, because uploading needs a channel owner — and because this
    // assertion originally ran signed out, found the "only a signed-in owner
    // can create one" notice instead of the picker, and was what surfaced
    // that the application had no sign-in route.
    await signIn(page);
    await page.goto("/studio/upload", { waitUntil: "domcontentloaded" });

    expect(errors).toEqual([]);
    // `.first()`: the picker renders the visible button and the file input's
    // own labelled control, both named "Select files". Either being present is
    // the property under test — that the fallback browser is offered an
    // upload rather than told it cannot.
    await expect(
      page.getByRole("button", { name: /select files/i }).first(),
    ).toBeVisible();
  });

  test("the watch page renders rather than throwing", async ({
    page,
    withoutWebCodecs,
  }) => {
    void withoutWebCodecs;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await gotoAndSettle(page, "/watch?v=vid_e2e_0001");

    // The engine cannot build a laddered pipeline without MSE-adjacent APIs,
    // and the component's contract is that it surfaces that rather than
    // rendering a black rectangle. Either outcome is fine here; an unhandled
    // rejection is not, and that is what this asserts.
    expect(errors).toEqual([]);
    await expect(
      page.getByRole("heading", { name: "Reading a river" }),
    ).toBeVisible();
  });
});
