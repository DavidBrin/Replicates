import Link from "next/link";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { database } from "@/adapters/db";
import { createChannelsRepository } from "@/adapters/repositories/channels";
import {
  claimsForVideo,
  findWork,
  setClaimStatus,
} from "@/adapters/repositories/content-id";
import {
  deleteVideo,
  getVideo,
  listChannelVideos,
} from "@/adapters/repositories/videos";
import { buttonClassName } from "@/components/primitives";
// Imported from the component's own module rather than through
// `@/components/studio`: the barrel also re-exports the upload machine, and a
// Server Component pulling that in would put the transcode worker's chunk
// construction on the server side of the boundary.
import { VideoTable, type StudioVideoRow } from "@/components/studio/video-table";
import type { ClaimView } from "@/components/studio/upload-machine";
import type { Channel } from "@/domain/types";
import { SESSION_COOKIE, resolveSession } from "@/lib/auth";

/**
 * Studio's Content page — `/videos` in the real product (R9 §12.3).
 *
 * ## The one honest inefficiency in this file
 *
 * `listChannelVideos` returns `VideoCard`s, and a card deliberately carries
 * only what a feed row needs — it has no `upload_status`, no `pipeline`, no
 * description and no comment count. Those four are precisely what makes a
 * Studio row a Studio row: the whole point of this table is that it shows the
 * videos every public feed hides. So each listed id is then fetched in full.
 *
 * That is the N+1 `videos.ts` opens by warning about, and it is done here with
 * eyes open for two reasons. The page size is capped at {@link PAGE_SIZE}, so
 * the count is bounded rather than proportional to a feed; and the query that
 * would fix it — a Studio projection, and a `claimsForVideos(ids)` beside it —
 * belongs in `adapters/repositories/`, which this slice does not own. Adding
 * either as raw SQL in a page would put the schema in two places, which is a
 * worse defect than a bounded number of indexed primary-key lookups on one
 * user's own dashboard.
 *
 * ## Why the claims are fetched here rather than lazily
 *
 * Because the Notices column is the second column, not a detail view (§12.3).
 * A claim the owner has to click to discover is a claim they find out about
 * from a viewer.
 */

/** Bounded on purpose — see the header. */
const PAGE_SIZE = 30;

export const dynamic = "force-dynamic";

interface StudioContext {
  readonly userId: string;
  readonly channel: Channel;
}

/**
 * The viewer's own channel, or `null`.
 *
 * `cookies()` rather than `sessionTokenFromRequest`: a server component has no
 * `Request`. The session module builds its cookie by hand for exactly this
 * asymmetry — see the note above `sessionCookie` — so the constant is shared
 * even though the reader is not.
 */
async function studioContext(): Promise<StudioContext | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? null;
  const session = await resolveSession(token);
  if (!session) return null;

  const db = await database();
  const channels = await createChannelsRepository(db).listForOwner(session.userId);
  const channel = channels[0];
  return channel ? { userId: session.userId, channel } : null;
}

/**
 * A blob key as a URL this page can put in an `<img>`.
 *
 * Always through `/api/media`, never a bucket URL: that route is where
 * visibility is enforced, and a private video's thumbnail is as private as its
 * segments. Each segment is encoded separately because the catch-all route
 * decodes them individually — see `blobKeyFromSegments`, which rejects a `/`
 * that arrived percent-encoded inside one.
 */
