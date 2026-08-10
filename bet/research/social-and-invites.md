# Social Graph, Invites & Group Chat — Implementation Reference

Grounded reference for a friend-based betting app. Covers friend/follow models, usernames, invites,
the bet-creation wizard, group chat architecture, notifications, and the authorization/policy layer.
SQL is Postgres; ORM examples are Prisma; runtime examples are TypeScript on a Next.js/Vercel stack.

---

## 1. Friend/follow models

### 1.1 How the real products do it

**Instagram — asymmetric follow, with a private-account gate.**
Instagram's graph is directed: A follows B does not imply B follows A ("followers" vs "following" are
separate edges). Public accounts expose the graph freely; **private accounts gate the edge itself** —
a follow request is created in a pending state and must be approved before the edge is written. The
critical privacy property, confirmed by both product behavior and the restrictions third-party API
clients keep hitting: **when an account is private, only its approved followers can see its
followers/following lists at all** — a stranger (even one who is logged in and can see the profile
exists) cannot enumerate who a private user is connected to. This is not a UI nicety, it's enforced at
the data-access layer — Instagram's own Graph API restricts follower-list access for non-owners, and
third-party scraping tools exist specifically because there's no legitimate path around it
([Instagram Graph API: what you can and cannot get](https://www.keyapi.ai/blog/instagram-graph-api-get-followers-list-following/), [private follow-list access is API/architecture-level restricted](https://github.com/dilame/instagram-private-api/issues/1265)).
Takeaway for a betting app: **friend-list enumeration must be blocked by default for everyone but the
owner**, not just hidden in the client.

**Facebook — symmetric friendship.**
Facebook's is the canonical symmetric model: a friend request is a directed proposal, but acceptance
creates one *undirected* relationship. There is no "following" without "friending" (Follow exists as a
separate, weaker, asymmetric primitive layered on top for public content, but the core social graph is
symmetric friendship). This is the right model for a betting app because money/positions are shared
between two named parties — the relationship needs to mean "we both agreed," not "I'm watching you."

**Snapchat — mutual friends as a first-class signal.**
Snapchat also uses (mostly) symmetric friending, but is notable for surfacing "mutual friends count"
and "quick add" suggestions very aggressively, because on Snapchat the *discovery* problem (how do I
find people I know) matters as much as the connection state. For a betting app, mutual-friends count is
the highest-signal ingredient for "people you may want to bet with."

**Discord — friend requests as a queue with block as a hard wall.**
Discord's relationship model is explicit and typed: `PendingIncoming`, `PendingOutgoing`, `Friend`,
`Blocked` (`NONE` is implicit — the absence of a row) ([Discord Social SDK — relationship types](https://discord.com/developers/docs/social-sdk/friends.html), [Discord friend request states](https://support.discord.com/hc/en-us/articles/217674288-Friends-List-101)).
Sending a friend request to someone who blocked you silently no-ops (the UI never confirms it was
blocked — it just never transitions past "pending"), which prevents block-status probing. Discord also
publishes explicit scale limits worth mirroring in your own guardrails: up to 1,000 accepted friends,
1,500 pending-incoming, 1,000 pending-outgoing requests per account.

### 1.2 State machine comparison

| Product | Edge type | States | Enumerable by others? |
|---|---|---|---|
| Instagram (public) | directed (follow) | none → following | yes, list is public |
| Instagram (private) | directed (follow) | none → requested → approved | **no — 403/empty unless viewer is an approved follower or the owner** |
| Facebook | undirected (friend) | none → requested → friends; either side → blocked | no, friend list has its own per-user visibility setting, default "friends only" |
| Snapchat | undirected (friend) | none → requested → friends | no, but *mutual count* is shown to non-friends as a discovery hint |
| Discord | undirected (friend) | none → pending_outgoing/pending_incoming → friends; blocked (asymmetric, silently absorbs requests) | no |

### 1.3 Recommended model for the betting app

**Symmetric friendship, backed by a directed request table.** Reasons: (1) money and positions are
always between two consenting parties, so the *relationship* should mean mutual consent, matching
Facebook/Discord, not Instagram's asymmetric follow; (2) a directed request table lets you cleanly
represent "who initiated," "who can cancel vs. who can accept," and block state without overloading a
single symmetric row with sender semantics.

**State machine:**

```
                    ┌──────────┐
        ┌──────────▶│ pending  │──────────┐
        │           └──────────┘          │
   send_request      accept │  decline/    │ cancel
        │                   │  expire      │ (by sender)
        │                   ▼              ▼
   ┌─────────┐       ┌───────────┐   ┌──────────┐
   │  none   │◀──────│ accepted  │   │  none    │
   └─────────┘ unfriend └───────────┘   └──────────┘
        │
        │ block (either party, from any state)
        ▼
   ┌─────────┐
   │ blocked │──── unblock ───▶ none
   └─────────┘
```

- `none → pending`: A sends a `friend_requests` row targeting B. Idempotent — if B already has a
  pending request to A, auto-accept both (simultaneous mutual request) instead of creating a duplicate.
- `pending → accepted`: B accepts. Write a single symmetric `friendships` row (see schema — store it
  with `user_low_id < user_high_id` so there's exactly one row per pair, not two).
- `pending → none`: sender cancels, or receiver declines, or the request expires (recommend 30–90 days
  TTL, matching most social apps' quiet-expiry behavior rather than hard-erroring on stale requests).
- `accepted → none`: either party unfriends. Delete the symmetric row; this is silent to the other party
  (no "X unfriended you" notification — this matches every major product's norm, since it doubles as a
  soft block/avoidance mechanism).
- `any → blocked`: either party blocks the other. Blocking **deletes** any friendship/pending request
  and additionally hides the blocker from the blocked user's search/suggestions. A blocked user's future
  `send_request` calls must silently fail (return success to avoid leaking block state, mirroring
  Discord's behavior) rather than surfacing "you are blocked."
- `blocked → none`: unblock. Does not restore the prior friendship — a fresh request is required.

### 1.4 Schema

```sql
-- Directed request/invitation edge. One row per outstanding or resolved request.
CREATE TABLE friend_requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    responded_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '60 days'),
    CONSTRAINT no_self_request CHECK (sender_id <> recipient_id)
);

-- Only one *live* (pending) request per ordered pair — application also checks the reverse pair
-- to auto-accept simultaneous requests before insert.
CREATE UNIQUE INDEX uq_friend_requests_live_pair
    ON friend_requests (sender_id, recipient_id)
    WHERE status = 'pending';

CREATE INDEX idx_friend_requests_recipient_pending
    ON friend_requests (recipient_id) WHERE status = 'pending';
CREATE INDEX idx_friend_requests_sender_pending
    ON friend_requests (sender_id) WHERE status = 'pending';

-- Symmetric, undirected edge. Always store with user_a_id < user_b_id (enforced by check + app code)
-- so a pair has exactly one row and no duplicate-direction bugs are possible.
CREATE TABLE friendships (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_a_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    source_request_id UUID REFERENCES friend_requests(id) ON DELETE SET NULL,
    CONSTRAINT ordered_pair CHECK (user_a_id < user_b_id),
    CONSTRAINT uq_pair UNIQUE (user_a_id, user_b_id)
);
CREATE INDEX idx_friendships_user_a ON friendships (user_a_id);
CREATE INDEX idx_friendships_user_b ON friendships (user_b_id);

-- Blocks are directed and independent of friendship state (you can block a non-friend).
CREATE TABLE user_blocks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    blocker_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT no_self_block CHECK (blocker_id <> blocked_id),
    CONSTRAINT uq_block UNIQUE (blocker_id, blocked_id)
);
CREATE INDEX idx_blocks_blocked ON user_blocks (blocked_id);
```

Prisma equivalent (abridged):

```prisma
model FriendRequest {
  id           String   @id @default(uuid())
  senderId     String
  recipientId  String
  status       FriendRequestStatus @default(PENDING)
  createdAt    DateTime @default(now())
  respondedAt  DateTime?
  expiresAt    DateTime @default(dbgenerated("(now() + interval '60 days')"))
  sender       User @relation("SentRequests", fields: [senderId], references: [id])
  recipient    User @relation("ReceivedRequests", fields: [recipientId], references: [id])

  @@unique([senderId, recipientId], name: "uq_live_pair") // partial-uniqueness enforced via raw migration
}

enum FriendRequestStatus { PENDING ACCEPTED DECLINED CANCELLED EXPIRED }

model Friendship {
  id              String   @id @default(uuid())
  userAId         String
  userBId         String
  createdAt       DateTime @default(now())
  sourceRequestId String?
  userA           User @relation("FriendA", fields: [userAId], references: [id])
  userB           User @relation("FriendB", fields: [userBId], references: [id])

  @@unique([userAId, userBId])
}
```

### 1.5 Required queries

```sql
-- Are user A and B friends?
SELECT EXISTS (
  SELECT 1 FROM friendships
  WHERE user_a_id = LEAST($1, $2) AND user_b_id = GREATEST($1, $2)
) AS are_friends;

-- Mutual friends count between viewer and target (works even if target's list is private,
-- because this is a set-intersection computed server-side, never a list handed to the client).
SELECT COUNT(*) AS mutual_count
FROM (
  SELECT CASE WHEN user_a_id = $1 THEN user_b_id ELSE user_a_id END AS friend_id
  FROM friendships WHERE user_a_id = $1 OR user_b_id = $1
) AS a_friends
JOIN (
  SELECT CASE WHEN user_a_id = $2 THEN user_b_id ELSE user_a_id END AS friend_id
  FROM friendships WHERE user_a_id = $2 OR user_b_id = $2
) AS b_friends USING (friend_id);

-- Friend suggestions: rank candidates who are NOT already friends/blocked/pending,
-- by mutual-friend count (Snapchat-style), then by shared-market history.
WITH my_friends AS (
  SELECT CASE WHEN user_a_id = $1 THEN user_b_id ELSE user_a_id END AS friend_id
  FROM friendships WHERE user_a_id = $1 OR user_b_id = $1
),
candidates AS (
  SELECT CASE WHEN f.user_a_id = mf.friend_id THEN f.user_b_id ELSE f.user_a_id END AS candidate_id
  FROM friendships f
  JOIN my_friends mf ON mf.friend_id = f.user_a_id OR mf.friend_id = f.user_b_id
)
SELECT candidate_id, COUNT(*) AS mutual_count
FROM candidates
WHERE candidate_id <> $1
  AND candidate_id NOT IN (SELECT friend_id FROM my_friends)
  AND candidate_id NOT IN (
        SELECT recipient_id FROM friend_requests WHERE sender_id = $1 AND status = 'pending'
        UNION
        SELECT sender_id FROM friend_requests WHERE recipient_id = $1 AND status = 'pending'
      )
  AND candidate_id NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = $1)
  AND candidate_id NOT IN (SELECT blocker_id FROM user_blocks WHERE blocked_id = $1)
GROUP BY candidate_id
ORDER BY mutual_count DESC
LIMIT 20;
```

### 1.6 Privacy rule: friend lists are never enumerable by other users

Enforced at the query/authorization layer, not the UI:

- `GET /users/:id/friends` returns the full list **only if `requesterId === id`**. For any other
  caller, it returns `403` (or an empty list with `200` — prefer `403` internally but `200 []`
  externally to avoid leaking "does this user exist" via status-code asymmetry — see §2.5).
- The only cross-user signal ever exposed is a **count**, and only for mutual friends between the
  viewer and the target (`mutual_count` above), never the underlying list of a third party.
- No endpoint accepts `userId` + returns another arbitrary user's edges. Every friends-list query is
  implicitly scoped to `ctx.currentUserId`.
- Rate-limit and audit-log the mutual-count endpoint itself — it's a narrow but real oracle (repeated
  calls against many targets can reconstruct a graph), so cap it (e.g. 30 calls/min/user) same as the
  search endpoint in §2.

---

## 2. Username systems

### 2.1 Storage: uniqueness + case-insensitive lookup

Two viable approaches, `citext` is preferred for new schemas because it makes case-insensitivity
implicit everywhere (joins, unique constraints, `WHERE` clauses) without remembering to call `lower()`
at every call site ([citext eliminates lower() calls and lets a PK be case-insensitive](https://dev.to/devinclark/case-insensitive-text-columns-in-postgres-with-citext-2o57), [citext vs functional lower() index tradeoffs](https://www.bytebase.com/blog/postgres-case-sensitivity/)):

```sql
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username        CITEXT NOT NULL,        -- "DavidB" and "davidb" collide
    display_name    TEXT NOT NULL,           -- free-form, not unique, can contain emoji/spaces
    email           CITEXT UNIQUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_username UNIQUE (username)
);
```

If you'd rather avoid an extra extension (e.g. managed Postgres that restricts extensions), the
functional-index alternative:

```sql
ALTER TABLE users ADD COLUMN username TEXT NOT NULL;
CREATE UNIQUE INDEX uq_users_username_lower ON users (lower(username));
-- every lookup must then explicitly do: WHERE lower(username) = lower($1)
```

**Recommendation:** `citext` for `username` and `email`. It's a single extension, well-supported on RDS/
Supabase/Neon, and removes an entire class of "forgot to lowercase" bugs.

### 2.2 Reserved names & handle format

```sql
CREATE TABLE reserved_usernames (
    username    CITEXT PRIMARY KEY,
    reason      TEXT NOT NULL  -- 'system' | 'brand' | 'offensive' | 'impersonation-risk'
);
-- seed: admin, support, help, api, root, moderator, katalyxt, bet, official, everyone, here, deleted-user, etc.
```

Handle format regex (applied at signup and rename): `^[a-z0-9_](?:[a-z0-9_]{1,18})[a-z0-9]$` roughly —
3–20 chars, lowercase letters/digits/underscore, must not start with an underscore-only run, no leading/
trailing underscore, no consecutive-only-numeric handles if you want to reduce bot-like names (optional).
Store the canonical (lowercased) form; **display case is a separate, purely cosmetic field** if you want
`DavidB` to render as typed — otherwise just keep `username` as the source of truth for both display and
lookup and use `display_name` for the truly free-form name shown next to it (this mirrors Instagram/
Twitter: `@handle` vs "Display Name").

```ts
export const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;
export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}
```

Validate server-side against `reserved_usernames` AND the regex on every create/rename — never trust
client-side regex alone.

### 2.3 Search-by-prefix

For an app with tens of thousands to low millions of users, `pg_trgm` GIN index gives fast prefix *and*
substring/fuzzy matching without a separate search service
([pg_trgm trigram indexing for autocomplete](https://benwilber.github.io/programming/2024/08/21/pg-trgm-autocomplete.html), [GIN trigram index makes leading-wildcard LIKE fast](https://www.tigerdata.com/learn/postgresql-extensions-pg-trgm)):

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_users_username_trgm ON users USING gin (username gin_trgm_ops);
CREATE INDEX idx_users_display_name_trgm ON users USING gin (display_name gin_trgm_ops);

-- prefix + substring search, ranked by similarity, friends-first (see invite wizard §4)
SELECT id, username, display_name,
       similarity(username, $1) AS score
FROM users
WHERE username % $1                       -- trigram similarity operator
   OR username ILIKE $1 || '%'            -- exact-prefix boost, index-assisted by the trgm GIN index too
ORDER BY (username ILIKE $1 || '%') DESC, score DESC
LIMIT 20;
```

If pure prefix search is all you need (no fuzzy/typo tolerance), a plain B-tree on `username` already
serves `WHERE username LIKE 'dav%'` efficiently since it's left-anchored — trigram is only required once
you want substring or misspelling-tolerant matches. Given betting-app usage (searching friends by
partial handle) trigram is worth the extra index for the fuzzy-match win.

### 2.4 Rate limiting on enumeration

The search endpoint is a user-enumeration oracle by construction — treat it like an auth endpoint:

- Per-user token bucket, e.g. **20 requests/10s, 200/hour**, keyed on `(requesterId)` not IP (mobile
  NATs share IPs; per-user is the correct key once authenticated).
- **Minimum query length of 2–3 characters** before hitting the DB — blocks trivial full-table sweeps.
- Cap result count (≤20) and never expose a `total_count` — total counts let an attacker binary-search
  the full namespace.
- Debounce client-side (300ms) so typing doesn't itself generate a request-per-keystroke flood — this
  is UX, not security, but reduces load and makes the security rate limit less likely to false-positive
  on legitimate fast typists.

### 2.5 Preventing user-enumeration attacks

Two related but distinct oracles to close:

1. **Search-by-username** — already covered: rate limit, minimum length, capped results.
2. **"Does this exact username exist" checks** — signup availability checks, invite-by-username,
   password reset, etc. must all respond with **uniform timing and uniform response shape** regardless
   of existence. E.g. `POST /invites/by-username` should return the same `202 Accepted` envelope whether
   or not the username resolves to a real, blockable, or already-friended account — the *outcome*
   differs (an invite email queues vs. a request is silently created) but the **HTTP response the caller
   observes must not**. Concretely:
   - Signup "is this username taken" check: this one is *supposed* to reveal existence (that's the
     product requirement), so instead rate-limit it hard and don't allow arbitrary email/phone existence
     probing through the same code path — usernames are lower-stakes to enumerate than emails/phones.
   - Friend-request-by-username and invite-by-username: always return success-shaped responses; do the
     real work (create request, or no-op if blocked) asynchronously/server-side so response timing
     doesn't leak which branch executed.
3. **Sequential/guessable IDs** — use UUIDs (already reflected in the schemas above), never
   auto-increment integers for anything reachable by a user-facing endpoint.

---

## 3. Invite flows

### 3.1 The four invite entry points

**(a) In-app invite of an existing friend.** Lowest-friction — just an `INSERT` targeting a known
`userId`, no token, no external channel. Used for group invites and market/bet invites among people
already connected.

**(b) Invite by username search.** Same table, but the target may or may not already be a friend; if
not, this doubles as an implicit friend request (see §3.4 — group/bet invite to a non-friend should
either require an existing friendship, or auto-create a `friend_requests` row alongside the invite,
depending on product decision. Recommendation: **require friendship for market/bet invites** — money is
involved — but allow username-search invite to *groups* to double as a friend request, since a group is
lower-stakes than a specific wager).

**(c) Shareable invite link with a signed token.** For "invite people who aren't friends yet" / viral
growth loops (mirrors Discord's server-invite links).

**(d) Invite to a group vs. invite to a specific bet/market.** Structurally identical state machine,
different `target_type`/`target_id` and different downstream effect on accept (group membership row vs.
market participant + position-eligibility row).

### 3.2 Shareable link token structure

Signed, stateless-verifiable, but **state-backed for revocation** (a pure JWT can't be revoked before
expiry without a denylist — the standard mitigation is short expiry + a server-side row that's checked
on redemption, not just signature verification, exactly as JWT-revocation writeups converge on: *"a
stateless access token stays valid until exp; every real revocation strategy works at the source"*
([JWT revocation requires checking a source-of-truth, not just the signature](https://blog.devgenius.io/the-art-of-jwt-revocation-secure-fast-and-efficient-0f26178c25e2), [per-session store or denylist for stateful revocation](https://www.techinterview.org/post/3233477260/revoke-jwt-oauth-interview-questions/))):

```ts
interface InviteLinkTokenPayload {
  iss: 'katalyxt-bet';
  sub: string;          // invite.id (the DB row — token is a *pointer*, not the source of truth)
  typ: 'group' | 'market';
  tid: string;          // target_id (group_id or market_id)
  iat: number;
  exp: number;           // short: 7 days default, configurable per-invite
}
```

The token is deliberately thin — it carries only an opaque `invite.id` plus enough context to render a
preview page without a DB hit, but **every redemption re-reads the `invites` row** to check
`status = 'active'`, `expires_at > now()`, and `uses_remaining > 0` before granting access. This means
revocation is instant (flip the DB row) even though the JWT signature itself would still verify — the
signature only proves the link wasn't tampered with, not that it's still honorable. This is the standard
resolution to "JWTs can't be revoked": treat the token as a capability *reference*, not a capability.

```sql
CREATE TABLE invites (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inviter_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invite_kind     TEXT NOT NULL CHECK (invite_kind IN ('direct_friend', 'username_search', 'link')),
    target_type     TEXT NOT NULL CHECK (target_type IN ('group', 'market')),
    target_id       UUID NOT NULL,               -- FK resolved at app layer (polymorphic)
    -- populated for (a)/(b): a specific invitee. NULL for (c) shareable links until redeemed.
    invitee_id      UUID REFERENCES users(id) ON DELETE CASCADE,
    -- populated for (c): the signed token's opaque id lives here; token itself is never stored.
    token_hash      TEXT,                        -- sha256 of the token, so a DB leak doesn't leak live tokens
    max_uses        INT NOT NULL DEFAULT 1,       -- 1 = single-use; NULL/large = effectively multi-use
    uses_remaining  INT NOT NULL DEFAULT 1,
    status          TEXT NOT NULL DEFAULT 'created'
                        CHECK (status IN ('created', 'sent', 'viewed', 'accepted', 'declined',
                                           'expired', 'revoked')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at         TIMESTAMPTZ,
    viewed_at       TIMESTAMPTZ,
    responded_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
    CONSTRAINT link_has_no_fixed_invitee CHECK (
        invite_kind <> 'link' OR invitee_id IS NULL
    ),
    CONSTRAINT direct_has_invitee CHECK (
        invite_kind = 'link' OR invitee_id IS NOT NULL
    )
);

CREATE INDEX idx_invites_invitee_pending ON invites (invitee_id) WHERE status IN ('sent', 'viewed');
CREATE INDEX idx_invites_token_hash ON invites (token_hash) WHERE invite_kind = 'link';
CREATE INDEX idx_invites_target ON invites (target_type, target_id);
```

### 3.3 State machine

```
created ──send──▶ sent ──open link/notif──▶ viewed ──accept──▶ accepted
   │                 │                          │
   │                 │                          └──decline──▶ declined
   │                 └────────────(TTL elapses)──────────────▶ expired
   │
   └──inviter revokes (any pre-terminal state)──▶ revoked
```

- `created`: row exists, not yet delivered (e.g. link generated but not copied/sent — mostly relevant
  for (c); for (a)/(b) `created` and `sent` collapse into one transaction).
- `sent`: push/email/in-app notification dispatched, or link is live and shareable.
- `viewed`: invitee opened the invite (preview page for links, notification tap for direct). Track for
  "seen but not answered" nudges.
- `accepted`/`declined`: terminal, invitee-driven. Accept fans out to the target-specific effect (insert
  `group_members` row or `market_participants` row) inside the same transaction.
- `expired`: terminal, system-driven at `expires_at`. Enforce lazily (check on read) plus a periodic
  sweep job rather than relying only on lazy checks, so stale invites don't clutter "pending" badge
  counts.
- `revoked`: terminal, inviter- or admin-driven, valid from any non-terminal state. A revoked link's
  `token_hash` stays in the table (audit trail) but redemption checks `status = 'active'`-equivalent and
  rejects.

For multi-use links, `accepted` isn't strictly terminal at the row level — model it as: the `invites`
row stays `sent` (or add a distinct `active` status) and each redemption inserts a row into a child
`invite_redemptions(invite_id, user_id, redeemed_at)` table, decrementing `uses_remaining`; the parent
transitions to `accepted`-equivalent (`exhausted`) only when `uses_remaining` hits 0, or to `expired`/
`revoked` as above. This keeps a single-use invite and a 50-use link representable in the same schema
without special-casing the state machine, at the cost of one extra join for multi-use redemption history.

### 3.4 Privacy implications of join-by-link

A public/shareable link is an intentional hole in the "private by default" model (§7) — anyone who
possesses the URL can join the target group/market regardless of the friend graph. Mitigations to bake
in from day one:

- Links are scoped to **one target** (`target_type` + `target_id`), never "join any of my groups" —
  no ambient authority.
- Default `max_uses = 1` for market invites (money-adjacent — a leaked single-use link only seats one
  extra stranger); allow multi-use only for `target_type = 'group'` and require the inviter to
  explicitly opt in ("allow anyone with this link to join" toggle, matching Discord's model where the
  server owner controls invite link scope/expiry per-link).
- Joining via link **does not create a friendship** — it creates group/market membership only. Treat
  link-joiners as strangers to everyone else in the group until they separately friend people, which
  keeps the friend graph's "never enumerable" guarantee (§1.6) intact even when membership rosters are
  visible to fellow members (§7).
- Every redemption is logged (`invite_redemptions` or an audit table) with `ip`/`user_agent` so a
  leaked link's blast radius is reconstructable and the inviter can revoke + see who joined via it.

---

## 4. Setup wizard UX patterns for creating a private bet

### 4.1 Reference patterns from real multi-step creation flows

- **Splitwise "Add expense" / "Create group"**: minimal required fields up front (amount, who paid,
  split-with), progressive disclosure of the split method (equal/percentage/shares/exact) behind an
  "advanced" toggle, and it never blocks you from saving with defaults — this "smart defaults, expand
  for edge cases" instinct is exactly what a "50/50 split" default outcome-pricing should borrow
  ([Splitwise groups + expense flow](https://splitwise.uservoice.com/knowledgebase/articles/1088920-how-do-i-use-splitwise), [progressive disclosure reduces cognitive load in staged flows](https://www.uxpin.com/studio/blog/what-is-progressive-disclosure/)).
- **Discord server creation**: a 2-step branch (template vs. blank) then name+icon, with invites
  deferred to *after* creation as a distinct, skippable step, and the first invite link auto-generated
  with a visible expiry (7 days) so the "share it" step never blocks on the user manually configuring
  link settings first
  ([Discord's create-server flow: template choice, then name, then invite as a separate later step](https://whop.com/blog/how-to-make-a-discord-server/)).
- **Notion database creation**: schema-first (define properties/columns) before any content, with every
  property addable/editable later — nothing is a one-way door — which is the pattern to borrow for
  "resolution criteria can be edited until the market opens, then locked."
- **Kalshi market creation/suggestion**: notably *not* self-serve for end users — market rules,
  settlement source, and resolution criteria are reviewed by Kalshi's markets team against a strict
  rubric (regulatory compliance, manipulation-resistance, clear public settlement source) before a market
  goes live ([Kalshi requires markets team review against compliance + settlement-clarity criteria before launch](https://help.kalshi.com/en/articles/13823833-suggesting-a-new-market)). The
  transferable lesson for a *friend* betting app isn't "add a review queue" (friends can self-certify
  triviality), it's: **force resolution-criteria clarity at creation time, not at resolution time** —
  Kalshi's rigor exists precisely because ambiguous resolution criteria is the #1 source of disputes, and
  that risk exists at any stakes level, so step 1 of the wizard should make "how will this be judged
  true/false" a required, validated field, not an afterthought.

### 4.2 Recommended wizard: 5 steps for "Create a bet"

Each step persists as a **draft** on every field-blur/next (not only on final submit), so navigating
back-and-forth or closing the tab never loses work — this is the single highest-leverage UX decision for
a multi-step form, and every reference flow above (Splitwise, Discord, Notion) treats in-progress state
as durable rather than transient.

**Step 1 — Question, resolution criteria, close date.**
- `question` (required, ≤140 chars, the headline shown everywhere)
- `resolution_criteria` (required, free text, min length enforced — e.g. 20 chars — to push past
  "yes/no" laziness; placeholder text models a good example)
- `resolution_source` (optional but strongly nudged — a URL or named authority, e.g. "ESPN box score",
  "official Twitter announcement")
- `closes_at` (required — when trading/joining stops; must be in the future; separate from
  `resolves_by` in step... actually keep resolution deadline here too as an optional `resolves_by` so
  the creator commits to a judging timeline)
- Validation: block "Next" until question + criteria + close date are all valid; show inline errors,
  not a single end-of-form error dump.

**Step 2 — Outcomes.**
- Binary (Yes/No) is the default, one click, matching Kalshi's dominant market shape.
- "Add outcome" expands to a multi-outcome list (2–8 outcomes) for non-binary bets ("who wins the
  group's fantasy league").
- Each outcome: `label` (required, ≤40 chars), optional `description`.
- Progressive disclosure: multi-outcome UI is hidden behind a "this isn't yes/no" toggle rather than
  shown by default, keeping the common case (binary) a one-screen step.

**Step 3 — Pricing / market type + stake limits.**
- `market_type`: `fixed_odds` (creator sets implied probability/odds at creation) vs. `pari_mutuel`/
  `pool` (stakes split proportionally among winners) vs. `peer_to_peer` (simple I-bet-you-X model for
  2-outcome, 2-person wagers).
- `stake_currency`: real money vs. points/credits, if the product supports both.
- `min_stake` / `max_stake` per participant (optional caps — important for friend-group bets to keep
  stakes proportionate and prevent one person from dominating the pool).
- `total_pool_cap` (optional).
- Defaults pre-filled (e.g. min $1 / no max) so this step is skippable-by-accepting-defaults for casual
  bets, matching Splitwise's "defaults + advanced toggle" instinct.

**Step 4 — Invite players.**
- Search box, debounced, hits the username search endpoint from §2.3.
- **Friends listed first, by default, before search is even typed** — show the top N (mutual-market
  history weighted, then recency of friendship) as tappable chips so the common case ("invite my usual
  group") needs zero typing.
- Selected invitees shown as removable chips above the search box.
- A "copy invite link" affordance alongside search, for inviting people not yet friended (§3.2/3.3) —
  this is where group-vs-market invite semantics from §3.1(d) apply: if `target_type = 'market'` and an
  invitee isn't already a friend, either disable them in the picker with a tooltip ("add as a friend
  first") or auto-fire a friend request alongside the market invite (product decision — recommend the
  former for a v1 to keep the trust model simple, revisit once link-invites are common).
- Minimum 1 invitee (or explicit "just me for now, invite later" skip) before "Next" — a bet with zero
  counterparties isn't a bet yet, but shouldn't hard-block creation since "create then invite" is also a
  valid flow (mirrors Discord deferring invites to post-creation).

**Step 5 — Review & create.**
- Read-only summary of all four prior steps, each section with an "Edit" link that jumps back to that
  step **without losing the other steps' data** (this is why draft persistence in step 1 matters — review
  is just rendering the draft, not a separate data path).
- Final "Create bet" CTA creates the `markets` row, `market_outcomes` rows, and `invites` rows in one
  transaction; on success, navigate to the new market's page/chat (see §5) with a toast confirming
  invites were sent.
- Draft cleanup: mark the draft row `status = 'published'` (don't hard-delete — useful for "duplicate a
  past bet" later) and clear it from the user's "resume draft" list.

```sql
CREATE TABLE market_drafts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    step_data       JSONB NOT NULL DEFAULT '{}',  -- { question, criteria, outcomes, pricing, invitees }
    current_step    INT NOT NULL DEFAULT 1,
    status          TEXT NOT NULL DEFAULT 'in_progress'
                        CHECK (status IN ('in_progress', 'published', 'abandoned')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_market_drafts_creator_active
    ON market_drafts (creator_id) WHERE status = 'in_progress';
```

Keeping the whole draft in one JSONB blob (rather than five normalized tables for in-progress state)
is deliberate: draft data is disposable, schema-fluid while you iterate on the wizard's fields, and
never queried by anything except "load my draft back into the form" — normalizing it buys nothing and
costs migration churn every time a step's fields change.

---

## 5. Group chat architecture

### 5.1 Scoping: channels/rooms per group and per market

Two distinct chat surfaces, same underlying message model:

```sql
CREATE TABLE chat_channels (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope_type      TEXT NOT NULL CHECK (scope_type IN ('group', 'market')),
    scope_id        UUID NOT NULL,          -- group_id or market_id, resolved at app layer
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_channel_scope UNIQUE (scope_type, scope_id)  -- one channel per group/market, v1
);

CREATE TABLE chat_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id      UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    sender_id       UUID NOT NULL REFERENCES users(id),
    client_msg_id   UUID NOT NULL,          -- client-generated, for optimistic-send dedupe/reconciliation
    body            TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    edited_at       TIMESTAMPTZ,
    deleted_at      TIMESTAMPTZ,             -- soft delete; keep row for audit + "message deleted" tombstone
    CONSTRAINT uq_channel_client_msg UNIQUE (channel_id, sender_id, client_msg_id)
);

-- Keyset pagination index — the ONLY index this table needs for the hot path.
CREATE INDEX idx_messages_channel_keyset ON chat_messages (channel_id, created_at DESC, id DESC);

CREATE TABLE channel_reads (
    channel_id      UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_message_id UUID REFERENCES chat_messages(id),
    last_read_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (channel_id, user_id)
);
```

Unread count per channel is derived, not stored redundantly:

```sql
SELECT COUNT(*) FROM chat_messages m
JOIN channel_reads r ON r.channel_id = m.channel_id AND r.user_id = $1
WHERE m.channel_id = $2 AND m.created_at > r.last_read_at AND m.deleted_at IS NULL;
```

For a chat-heavy app at scale you'd eventually denormalize this into a maintained counter (incremented
on send, zeroed on read) to avoid a `COUNT(*)` per channel on every inbox render — not needed at
friend-group scale (tens of messages/day/channel), revisit if channel counts get into the thousands per
user.

### 5.2 Optimistic sends with client-generated IDs

Client generates `client_msg_id` (UUID) at compose time, renders the message immediately in an
"pending" visual state, then POSTs. The `uq_channel_client_msg` constraint makes retries idempotent — if
a POST times out but actually succeeded server-side, the retry's `INSERT ... ON CONFLICT DO NOTHING
RETURNING *` either returns the original row (already-sent) or inserts fresh, and the client reconciles
by `client_msg_id` rather than trusting the network call's success/failure alone.

```ts
interface ChatMessage {
  id: string;               // server id, absent until ack'd
  clientMsgId: string;      // always present, generated client-side
  channelId: string;
  senderId: string;
  body: string;
  createdAt: string;
  status: 'pending' | 'sent' | 'failed';  // client-only field, never persisted
}
```

### 5.3 Pagination: keyset, not offset

Offset pagination (`LIMIT/OFFSET`) degrades linearly with depth and is unstable under concurrent
inserts (a new message shifts every subsequent page). Keyset pagination seeks past the last-seen
`(created_at, id)` pair using the composite index above, staying fast at any scroll depth
([keyset pagination seeks past the last row instead of counting/discarding with OFFSET](https://blog.sequinstream.com/keyset-cursors-not-offsets-for-postgres-pagination/), [composite (created_at, id) key guarantees stable total ordering](https://www.stacksync.com/blog/keyset-cursors-postgres-pagination-fast-accurate-scalable)):

```sql
-- first page (most recent 50)
SELECT * FROM chat_messages
WHERE channel_id = $1 AND deleted_at IS NULL
ORDER BY created_at DESC, id DESC
LIMIT 50;

-- subsequent page: seek past the oldest message from the previous page
SELECT * FROM chat_messages
WHERE channel_id = $1 AND deleted_at IS NULL
  AND (created_at, id) < ($2 /* last created_at */, $3 /* last id */)
ORDER BY created_at DESC, id DESC
LIMIT 50;
```

```ts
interface MessagePage {
  messages: ChatMessage[];
  nextCursor: { createdAt: string; id: string } | null;
}
```

### 5.4 Realtime transport on Vercel

This is the load-bearing infra decision. Key facts as of mid-2026:

- **Vercel added native WebSocket support in public beta (announced June 2026)**, but it's strongest on
  the Node.js runtime, not Edge, and is explicitly flagged as not yet the stable, full-featured path for
  production-grade stateful apps — Edge-runtime WS support is still catching up
  ([Vercel Functions natively support WebSockets, in public beta since June 2026, Node.js runtime strongest](https://essamamdani.com/blog/vercel-websockets-real-time-ai-agents-2026), [native support has real limits — most production use cases still want a third-party provider](https://ably.com/vercel/websockets-on-vercel)).
  Before this, the standing constraint was that Vercel's serverless functions are short-lived and
  don't hold long-lived connections, which is why SSE/polling/third-party pub-sub became the standard
  workarounds and are still the safer default for anything beyond a prototype.
- **SSE via the Web Streams API works cleanly on Vercel Functions** — it's just an HTTP response that
  stays open and streams chunks; no separate streaming service is required, and it runs on the same
  serverless model as the rest of your API
  ([SSE via Web Streams runs on the same serverless model, no separate streaming service](https://vercel.com/blog/streaming-for-serverless-node-js-and-edge-runtimes-with-vercel-functions)). Its
  limitation is one-directional (server→client only; the client still POSTs separately to send) and
  each open SSE connection ties up a function invocation for its duration, which interacts with
  Vercel's execution-duration limits (configurable per-function, but still a ceiling, and each concurrent
  viewer is a concurrent long-lived invocation — this is the real scaling wall, not a hard block, but a
  cost/complexity one at high concurrency).
- **Third-party realtime providers (Pusher, Ably, Supabase Realtime) exist precisely to take the
  long-lived-connection problem off your serverless compute.** Comparison:
  - **Pusher**: simplest mental model (channels + events), fastest to a working chat, weaker delivery
    guarantees ([channel/event model gets you to working chat quickly](https://ably.com/compare/pusher-vs-supabase)).
  - **Ably**: stronger reliability (exactly-once delivery, message history/replay, connection-state
    recovery) — the better choice once chat is a core, must-not-drop-messages feature rather than a
    nice-to-have ([Ably offers stronger delivery guarantees and state recovery](https://ably.com/compare/pusher-vs-supabase)).
  - **Supabase Realtime**: subscribes directly to Postgres row changes (logical replication under the
    hood) — the natural pick **if you're already on Supabase for the primary DB**, since chat messages
    landing in `chat_messages` fan out to subscribers with zero extra publish step; skip it if your DB
    is elsewhere (Neon/RDS) since you'd be running a second Postgres-adjacent service just for this
    ([Supabase Realtime subscribes to DB changes directly, included in the plan if already on Supabase](https://ably.com/compare/pusher-vs-supabase)).

**Recommendation for this app:** start with **polling (or SSE) as the default, swap in a provider behind
an interface** — don't couple the chat UI to a specific transport.

```ts
// Transport-agnostic interface — every implementation (polling, SSE, Pusher, Ably, Supabase)
// satisfies this same shape, so swapping providers is a one-file change.
interface RealtimeChannel {
  subscribe(onMessage: (msg: ChatMessage) => void): () => void; // returns unsubscribe
  publish(msg: Omit<ChatMessage, 'id' | 'status'>): Promise<ChatMessage>;
}

// v1: polling implementation — dumb, correct, works everywhere, zero new infra.
class PollingChannel implements RealtimeChannel {
  constructor(private channelId: string, private intervalMs = 2500) {}
  subscribe(onMessage: (msg: ChatMessage) => void) {
    let cursor: string | null = null;
    const id = setInterval(async () => {
      const page = await fetchMessages(this.channelId, cursor);
      page.messages.forEach(onMessage);
      if (page.messages[0]) cursor = page.messages[0].createdAt;
    }, this.intervalMs);
    return () => clearInterval(id);
  }
  publish(msg) { return postMessage(this.channelId, msg); }
}

// v2 drop-in: SSE for lower latency without new vendor infra.
class SSEChannel implements RealtimeChannel {
  subscribe(onMessage) {
    const es = new EventSource(`/api/channels/${this.channelId}/stream`);
    es.onmessage = (e) => onMessage(JSON.parse(e.data));
    return () => es.close();
  }
  publish(msg) { return postMessage(this.channelId, msg); }
}

// v3 drop-in: Ably/Pusher/Supabase, same interface, only this class changes.
class AblyChannel implements RealtimeChannel { /* ably-js subscribe/publish, same shape */ }
```

Path: ship polling first (2–3s interval is imperceptible for a friend-group betting chat, not a
Slack-scale product), instrument message-latency complaints, and swap the `RealtimeChannel`
implementation behind a factory (`createRealtimeChannel(channelId)`) once/if latency or Vercel function
minutes become a real cost or UX problem — never rewrite call sites, only the factory's return type.

---

## 6. Notifications

### 6.1 Model

```sql
CREATE TABLE notifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type            TEXT NOT NULL CHECK (type IN (
                        'friend_request_received', 'friend_request_accepted',
                        'bet_invite_received', 'bet_invite_accepted',
                        'market_resolved', 'market_closing_soon',
                        'chat_message', 'chat_mention'
                    )),
    actor_id        UUID REFERENCES users(id),      -- who caused it (nullable for system events)
    target_type     TEXT,                            -- 'market' | 'group' | 'friend_request' | 'message'
    target_id       UUID,
    payload         JSONB NOT NULL DEFAULT '{}',      -- denormalized bits for cheap rendering (e.g. market question)
    read_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- batching: multiple raw events roll into one notification row while unread
    batch_key       TEXT,                             -- e.g. 'chat:{channel_id}' groups unread chat pings
    batch_count     INT NOT NULL DEFAULT 1
);

CREATE INDEX idx_notifications_recipient_unread
    ON notifications (recipient_id, created_at DESC) WHERE read_at IS NULL;
CREATE UNIQUE INDEX uq_notifications_open_batch
    ON notifications (recipient_id, batch_key) WHERE read_at IS NULL AND batch_key IS NOT NULL;
```

### 6.2 Batching

Chat messages are the highest-volume notification type and the one most in need of batching — nobody
wants 40 separate push notifications from an active group chat. On each new `chat_message`, upsert
against `uq_notifications_open_batch` (`batch_key = 'chat:{channel_id}'`): if an unread batch already
exists for that channel, increment `batch_count` and update `payload` to the latest message preview
rather than inserting a new row; only create a fresh row once the prior batch is read (`read_at` set)
or doesn't exist yet. Friend requests and bet invites are naturally low-volume and don't need batching —
one row per event is fine and arguably better (each is independently actionable).

```ts
interface AppNotification {
  id: string;
  type: NotificationType;
  actor?: { id: string; username: string; displayName: string };
  targetType?: 'market' | 'group' | 'friend_request' | 'message';
  targetId?: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
  batchCount: number;
}
```

Read state: mark-as-read on notification-list open (bulk `UPDATE ... SET read_at = now() WHERE
recipient_id = $1 AND read_at IS NULL`) or per-item on tap, whichever matches the client's list vs.
toast UX. Unread badge count is `SELECT COUNT(*) WHERE recipient_id = $1 AND read_at IS NULL` — cheap
given the partial index above.

---

## 7. Privacy/authz model

### 7.1 Principles

- **Private by default.** A market/group is visible only to its members; there is no public directory
  or discoverability surface unless the creator explicitly toggles one on (out of scope for v1 —
  everything defaults closed).
- **Membership gates every read**, not just writes. Being able to construct a valid market/message/
  position ID (all UUIDs, so not guessable, but defense-in-depth matters) must never be sufficient to
  read it — the authorization check is on every fetch, not just on the list/index endpoints.
- **Friend-list opacity (§1.6) is a special case of this same rule**, not a separate mechanism — the
  policy layer below treats "can I see user X's friend list" identically to "can I see market Y's
  messages," just with a different resource type and membership predicate.

### 7.2 Per-resource checks

| Resource | Read requires | Write requires |
|---|---|---|
| `market` | caller is creator OR a row exists in `market_participants` for (market_id, caller_id) OR caller has a pending `invites` row targeting them for this market | caller is creator (for edits pre-close); no one can edit after `closes_at` |
| `chat_message` (via `chat_channels`) | caller is a member of the channel's `scope` (group_member or market_participant) | same as read — any member can post; `sender_id` must equal caller |
| `position` (a user's stake in a market) | caller IS the position holder OR caller is a fellow `market_participant` viewing aggregate/anonymized stats only (never another user's exact stake unless the market's `stakes_visible` flag is on) | caller IS the position holder, and only while `market.status = 'open'` |
| `invite` | caller is the `inviter_id`, OR caller is the `invitee_id`, OR (for link invites) caller possesses a valid unexpired token whose hash matches | caller is `inviter_id` (create/revoke); caller is `invitee_id` (accept/decline) |
| `friend_requests` / `friendships` | caller is `sender_id` or `recipient_id` / caller is `user_a_id` or `user_b_id` — **never a third party**, per §1.6 | caller is `sender_id` (create/cancel) or `recipient_id` (accept/decline) |

### 7.3 Expressing this as a policy layer

Centralize checks so no route hand-rolls its own `if` — a single `can(actor, action, resource)`
function that every API route/server-action calls before touching data, mirroring a lightweight
CASL/Oso-style policy object rather than scattering authorization logic across handlers:

```ts
type Action = 'read' | 'write' | 'delete';
type Resource =
  | { type: 'market'; id: string }
  | { type: 'chatChannel'; id: string }
  | { type: 'position'; id: string }
  | { type: 'invite'; id: string }
  | { type: 'friendGraph'; ownerId: string };

interface PolicyContext {
  actorId: string;
  db: DbClient;
}

export async function can(
  ctx: PolicyContext,
  action: Action,
  resource: Resource
): Promise<boolean> {
  switch (resource.type) {
    case 'market': {
      const market = await ctx.db.market.findUnique({ where: { id: resource.id } });
      if (!market) return false;
      if (action === 'write') return market.creatorId === ctx.actorId && market.status === 'open';
      // read
      if (market.creatorId === ctx.actorId) return true;
      return ctx.db.marketParticipant.exists({ marketId: resource.id, userId: ctx.actorId })
          || ctx.db.invite.exists({
               targetType: 'market', targetId: resource.id,
               inviteeId: ctx.actorId, status: 'sent'
             });
    }
    case 'chatChannel': {
      const channel = await ctx.db.chatChannel.findUnique({ where: { id: resource.id } });
      if (!channel) return false;
      return isMemberOfScope(ctx, channel.scopeType, channel.scopeId); // group_member or market_participant lookup
    }
    case 'position': {
      const position = await ctx.db.position.findUnique({ where: { id: resource.id } });
      if (!position) return false;
      if (action === 'write') return position.userId === ctx.actorId;
      if (position.userId === ctx.actorId) return true;
      const market = await ctx.db.market.findUnique({ where: { id: position.marketId } });
      return !!market?.stakesVisible
          && ctx.db.marketParticipant.exists({ marketId: position.marketId, userId: ctx.actorId });
    }
    case 'invite': {
      const invite = await ctx.db.invite.findUnique({ where: { id: resource.id } });
      if (!invite) return false;
      return invite.inviterId === ctx.actorId || invite.inviteeId === ctx.actorId;
      // link-token redemption is a separate code path keyed on token_hash, not this check
    }
    case 'friendGraph':
      // the §1.6 rule, expressed once, called everywhere a friends list is rendered
      return resource.ownerId === ctx.actorId;
  }
}
```

Every route wraps its DB call: `if (!(await can(ctx, 'read', { type: 'market', id }))) return
res.status(404).json({ error: 'not_found' })` — **404, not 403**, for resources whose existence itself
is sensitive (private markets, friend requests), so unauthorized probing can't distinguish "doesn't
exist" from "exists but you can't see it," which is the same enumeration-resistance principle applied
in §2.5 to usernames.

---

## Sources

- [Instagram Graph API followers/following access restrictions](https://www.keyapi.ai/blog/instagram-graph-api-get-followers-list-following/)
- [Discord Social SDK — friend relationship types (PendingIncoming/PendingOutgoing/Friend/Blocked)](https://discord.com/developers/docs/social-sdk/friends.html)
- [Discord Friends List 101 — friend request states](https://support.discord.com/hc/en-us/articles/217674288-Friends-List-101)
- [Facebook-style symmetric friend-request DB design](https://www.9lessons.info/2014/03/facebook-style-friend-request-system.html)
- [Two-way friend system state machine](https://www.coderbased.com/p/user-friends-system-and-database)
- [PostgreSQL citext for case-insensitive usernames/emails](https://dev.to/devinclark/case-insensitive-text-columns-in-postgres-with-citext-2o57)
- [Postgres case sensitivity: citext vs functional lower() index](https://www.bytebase.com/blog/postgres-case-sensitivity/)
- [pg_trgm trigram indexing for autocomplete](https://benwilber.github.io/programming/2024/08/21/pg-trgm-autocomplete.html)
- [pg_trgm GIN index for fast leading-wildcard LIKE](https://www.tigerdata.com/learn/postgresql-extensions-pg-trgm)
- [JWT revocation: stateless tokens require a source-of-truth check](https://blog.devgenius.io/the-art-of-jwt-revocation-secure-fast-and-efficient-0f26178c25e2)
- [JWT revocation strategies: per-session store, denylist, opaque + introspection](https://www.techinterview.org/post/3233477260/revoke-jwt-oauth-interview-questions/)
- [Keyset (cursor) pagination vs offset in Postgres](https://blog.sequinstream.com/keyset-cursors-not-offsets-for-postgres-pagination/)
- [Composite (created_at, id) keyset for stable ordering](https://www.stacksync.com/blog/keyset-cursors-postgres-pagination-fast-accurate-scalable)
- [Discord server creation flow: template vs blank, deferred invites](https://whop.com/blog/how-to-make-a-discord-server/)
- [Splitwise groups and expense-splitting flow](https://splitwise.uservoice.com/knowledgebase/articles/1088920-how-do-i-use-splitwise)
- [Progressive disclosure UX pattern](https://www.uxpin.com/studio/blog/what-is-progressive-disclosure/)
- [Kalshi market suggestion/review process](https://help.kalshi.com/en/articles/13823833-suggesting-a-new-market)
- [Vercel native WebSocket support (public beta, June 2026) and Node vs Edge runtime caveats](https://essamamdani.com/blog/vercel-websockets-real-time-ai-agents-2026)
- [WebSockets on Vercel: limits and third-party options](https://ably.com/vercel/websockets-on-vercel)
- [SSE via Web Streams on Vercel Functions/Edge runtime](https://vercel.com/blog/streaming-for-serverless-node-js-and-edge-runtimes-with-vercel-functions)
- [Pusher vs Ably vs Supabase Realtime comparison](https://ably.com/compare/pusher-vs-supabase)
