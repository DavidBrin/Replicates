import type { Metadata } from "next";
import Link from "next/link";

import { AcceptInvite } from "@/components/auth/accept-invite";
import { AuthMessage, AuthShell } from "@/components/auth/auth-shell";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { Avatar } from "@/components/ui/avatar";
import type { WorkspaceRole } from "@/domain/entities";
import { currentUser } from "@/lib/auth/current-user";
import { previewInvite } from "@/lib/auth/invites";

export const metadata: Metadata = { title: "Join a workspace" };

/**
 * `/invite/[token]`.
 *
 * ## What the page may show before anyone is signed in
 *
 * Whoever holds the link is not yet a principal, so the preview is exactly what
 * `previewInvite` returns and nothing more: the workspace name, who invited
 * you, the role, and the team names. Not the member list, not issue counts.
 *
 * `previewInvite` returns `null` for anything unusable — wrong token, expired,
 * revoked, already spent — so this page cannot tell one from another and cannot
 * be used to probe for real workspaces. The *acceptance* endpoint is allowed to
 * be specific, because by then the caller has demonstrably presented a token
 * that matches a row.
 *
 * ## Two paths, one action
 *
 * Signed in: one button. Signed out: name, email and password, submitted to
 * `/api/auth/signup` with the token attached, which creates the account and
 * redeems the invitation in the same request — no window in which the account
 * exists and the membership does not. Both buttons carry
 * `accept-invite-submit`, because from the outside they are the same action
 * with two preconditions.
 *
 * The address field starts empty even when the invitation named one. The link
 * is a bearer token and may have been forwarded, so pre-filling it would show
 * the intended recipient's email address to whoever opened the link — see
 * `previewInvite`, which no longer returns it. The person the invitation is
 * for knows their own address; nobody else is entitled to it.
 *
 * ## `DECISIONS.md` D11, restated on the page
 *
 * There is no email provider on a free host, so an invite is a bearer link:
 * whoever holds it may accept it, and `invites.email` is a hint rather than a
 * check. That is a real property of the deployment and the page says so, rather
 * than implying an address was verified.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [invite, user] = await Promise.all([
    previewInvite(token),
    currentUser(),
  ]);

  if (invite === null) {
    return (
      <AuthShell
        title="This invitation is not usable"
        subtitle="It may have expired, been revoked, or already been accepted."
        footer={
          <>
            Ask whoever invited you for a fresh link, or{" "}
            <Link href="/signin" className="text-accent-text hover:underline">
              sign in
            </Link>{" "}
            if you already have an account.
          </>
        }
      >
        <AuthMessage testId="invite-invalid">
          Invitation links are single-use and expire. Nothing else about it can
          be shown, because the link is the only credential it carries.
        </AuthMessage>
      </AuthShell>
    );
  }

  const workspaceHome = `/${invite.workspaceUrlKey}/my-issues`;

  return (
    <AuthShell
      title={`Join ${invite.workspaceName}`}
      subtitle={
        user === null
          ? "Create an account and you are in — one step."
          : `You are signed in as ${user.email}.`
      }
      footer={
        user === null ? (
          <>
            Already have an account?{" "}
            <Link href="/signin" className="text-accent-text hover:underline">
              Sign in
            </Link>{" "}
            first, then open this link again.
          </>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        <section
          data-testid="invite-preview"
          className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-subtle p-3"
        >
          <div className="flex items-center gap-2">
            <Avatar
              id={invite.inviterName}
              name={invite.inviterName}
              size={20}
              decorative
            />
            <p className="min-w-0 text-small text-secondary">
              <span className="[font-weight:var(--weight-medium)] text-primary">
                {invite.inviterName}
              </span>{" "}
              invited you as{" "}
              <span className="text-primary">{ROLE_SENTENCE[invite.role]}</span>.
            </p>
          </div>

          {invite.teamNames.length > 0 ? (
            <p className="text-micro text-quaternary">
              Teams: {invite.teamNames.join(", ")}
            </p>
          ) : (
            <p className="text-micro text-quaternary">
              No teams yet — an admin can add you to one afterwards.
            </p>
          )}

          <p className="text-micro text-quaternary">
            This link is the invitation. There is no email step, so anyone
            holding it can accept it.
          </p>
        </section>

        {user === null ? (
          <SignUpForm
            inviteToken={token}
            submitLabel={`Join ${invite.workspaceName}`}
            submitTestId="accept-invite-submit"
            redirectTo={workspaceHome}
          />
        ) : (
          <AcceptInvite token={token} redirectTo={workspaceHome} />
        )}
      </div>
    </AuthShell>
  );
}

/**
 * How the invited role reads in a sentence.
 *
 * A keyed record rather than a ternary that compares the role to a literal, and
 * not only for style: `domain/__tests__/policy.test.ts` greps the whole of
 * `src/` for exactly that comparison and fails the build on one, because it is
 * the shape an authorization decision takes when it escapes the policy table.
 * This is display copy and would have been a false positive — but a grep that
 * has to be argued with stops being a grep. `Record<WorkspaceRole, string>` also
 * means adding a role to the enum is a compile error here rather than a blank
 * in the middle of a sentence.
 */
const ROLE_SENTENCE: Readonly<Record<WorkspaceRole, string>> = Object.freeze({
  owner: "a workspace owner",
  admin: "a workspace admin",
  member: "a workspace member",
  guest: "a guest — you will see only what you are added to",
});
