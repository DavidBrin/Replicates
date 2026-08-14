import { expect, test } from "@playwright/test";

import { signIn, signOut } from "./fixtures";

/**
 * The multi-user permission journey.
 *
 * This is the spec the brief actually asks for: *"multiple people can actually
 * be added/removed with member/admin privileges, and they can both add to and
 * edit the project if added to it."* Everything else in the suite checks that
 * a feature works; this one checks that it works **differently for different
 * people**, which is the only way to tell a real authorization model from a
 * `role === "admin"` check sprinkled through the components.
 *
 * It runs serially against one seeded workspace, because the assertions are
 * about state accumulating across users: an invite issued by one is accepted
 * by another, and a removal in one step must be visible in the next.
 */

test.describe.configure({ mode: "serial" });

/**
 * A password for accounts created *during* the journey.
 *
 * The seeded demo accounts use `demo1234`, which sign-in still accepts — it
 * checks the hash, not the shape. Sign-up enforces a twelve-character minimum,
 * so anyone this suite creates needs a longer one.
 */
const NEW_ACCOUNT_PASSWORD = "correct-horse-battery";

test.describe("workspace membership", () => {
  test("an admin can invite someone, and the invitee lands in the right teams", async ({
    page,
  }) => {
    await signIn(page, "admin@demo.test");
    await page.goto("/demo/settings/members");

    await page.getByTestId("invite-button").click();
    await page.getByTestId("invite-email").fill("newcomer@demo.test");
    await page.getByTestId("invite-role").selectOption("member");
    await page.getByTestId("invite-submit").click();

    // No email provider: the invite is a link, surfaced in the UI to be copied.
    const link = await page.getByTestId("invite-link").inputValue();
    expect(link).toContain("/invite/");

    await signOut(page);
    await page.goto(new URL(link).pathname);
    await page.getByTestId("signup-name").fill("Newcomer");
    // Typed, not pre-filled. The preview endpoint deliberately stopped
    // returning `invites.email` (see `lib/auth/invites.ts`): the link is a
    // bearer token, so pre-filling handed the invited person's address to
    // whoever opened it, unauthenticated. The recipient knows their own
    // address; the convenience was not worth the disclosure.
    await page.getByTestId("signup-email").fill("newcomer@demo.test");
    // Twelve characters minimum — length is the only rule the app enforces,
    // which is why the seeded eight-character demo password cannot be reused
    // for a *new* account even though it still signs the demo users in.
    await page.getByTestId("signup-password").fill(NEW_ACCOUNT_PASSWORD);
    await page.getByTestId("accept-invite-submit").click();

    await expect(page.getByTestId("sidebar")).toBeVisible();
  });

  test("a member cannot reach workspace administration", async ({ page }) => {
    await signIn(page, "member@demo.test");
    await page.goto("/demo/settings/members");

    // The page must refuse rather than render a read-only version of itself:
    // a members table a member can see is a members table they will try to use.
    await expect(page.getByTestId("members-table")).toHaveCount(0);
    await expect(page.getByTestId("invite-button")).toHaveCount(0);
  });

  test("an admin can promote a member — and then loses power over them", async ({
    page,
  }) => {
    /**
     * Promotion to admin is deliberately one-way for the promoter.
     *
     * An admin may raise a member to their own rank (R1: never *grant* above
     * your own rank — equal is fine), but may not act on an equal rank
     * afterwards (R2). So the moment the promotion lands, the promoter can no
     * longer demote or remove that person; only an owner can.
     *
     * That is Linear's documented behaviour and a real privilege-proliferation
     * risk, which is exactly why it is pinned here rather than left to be
     * rediscovered as a bug report.
     */
    await signIn(page, "admin@demo.test");
    await page.goto("/demo/settings/members");

    const row = page.getByTestId("member-row-newcomer@demo.test");
    await expect(row).toBeVisible();

    await row.getByTestId("member-role-newcomer@demo.test").selectOption("admin");
    await expect(row.getByTestId("member-role-newcomer@demo.test")).toHaveValue(
      "admin",
    );

    // The optimistic value above is the table's, not the server's. The removal
    // that follows only means anything once the promotion has *committed* —
    // against a still-`member` account it would legitimately succeed and this
    // test would assert the opposite of what it is named for. `data-pending`
    // is how the table says which of the two is on screen.
    await expect(page.getByTestId("members-table")).toHaveAttribute(
      "data-pending",
      "false",
    );

    // The one-way door: a peer admin is now out of reach.
    await row.getByRole("button", { name: /remove/i }).click();
    await page.getByRole("button", { name: /^remove$/i }).click();
    await expect(page.getByTestId("toast")).toBeVisible();

    // Assert on what the *server* kept, not on what the table is showing.
    // Removal is optimistic: the row disappears the moment it is confirmed and
    // comes back when the refusal lands. Asserting the row directly would be
    // asserting the restore's timing; reloading asks the only question that
    // matters — is this person still in the workspace.
    await page.reload();
    await expect(
      page.getByTestId("member-row-newcomer@demo.test"),
    ).toBeVisible();
  });

  // Depends on the promotion above having landed.
  test("an owner can remove an admin", async ({ page }) => {
    await signIn(page, "owner@demo.test");
    await page.goto("/demo/settings/members");

    const row = page.getByTestId("member-row-newcomer@demo.test");
    await row.getByRole("button", { name: /remove/i }).click();
    await page.getByRole("button", { name: /^remove$/i }).click();
    await expect(row).toHaveCount(0);
    // The row leaves optimistically, so its absence is not yet evidence the
    // removal was written. Wait for the table to have nothing outstanding.
    await expect(page.getByTestId("members-table")).toHaveAttribute(
      "data-pending",
      "false",
    );
  });

  test("the last owner cannot be demoted", async ({ page }) => {
    // The rule that keeps a workspace administrable. It is enforced in a
    // transaction that locks the workspace row, so this assertion is about the
    // UI surfacing a refusal the server made — not about the button being
    // hidden.
    await signIn(page, "owner@demo.test");
    await page.goto("/demo/settings/members");

    const select = page.getByTestId("member-role-owner@demo.test");
    await select.selectOption("admin").catch(() => {
      // Some implementations disable the control outright, which is also fine.
    });

    await expect(page.getByTestId("toast")).toContainText(/last owner/i);
    await expect(select).toHaveValue("owner");
  });
});

