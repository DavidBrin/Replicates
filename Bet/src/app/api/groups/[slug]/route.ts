import { can } from "@/domain/authz";
import { getContainer, requireUser } from "@/lib/container";
import { authorizeOr404, handler, jsonOk } from "@/lib/http";
import { toPublicUser } from "@/app/api/_shared/social";

/**
 * `GET /api/groups/[slug]` — group + members + markets (SPEC §8). Returns
 * 404, never 403, for non-members (G4/D6, David's ambiguity resolution): a
 * private group's existence is itself private to outsiders, matching
 * `authorizeOr404`'s default `sensitive: true`.
 */
export const GET = handler<{ slug: string }>(async (req, { params }) => {
  const me = await requireUser(req);
  const { slug } = await params;
  const { store } = await getContainer();

  const group = await store.groups.findBySlug(slug);
  authorizeOr404(
    !!group &&
      can(
        { userId: me.id },
        "read",
        { type: "group", id: group.id },
        { group: { ownerId: group.ownerId, isMember: group.memberIds.includes(me.id) } },
      ),
  );
  // `authorizeOr404` throws when the check above is false, so `group` is
  // guaranteed defined from here down.
  const found = group!;

  const [memberUsers, markets] = await Promise.all([
    Promise.all(found.memberIds.map((id) => store.users.findById(id))),
    store.markets.listByGroup(found.id),
  ]);
  const members = memberUsers.filter((u): u is NonNullable<typeof u> => !!u).map(toPublicUser);

  return jsonOk({ group: found, members, markets });
});
