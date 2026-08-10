import { getContainer, requireUser } from "@/lib/container";
import { handler, jsonOk } from "@/lib/http";

/**
 * `GET /api/me` — the current session's user, balance (already a field on
 * `User`, SPEC §4), and groups. `requireUser` re-verifies the session JWT
 * itself (see its doc comment) and throws `forbidden` if there isn't one,
 * which `handler()` turns into a 403 `{ error }` envelope — no route-local
 * auth check needed here (G5 is satisfied by `requireUser`, not a
 * hand-rolled `if`).
 */
export const GET = handler(async (req) => {
  const user = await requireUser(req);
  const { store } = await getContainer();
  const groups = await store.groups.listByMember(user.id);
  return jsonOk({ user, groups });
});
