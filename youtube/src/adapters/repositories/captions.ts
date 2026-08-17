import "server-only";

import type { SqlDatabase, SqlExecutor, SqlRow } from "@/adapters/db/driver";

// Declared in `comments.ts` because that is where it was first needed. One
// class rather than two identically-named ones, so a route that handles "no
// such video" handles it once whichever repository raised it.
import { VideoNotFoundError } from "./comments";
import {
  atomically,
  bool,
  first,
  newId,
  text,
  timestamp,
  translatingUniqueViolations,
} from "./shared";

/**
 * A video's caption tracks: what languages it has, where each file lives, and
 * which one the player starts with.
 *
 * The *content* is not here. A track's cues live in the blob store as one whole
 * WebVTT file per language — `research/07-captions-and-a11y.md` §3.3 argues
 * against segmenting them, because `X-TIMESTAMP-MAP` and per-segment splitting
 * exist to solve live windowing and MPEG-TS discontinuity, and this pipeline has
 * neither. So a row here is a pointer plus the metadata the CC menu renders, and
 * `src/domain/captions.ts` is what reads and writes the bytes it points at.
 *
 * ## One default per video, decided here
 *
 * The schema **does** carry `unique (video_id) where is_default`, and this
 * file used to argue that it could not: that the constraint "would make
 * setting a new default a two-statement dance with a moment of nothing
 * selected between them". Both halves of that are true and neither is a
 * problem. The dance is two statements inside one transaction, and the moment
 * with nothing selected is not observable outside it — where the alternative,
 * a read-then-write with no constraint behind it, lets two concurrent first
 * uploads both commit as the default and leaves a player picking whichever row
 * the plan returns first.
 *
 * The index found a real ordering bug the moment it was added: the insert ran
 * before the clear, so the forbidden state existed mid-transaction and a
 * partial unique index is checked per statement. Three tests had been passing
 * over it.
 *
 * The rule itself is §3.1's, from the HLS side: at most one rendition in a group
 * carries `DEFAULT=YES`, and a client with no explicit user choice plays it.
 * A video with tracks and no default is a CC button that turns nothing on, so a
 * default is chosen rather than left null — see {@link addCaptionTrack}.
 */

export type CaptionSource = "uploaded" | "automatic";

export interface CaptionTrack {
  readonly id: string;
  readonly videoId: string;
  /** BCP-47, per the schema. `en`, `en-GB`, `pt-BR`. */
  readonly language: string;
  /**
   * What the CC menu shows. YouTube's convention is the language's own name,
   * with `(auto-generated)` appended for a machine transcription — the caller
   * supplies it, because only the caller knows which language it is naming it
   * in.
   */
  readonly label: string;
  readonly source: CaptionSource;
  /** The whole-file `.vtt` in the blob store. */
  readonly blobKey: string;
  readonly isDefault: boolean;
  readonly createdAt: Date;
}

/**
 * `(video_id, language, source)` is unique, so a second English *uploaded*
 * track is a conflict and an English *automatic* one beside it is not.
 */
const CONSTRAINTS = {
  captions_video_language_key: { entity: "caption track", field: "language" },
} as const;

/**
 * Which track the player should offer first, when nothing else has decided.
 *
 * Uploaded before automatic, then by label, then by id. The id is the
 * tiebreaker every ordering in this schema carries: PGlite's `now()` stops at
 * the millisecond, so two tracks added in one batch share a `created_at`
 * locally and do not on Neon — an order that is total in production and
 * arbitrary in development is the asymmetry D19 exists to keep out.
 */
const PREFERENCE = `(source = 'uploaded') desc, label, id`;

export interface NewCaptionTrack {
  readonly videoId: string;
  readonly language: string;
  readonly label: string;
  readonly blobKey: string;
  /**
   * Force the answer. Left out, {@link addCaptionTrack} decides — which is
   * almost always what a caller wants, and is stated there because "almost
   * always" is not a rule anyone can act on.
   */
  readonly isDefault?: boolean;
}

/** A track somebody authored. Beats a machine transcription for the default. */
export async function addUploadedCaptionTrack(
  db: SqlDatabase,
  input: NewCaptionTrack,
  outer?: SqlExecutor,
): Promise<CaptionTrack> {
  return addCaptionTrack(db, "uploaded", input, outer);
}

/**
 * A track the recogniser produced.
 *
 * Kept a separate call rather than a `source` argument because the two are not
 * interchangeable at the point of use: §5.4 is explicit that our auto-caption
 * path is utterance-level, timed to observed result-event boundaries and
 * drifting as a video runs. A creator's own file is neither, and the column is
 * what lets the CC menu say so.
 */
export async function addAutomaticCaptionTrack(
  db: SqlDatabase,
  input: NewCaptionTrack,
  outer?: SqlExecutor,
): Promise<CaptionTrack> {
  return addCaptionTrack(db, "automatic", input, outer);
}

/**
 * Insert the track and settle the default in one transaction.
 *
 * The default rule, when the caller does not force one:
 *
 *   - a video with no default yet gets this track as its default, so the CC
 *     button is never present and inert;
 *   - an **uploaded** track displaces an **automatic** default, because a
 *     creator's own transcript beats a machine's — §5.2's auto-caption timings
 *     drift and have no word-level alignment, which is a worse default for the
 *     viewers who need captions most;
 *   - nothing else displaces anything. Adding a fifth language does not change
 *     what plays by default.
 *
 * One transaction, because the read that decides and the write that acts must
 * describe the same moment: two tracks added concurrently could otherwise both
 * see "no default yet" and both become one.
 */
