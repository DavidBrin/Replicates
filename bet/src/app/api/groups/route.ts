import { z } from "zod";
import { brand } from "@/domain/entities";
import { getContainer, requireUser } from "@/lib/container";
import { handler, jsonOk, parseBody } from "@/lib/http";
import { slugifyName } from "@/app/api/_shared/social";

/** `GET /api/groups` — the caller's own groups (SPEC §8). `listByMember`
 * is already scoped to `me.id`, so there's no third-party resource here
 * for `can()` to gate — same "creation/self-scoped route, no can()" shape
 * as `GET /api/me` and `GET /api/friends`. */
export const GET = handler(async (req) => {
  const me = await requireUser(req);
  const { store } = await getContainer();
  const groups = await store.groups.listByMember(me.id);
  return jsonOk({ groups });
});

const createGroupSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60, "Keep it under 60 characters"),
  emoji: z.string().trim().min(1, "Pick an emoji").max(8, "That's not an emoji"),
});

/**
 * `POST /api/groups { name, emoji }` (SPEC §8). Slug is derived from
 * `name` — lowercased, non-alphanumerics collapsed to `-`, trimmed — and
 * uniquified by appending `-2`, `-3`, … on collision (David's ambiguity
 * resolution). The creator is the owner and first member.
 */
export const POST = handler(async (req) => {
  const me = await requireUser(req);
  const { name, emoji } = await parseBody(req, createGroupSchema);
  const { store, clock, idGen } = await getContainer();

  const base = slugifyName(name);
  let slug = base;
  let suffix = 2;
  while (await store.groups.findBySlug(slug)) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }

  const group = await store.groups.insert({
    id: brand(idGen.next("grp")),
    slug,
    name,
    emoji,
    memberIds: [me.id],
    ownerId: me.id,
    createdAt: clock.now(),
  });

  return jsonOk({ group }, { status: 201 });
});