test.describe("team scoping", () => {
  test("a guest sees only the teams they were added to", async ({ page }) => {
    await signIn(page, "guest@demo.test");
    await page.goto("/demo/my-issues");

    // Seeded into Engineering only; Design is private and Operations is not
    // theirs. A public team they are not in must be as invisible as a private
    // one — membership is the rule, privacy is a separate axis.
    await expect(page.getByTestId("sidebar-team-ENG")).toBeVisible();
    await expect(page.getByTestId("sidebar-team-DES")).toHaveCount(0);
    await expect(page.getByTestId("sidebar-team-OPS")).toHaveCount(0);
  });

  test("a guest cannot reach another team by URL", async ({ page }) => {
    // Hiding a link is not authorization. The route itself has to refuse.
    await signIn(page, "guest@demo.test");
    const response = await page.goto("/demo/team/DES/all");
    expect(response?.status()).toBeGreaterThanOrEqual(400);
    await expect(page.getByTestId("issue-list")).toHaveCount(0);
  });

  test("a private team is invisible to a full member too", async ({ page }) => {
    // Guests are the obvious case; the one that actually catches a bug is a
    // workspace member, who passes every "is this person in the workspace"
    // check and must still be refused.
    await signIn(page, "member@demo.test");
    const response = await page.goto("/demo/team/DES/all");
    expect(response?.status()).toBeGreaterThanOrEqual(400);
  });

  test("a member of a team can edit its issues", async ({ page }) => {
    await signIn(page, "member@demo.test");
    await page.goto("/demo/team/ENG/all");

    const firstRow = page.getByTestId("issue-list").getByTestId(/^issue-row-/).first();
    await firstRow.click();

    await page.getByTestId("issue-property-status").click();
    await page.getByTestId("status-picker").waitFor();
    await page.getByTestId("picker-option-started").first().click();

    await expect(page.getByTestId("issue-property-status")).toContainText(
      /progress/i,
    );
    await expect(page.getByTestId("issue-activity")).toContainText(
      /changed status/i,
    );
  });
});