async function addCaptionTrack(
  db: SqlDatabase,
  source: CaptionSource,
  input: NewCaptionTrack,
  outer?: SqlExecutor,
): Promise<CaptionTrack> {
  const id = newId("cap");

  return atomically(db, outer, async (tx) => {
    // The video check rides along with the state query rather than costing its
    // own round trip. Without it the failure is a foreign-key violation naming
    // a constraint, which is a true statement about the database and not a
    // useful one about the request.
    const state = first(
      await tx.query(
        `select exists (select 1 from videos where id = $1) as video_exists,
                coalesce(bool_or(c.is_default), false) as has_default,
                coalesce(bool_or(c.is_default and c.source = 'uploaded'), false)
                  as has_uploaded_default
           from captions c
          where c.video_id = $1`,
        [input.videoId],
      ),
    );
    if (!state || !bool(state, "video_exists")) {
      throw new VideoNotFoundError(input.videoId);
    }

    const isDefault =
      input.isDefault ??
      (!bool(state, "has_default") ||
        (source === "uploaded" && !bool(state, "has_uploaded_default")));

    /**
     * Clear the old default **before** writing the new one.
     *
     * These two statements used to run the other way round, and the ordering
     * was invisible until `captions_one_default_key` existed: between the
     * insert and the clear, two rows for one video both had `is_default`, and
     * a partial unique index is checked per statement rather than at commit.
     *
     * Reordering is strictly better than deferring the constraint. The window
     * the old order opened was a state the rule forbids; the window this one
     * opens is a video with *no* default for the length of one statement
     * inside a transaction — which is the state a video with no tracks is
     * already in, and which no reader outside the transaction can observe.
     */
    if (isDefault) {
      await tx.execute(
        "update captions set is_default = false where video_id = $1 and is_default",
        [input.videoId],
      );
    }

    const rows = await translatingUniqueViolations(
      CONSTRAINTS,
      input.language,
      () =>
        tx.query(
          `insert into captions
             (id, video_id, language, label, source, blob_key, is_default)
           values ($1, $2, $3, $4, $5, $6, $7)
           returning *`,
          [
            id,
            input.videoId,
            input.language,
            input.label,
            source,
            input.blobKey,
            isDefault,
          ],
        ),
    );

    const created = first(rows);
    if (!created) throw new Error(`Caption track ${id} vanished between write and read.`);

    return toCaptionTrack(created);
  });
}

/**
 * Make one track the default, in one statement.
 *
 * The `where video_id = (select …)` is the guard, not decoration: written as
 * `where video_id = $2 and (is_default or id = $1)` with the video passed in,
 * an id that belongs to some other video — or to nothing — would match only the
 * currently-default row and set it to false, leaving the video with tracks and
 * no default. Deriving the video from the id itself means an unknown id matches
 * nothing at all. `pinComment` guards the same way for the same reason.
 */
export async function setDefaultCaptionTrack(
  sql: SqlExecutor,
  id: string,
): Promise<boolean> {
  const changed = await sql.execute(
    `update captions
        set is_default = (id = $1)
      where video_id = (select video_id from captions where id = $1)
        and (is_default or id = $1)`,
    [id],
  );
  return changed > 0;
}

/**
 * Remove a track, and hand the default on if it held it.
 *
 * The promotion is the reason this is a transaction rather than one `delete`.
 * Deleting the default track otherwise leaves a video whose CC button lists
 * three languages and starts none of them — a state no read query would report
 * as wrong, because every row in it is individually fine.
 *
 * The `.vtt` in the blob store is *not* deleted here. Blob lifetimes belong to
 * whatever owns the key space; a repository that reached into it would be a
 * second, invisible owner of the same bytes.
 */
export async function deleteCaptionTrack(
  db: SqlDatabase,
  id: string,
  outer?: SqlExecutor,
): Promise<boolean> {
  return atomically(db, outer, async (tx) => {
    const rows = await tx.query(
      `delete from captions where id = $1 returning video_id, is_default`,
      [id],
    );
    const deleted = first(rows);
    if (!deleted) return false;
    if (!bool(deleted, "is_default")) return true;

    await tx.execute(
      `update captions set is_default = true
        where id = (
          select id from captions
           where video_id = $1
           order by ${PREFERENCE}
           limit 1
        )`,
      [text(deleted, "video_id")],
    );
    return true;
  });
}

/* ----------------------------------------------------------------- reads -- */

/**
 * A video's tracks, default first — which makes `rows[0]` the track to start
 * with and saves the caller a second query for it.
 */
export async function listCaptionTracks(
  sql: SqlExecutor,
  videoId: string,
): Promise<CaptionTrack[]> {
  const rows = await sql.query(
    `select * from captions
      where video_id = $1
      order by is_default desc, ${PREFERENCE}`,
    [videoId],
  );
  return rows.map(toCaptionTrack);
}

export async function getCaptionTrack(
  sql: SqlExecutor,
  id: string,
): Promise<CaptionTrack | null> {
  const rows = await sql.query(`select * from captions where id = $1`, [id]);
  const row = first(rows);
  return row ? toCaptionTrack(row) : null;
}

function toCaptionTrack(row: SqlRow): CaptionTrack {
  return {
    id: text(row, "id"),
    videoId: text(row, "video_id"),
    language: text(row, "language"),
    label: text(row, "label"),
    source: text(row, "source") as CaptionSource,
    blobKey: text(row, "blob_key"),
    isDefault: bool(row, "is_default"),
    createdAt: timestamp(row.created_at),
  };
}
