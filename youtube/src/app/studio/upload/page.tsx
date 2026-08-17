import Link from "next/link";
import { cookies } from "next/headers";

import { database } from "@/adapters/db";
import { createChannelsRepository } from "@/adapters/repositories/channels";
// The component's own module, not the barrel — see the note in
// `src/app/studio/page.tsx`.
import { UploadDialog } from "@/components/studio/upload-dialog";
import { SESSION_COOKIE, resolveSession } from "@/lib/auth";

/**
 * `/studio/upload` — the upload dialog, as a route.
 *
 * In the real product this is a `tp-yt-paper-dialog` opened from the Create
 * menu over `/videos` (R9 §12.4, §12.5). It is a route here for one reason
 * that outweighs the fidelity cost: **the encode runs in this tab and takes
 * minutes**, so the thing that holds it has to survive a navigation, be
 * reachable by URL, and be somewhere a `beforeunload` guard is not a surprise.
 * A dialog that is really a route is honest about that; a dialog that closes
 * when you click the backdrop and silently kills a six-minute transcode is not.
 *
 * The dialog keeps its measured dialog geometry — 960 wide, radius 24, on
 * `raised` — so it still reads as the surface §12.5 captured.
 *
 * ## Why the channel is resolved on the server
 *
 * `/api/videos` refuses to create a row for a channel the caller does not own,
 * and `/api/upload/target` refuses to issue a write grant for a video that does
 * not exist. Both refusals are the real gate. Resolving the channel here as
 * well is not a second gate — it is so the page can say "you have no channel"
 * before a file picker appears, rather than after a user has waited through a
 * probe for a 404.
 */

export const dynamic = "force-dynamic";

export default async function StudioUploadPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? null;
  const session = await resolveSession(token);

  if (!session) {
    return (
      <Notice title="Sign in to upload">
        Uploading needs an account: the video row is created before any byte is
        stored, and only a signed-in owner can create one.
      </Notice>
    );
  }

  const db = await database();
  const channels = await createChannelsRepository(db).listForOwner(session.userId);
  const channel = channels[0];

  if (!channel) {
    return (
      <Notice title="No channel yet">
        Videos hang off a channel, not off an account. Create one and this page
        will work.
      </Notice>
    );
  }

  return (
    <div className="flex justify-center py-6">
      <UploadDialog channelId={channel.id} />
    </div>
  );
}

function Notice({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="py-16">
      <h1 className="ytcp-headline m-0">{title}</h1>
      <p className="ytcp-body1 mt-2 max-w-[60ch] text-secondary">{children}</p>
      <p className="ytcp-body1 mt-4">
        <Link href="/studio" className="text-cta">
          Back to your content
        </Link>
      </p>
    </div>
  );
}