test.describe("project membership grants edit rights", () => {
  /**
   * The one deliberate divergence from Linear, and the reason it is tested
   * rather than assumed: in Linear, project membership carries no permissions
   * at all — rights come from team membership. The brief asks for the
   * opposite, so this pair of tests pins the behaviour in both directions.
   */

  test("a non-member cannot even open the project", async ({ page }) => {
    // Website Redesign lives entirely inside the private Design team. It is
    // the only project in the seeded workspace the guest cannot reach through
    // team membership, which is what makes the rest of this block meaningful.
    await signIn(page, "guest@demo.test");
    const response = await page.goto("/demo/project/website-redesign");
    expect(response?.status()).toBeGreaterThanOrEqual(400);
  });

  test("an owner can add someone to a project", async ({ page }) => {
    await signIn(page, "owner@demo.test");
    await page.goto("/demo/project/website-redesign");

    await page.getByTestId("project-add-member").click();
    await page.getByTestId("picker-option-guest@demo.test").click();

    // The row appears before the server has been asked — that is the product
    // behaviour and it is asserted first.
    await expect(
      page.getByTestId("project-member-guest@demo.test"),
    ).toBeVisible();

    // …and then the grant is asserted as a *grant*. Everything after this test
    // depends on the row existing in the database, and an optimistic row is
    // indistinguishable from one that landed until the panel says so.
    await expect(page.getByTestId("project-members")).toHaveAttribute(
      "data-pending",
      "false",
    );
  });

  test("and then that person can open and edit it", async ({ page }) => {
    await signIn(page, "guest@demo.test");
    await page.goto("/demo/project/website-redesign");

    await expect(page.getByTestId("project-header")).toBeVisible();

    const name = page.getByTestId("project-header").getByRole("textbox").first();
    await name.fill("Website redesign (edited by a project member)");
    await name.blur();

    // Committed on blur, but the field shows the new value whether or not the
    // server has taken it. Reloading before the header settles would race the
    // `PATCH` against the render of the page that is meant to prove it.
    await expect(page.getByTestId("project-header")).toHaveAttribute(
      "data-pending",
      "false",
    );

    await page.reload();
    // The name is an `<input>` for anybody who may edit — which, on this page,
    // is the whole point — so it is read with `toHaveValue`. `toContainText` on
    // the header cannot see it: a field's value is not text content, and the
    // only prose the header would match is the description.
    await expect(
      page.getByTestId("project-header").getByRole("textbox").first(),
    ).toHaveValue("Website redesign (edited by a project member)");
  });

  /**
   * The other half of the deviation, and the harder half.
   *
   * Website Redesign lives entirely inside the private Design team, which the
   * guest is deliberately not in (`e2e/README.md`). So filing into it is the one
   * case where `proj:member` has to carry the request on its own: rows 39 and 41
   * of the matrix (`issue.create`, `issue.update_any`) grant it, which is
   * `DECISIONS.md` D8 — "project membership additionally grants edit on the
   * project and its issues" — and nothing else about this actor does.
   *
   * `POST /api/issues` used to refuse with a 403 before ever consulting that
   * grant, because it pre-gated on `canViewTeam`. It now authorizes
   * `issue.create` against the whole resource, team *and* project, so the
   * project role is in scope where the matrix says it should be (D22).
   */
  test("and can add an issue to it", async ({ page }) => {
    await signIn(page, "guest@demo.test");
    await page.goto("/demo/project/website-redesign");

    await page.getByTestId("new-issue-button").click();
    await page.getByTestId("new-issue-title").fill("Added by a project member");
    await page.getByTestId("new-issue-submit").click();

    await expect(page.getByTestId("project-issues")).toContainText(
      "Added by a project member",
    );
  });

  // Depends on the add above having persisted.
  test("removing them from the project takes the access away again", async ({
    page,
  }) => {
    await signIn(page, "owner@demo.test");
    await page.goto("/demo/project/website-redesign");
    await page
      .getByTestId("project-member-guest@demo.test")
      .getByRole("button", { name: /remove/i })
      .click();

    // Same rule in reverse: the row goes optimistically, and signing back in as
    // the guest before the revocation is written would test nothing.
    await expect(page.getByTestId("project-members")).toHaveAttribute(
      "data-pending",
      "false",
    );

    await signOut(page);
    await signIn(page, "guest@demo.test");
    const response = await page.goto("/demo/project/website-redesign");
    expect(response?.status()).toBeGreaterThanOrEqual(400);
  });
});
