import { CACHE_CONTROL_NONE } from "@/adapters/blob";
import { searchIndex } from "@/adapters/search";

/**
 * `GET /api/search/suggest` — type-ahead.
 *
 * A separate route from `/api/search` because it is a separate *query*, not a
 * cheaper call into the same one. `ports/search-index.ts` says why: `suggest`
 * matches prefixes rather than terms, so it finds nothing until a word is
 * finished if it goes through the search path, and it has to answer in
 * milliseconds because it fires per keystroke.
 *
 * ## Everything here is a bound
 *
 * This is the one endpoint in the application a user hits dozens of times per
 * search, from a field they control completely. So:
 *
 * * The prefix is truncated. A 4kB paste is not a prefix, and the adapter
 *   would happily turn it into a six-term tsquery.
 * * `limit` is clamped, and defaults low. The adapter caps at 20 of its own
 *   accord; this stops a caller from asking for 20 on every keystroke by
 *   accident.
 * * A blank prefix answers `[]` without touching the database, which is what
 *   the first keystroke after a clear looks like.
 *
 * There is no `to_tsquery` injection to defend against here, and that is worth
 * stating so nobody adds a second, weaker guard: `PostgresSearchIndex.suggest`
 * reduces its input to letters and digits before it becomes a tsquery, because
 * `&`, `|`, `!` and `:` are *operators* in that grammar and parameterising the
 * statement does not help. Sanitising again here would be a copy of a rule that
 * only works if it is in exactly one place.
 *
 * ## Never an error the field has to handle
 *
 * A suggestion list is an accelerator. If the index is unreachable the answer
 * is an empty list and a 200, because the alternative — a red field, or a
 * console full of 500s while someone types — costs the user something for a
 * feature that was only ever saving them keystrokes. The search itself is
 * unaffected: `/results` does not go through here.
 */
export const runtime = "nodejs";

/** Longer than any real prefix and shorter than any paste worth indexing. */
const MAX_PREFIX_LENGTH = 100;

/** Matches `DEFAULT_SUGGESTION_LIMIT` in the component that calls this. */
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const prefix = (params.get("q") ?? "").trim().slice(0, MAX_PREFIX_LENGTH);
  const limit = boundedLimit(params.get("limit"));

  if (prefix === "" || limit === 0) return json({ suggestions: [] });

  try {
    const index = await searchIndex();
    return json({ suggestions: await index.suggest(prefix, limit) });
  } catch {
    return json({ suggestions: [] });
  }
}

function boundedLimit(raw: string | null): number {
  if (raw === null) return DEFAULT_LIMIT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(parsed), 0), MAX_LIMIT);
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // Ordered by `max(view_count)`, so the answer changes as the corpus is
      // watched. Nothing downstream may hold it.
      "Cache-Control": CACHE_CONTROL_NONE,
    },
  });
}