function mediaUrl(key: string | null): string | null {
  return key === null
    ? null
    : `/api/media/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export default async function StudioContentPage() {
  const context = await studioContext();

  if (!context) {
    return (
      <div className="py-16">
        <h1 className="ytcp-headline m-0">Studio</h1>
        <p className="ytcp-body1 mt-2 text-secondary">
          Sign in with an account that owns a channel to see your content.
        </p>
      </div>
    );
  }

  const db = await database();
  const cards = await listChannelVideos(db, context.channel.id, {
    includeUnlisted: true,
    limit: PAGE_SIZE,
  });

  const rows: StudioVideoRow[] = [];
  for (const card of cards) {
    const [video, claims] = await Promise.all([
      getVideo(db, card.id),
      claimsForVideo(db, card.id),
    ]);
    if (!video) continue;

    const views: ClaimView[] = [];
    for (const claim of claims) {
      const work = await findWork(db, claim.referenceId);
      views.push({
        id: claim.id,
        policy: claim.policy,
        status: claim.status,
        matchStartMs: claim.matchStartMs,
        matchEndMs: claim.matchEndMs,
        referenceOffsetMs: claim.referenceOffsetMs,
        score: claim.score,
        // A landmark can outlive the work it came from — `deleteWork` drops the
        // fingerprints first and the schema carries no foreign key — so a claim
        // citing a withdrawn work is a real state, not a bug.
        referenceTitle: work?.title ?? "A withdrawn reference",
        rightsHolder: work?.rightsHolder ?? "Unknown",
      });
    }

    rows.push({
      id: video.id,
      title: video.title,
      description: video.description,
      thumbnailUrl: mediaUrl(video.thumbnailKey),
      durationSeconds: video.durationSeconds,
      visibility: video.visibility,
      uploadStatus: video.uploadStatus,
      pipeline: video.pipeline,
      viewCount: video.viewCount,
      commentCount: video.commentCount,
      publishedAt: video.publishedAt,
      createdAt: video.createdAt,
      claims: views,
    });
  }

  /**
   * Delete an upload that never finished.
   *
   * A Server Action, not a route: it is reachable only from this page and it
   * has no client that needs to call it out of band. It re-checks the session
   * itself — an action is a public endpoint however it is rendered, and the
   * fact that the button next to it is only drawn for the owner is not an
   * authorisation check.
   */
  async function discard(videoId: string): Promise<void> {
    "use server";
    const inner = await studioContext();
    if (!inner) return;

    const db = await database();
    const video = await getVideo(db, videoId);
    if (!video || video.channelId !== inner.channel.id) return;
    // Published videos are refused here for the same reason
    // `/api/videos` refuses them: sweeping their objects out of storage is a
    // different, heavier operation than dropping an unfinished row.
    if (video.uploadStatus === "ready") return;

    await deleteVideo(db, videoId);
    revalidatePath("/studio");
  }

  /**
   * Dispute a claim.
   *
   * §7 of `research/06` calls the full legal-review pipeline "product theater";
   * the minimal honest loop is uploader disputes → rights-holder releases or
   * reinstates, and `setClaimStatus` is the whole of it. Nothing here touches
   * the video's visibility, because nothing in Content ID ever does.
   */
  async function dispute(claimId: string): Promise<void> {
    "use server";
    const inner = await studioContext();
    if (!inner) return;

    const db = await database();
    // The claim's own video has to belong to this channel. Without this check
    // the action is "any signed-in account may dispute any claim".
    if (!(await claimBelongsToChannel(claimId, inner.channel.id))) return;

    await setClaimStatus(db, claimId, "disputed");
    revalidatePath("/studio");
  }

  return (
    <div className="py-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="ytcp-title m-0">Channel content</h1>
        <Link
          href="/studio/upload"
          className={buttonClassName({ variant: "outline", size: "m" })}
        >
          Create
        </Link>
      </div>

      <p className="ytcp-caption1 mt-1 mb-6 text-secondary">
        {context.channel.name} · every video on this channel, including the ones
        no feed shows.
      </p>

      <VideoTable videos={rows} onDiscard={discard} onDispute={dispute} />
    </div>
  );
}

/**
 * Does this claim hang off a video on this channel?
 *
 * `content-id.ts` offers `claimsForVideo` and no `findClaim`, so ownership is
 * established the way the data allows: walk this channel's own videos and see
 * whether the claim is among theirs. Bounded by {@link PAGE_SIZE} for the same
 * reason the listing above is, and the honest fix is the same — a `findClaim`
 * in the repository that owns the table.
 */
async function claimBelongsToChannel(
  claimId: string,
  channelId: string,
): Promise<boolean> {
  const db = await database();
  const cards = await listChannelVideos(db, channelId, {
    includeUnlisted: true,
    limit: PAGE_SIZE,
  });
  for (const card of cards) {
    const claims = await claimsForVideo(db, card.id);
    if (claims.some((claim) => claim.id === claimId)) return true;
  }
  return false;
}
