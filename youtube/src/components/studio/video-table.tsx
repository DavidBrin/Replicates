"use client";

import clsx from "clsx";
import { useMemo, useState } from "react";

import { CheckIcon, ChevronIcon, FlagIcon } from "@/components/icons";
import { Button } from "@/components/primitives";
import {
  formatAbsoluteDate,
  formatCommentCount,
  formatDuration,
  formatViewCount,
} from "@/domain/format";
import type { Pipeline, UploadStatus, Visibility } from "@/domain/types";

import { Claims } from "./claims";
import type { ClaimView } from "./upload-machine";

/**
 * Studio's content table — `ytcp-video-row` under `ytcp-table-header`.
 *
 * Geometry from R9 §12.3, measured at a 1512px viewport:
 *
 *   table header   1264 × 48   bg #0f0f0f   labels 12/47 w500 #aaa,
 *                                           **w700 on the sorted column**
 *   row            1264 × 84
 *   thumbnail      120 × 68   radius 8px   with a duration chip bottom-right
 *   title          14/20 w400, with «Add description» in #aaa beneath it
 *   columns        Video · Notices · Visibility · Date · Views · Comments
 *
 * The column order is not cosmetic. **Notices sits second, immediately after
 * the video itself** — before visibility, before the date, before the numbers.
 * That is where Content ID lives in the real product, and it is why this table
 * renders claims inline rather than hiding them behind a row menu.
 *
 * ## The four upload states are four different rows
 *
 * `videos.upload_status` has four values and each means something different to
 * the owner, so each gets its own cell rather than a shared spinner:
 *
 *  - **uploading** — a row with no playable bytes behind it. Either an upload
 *    in flight in another tab, or one whose tab was closed. This is the state
 *    the resumability decision leaves behind (see `upload-dialog.tsx`), and it
 *    is the only one that carries a Delete affordance, because it is the only
 *    one that can be abandoned. A row like this must never look like a video.
 *  - **processing** — the bytes are all stored and the row is not published.
 *    In this application that is a *finished upload waiting for its author*,
 *    not a server-side transcode queue: D1's whole point is that there is no
 *    queue. The copy says so.
 *  - **ready** — published, and the only state any public feed will show.
 *  - **failed** — the encode or the upload gave up. Also deletable.
 */

export interface StudioVideoRow {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly thumbnailUrl: string | null;
  readonly durationSeconds: number;
  readonly visibility: Visibility;
  readonly uploadStatus: UploadStatus;
  readonly pipeline: Pipeline;
  readonly viewCount: number;
  readonly commentCount: number;
  readonly publishedAt: Date | null;
  readonly createdAt: Date;
  readonly claims: readonly ClaimView[];
}

export type VideoTableSort = "date" | "views";

export interface VideoTableProps {
  readonly videos: readonly StudioVideoRow[];
  /** Present in the owner's own Studio; absent on a read-only rendering. */
  readonly onDiscard?: (videoId: string) => void | Promise<void>;
  readonly onDispute?: (claimId: string) => void | Promise<void>;
  readonly className?: string;
}

const STATUS_COPY: Readonly<
  Record<UploadStatus, { label: string; detail: string; tone: string }>
> = {
  uploading: {
    label: "Upload incomplete",
    detail:
      "This video has no media behind it yet. If its tab was closed, the " +
      "encode cannot be resumed — delete it and upload again.",
    tone: "text-[var(--yt-icon-warning)]",
  },
  processing: {
    label: "Ready to publish",
    detail:
      "Everything is stored and nothing is being transcoded on a server — " +
      "this video is only waiting for you to publish it.",
    tone: "text-secondary",
  },
  ready: { label: "Published", detail: "", tone: "text-secondary" },
  failed: {
    label: "Upload failed",
    detail: "Nothing usable was stored. Delete it and try again.",
    tone: "text-[var(--yt-error-indicator)]",
  },
};

const VISIBILITY_LABEL: Readonly<Record<Visibility, string>> = {
  public: "Public",
  unlisted: "Unlisted",
  private: "Private",
};

export function VideoTable({
  videos,
  onDiscard,
  onDispute,
  className,
}: VideoTableProps) {
  const [sort, setSort] = useState<VideoTableSort>("date");
  const [expanded, setExpanded] = useState<string | null>(null);

  const ordered = useMemo(() => {
    const rows = [...videos];
    rows.sort((a, b) => {
      if (sort === "views") {
        // The id tiebreaker is the same rule the repositories follow: PGlite's
        // `now()` resolves to milliseconds where Postgres resolves to
        // microseconds, so a timestamp alone is not a total order locally (D19).
        return b.viewCount - a.viewCount || a.id.localeCompare(b.id);
      }
      const at = (row: StudioVideoRow) => (row.publishedAt ?? row.createdAt).getTime();
      return at(b) - at(a) || a.id.localeCompare(b.id);
    });
    return rows;
  }, [videos, sort]);

  if (videos.length === 0) {
    return (
      <p className={clsx("ytcp-body1 text-secondary", className)}>
        No content yet. Upload a video and it will appear here — including while
        it is still uploading.
      </p>
    );
  }

  return (
    <table className={clsx("w-full border-collapse text-left", className)}>
      <thead>
        <tr className="h-12 border-b border-outline">
          <Th>Video</Th>
          <Th>Notices</Th>
          <Th>Visibility</Th>
          <Th
            sortable
            sorted={sort === "date"}
            onSort={() => setSort("date")}
            align="right"
          >
            Date
          </Th>
          <Th
            sortable
            sorted={sort === "views"}
            onSort={() => setSort("views")}
            align="right"
          >
            Views
          </Th>
          <Th align="right">Comments</Th>
        </tr>
      </thead>
      <tbody>
        {ordered.map((video) => (
          <Row
            key={video.id}
            video={video}
            expanded={expanded === video.id}
            onToggle={() => setExpanded(expanded === video.id ? null : video.id)}
            {...(onDiscard ? { onDiscard } : {})}
            {...(onDispute ? { onDispute } : {})}
          />
        ))}
      </tbody>
    </table>
  );
}

interface ThProps {
  readonly children: React.ReactNode;
  readonly sortable?: boolean;
  readonly sorted?: boolean;
  readonly onSort?: () => void;
  readonly align?: "left" | "right";
}

/**
 * A column heading.
 *
 * 12px, weight 500 — and **weight 700 on the sorted column**, which is the one
 * measured detail here that a reimplementation invariably drops (§12.3). The
 * arrow is the second half of the same signal, not a replacement for it.
 */
function Th({ children, sortable, sorted, onSort, align = "left" }: ThProps) {
  const label = (
    <span
      className={clsx(
        "ytcp-caption2 text-secondary",
        sorted && "font-[var(--yt-weight-bold)]",
      )}
    >
      {children}
      {sorted ? <ChevronIcon size={12} direction="down" className="ml-1 inline" /> : null}
    </span>
  );

  return (
    <th
      scope="col"
      aria-sort={sortable ? (sorted ? "descending" : "none") : undefined}
      className={clsx("px-3 font-normal", align === "right" && "text-right")}
    >
      {sortable ? (
        <button type="button" onClick={onSort} className="cursor-pointer">
          {label}
        </button>
      ) : (
        label
      )}
    </th>
  );
}

interface RowProps {
  readonly video: StudioVideoRow;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onDiscard?: (videoId: string) => void | Promise<void>;
  readonly onDispute?: (claimId: string) => void | Promise<void>;
}

function Row({ video, expanded, onToggle, onDiscard, onDispute }: RowProps) {
  const status = STATUS_COPY[video.uploadStatus];
  /**
   * Every state except `ready` gets the explanation strip and the Delete
   * button, and the boundary is deliberately the same one `/api/videos`'
   * `DELETE` enforces: an unpublished row can be dropped outright, a published
   * one needs its objects swept out of storage first. A button that is drawn
   * where the endpoint would refuse it is a button that lies.
   */
  const unpublished = video.uploadStatus !== "ready";
  const activeClaims = video.claims.filter((claim) => claim.status !== "released");

  return (
    <>
      <tr
        data-video-id={video.id}
        data-upload-status={video.uploadStatus}
        className="h-[84px] border-b border-outline align-middle"
      >
        <td className="px-3">
          <div className="flex items-center gap-3">
            <div className="relative h-[68px] w-[120px] shrink-0 overflow-hidden rounded-compact bg-additive">
              {video.thumbnailUrl ? (
                /* A Studio row's thumbnail is a blob-store URL whose host varies
                   with the driver, and `next/image` would need every one of them
                   allow-listed in `next.config.ts`, which this slice does not
                   own. */
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={video.thumbnailUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : null}
              {video.durationSeconds > 0 ? (
                <span className="ytcp-caption2 absolute right-1 bottom-1 rounded-condensed bg-overlay-medium px-1 text-overlay-primary">
                  {formatDuration(video.durationSeconds)}
                </span>
              ) : null}
            </div>
            <div className="min-w-0">
              <p className="ytcp-body1 m-0 truncate">{video.title}</p>
              <p className="ytcp-caption1 m-0 truncate text-secondary">
                {video.description.trim() === ""
                  ? "Add description"
                  : video.description}
              </p>
              <p className={clsx("ytcp-caption1 m-0", status.tone)}>
                {status.label}
                {video.pipeline === "progressive" ? " · single quality" : ""}
              </p>
            </div>
          </div>
        </td>

        <td className="px-3">
          {activeClaims.length === 0 ? (
            <span className="ytcp-caption1 text-secondary">None</span>
          ) : (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={expanded}
              className="ytcp-caption1 inline-flex cursor-pointer items-center gap-1 text-[var(--yt-icon-warning)]"
            >
              <FlagIcon size={16} />
              {activeClaims.length === 1
                ? "1 copyright claim"
                : `${activeClaims.length} copyright claims`}
              <ChevronIcon size={12} direction={expanded ? "up" : "down"} />
            </button>
          )}
        </td>

        <td className="px-3">
          <span className="ytcp-body1 inline-flex items-center gap-2">
            {video.visibility === "public" ? (
              <CheckIcon size={16} className="text-secondary" />
            ) : null}
            {VISIBILITY_LABEL[video.visibility]}
          </span>
        </td>

        <td className="px-3 text-right">
          <p className="ytcp-body1 m-0">
            {formatAbsoluteDate(video.publishedAt ?? video.createdAt)}
          </p>
          <p className="ytcp-caption1 m-0 text-secondary">
            {video.publishedAt ? "Published" : "Uploaded"}
          </p>
        </td>

        <td className="ytcp-body1 px-3 text-right">
          {/* An unpublished row genuinely has no views, and a `0` next to a
              published `0` would be the same glyph for two different facts. */}
          {video.uploadStatus === "ready" ? formatViewCount(video.viewCount) : "—"}
        </td>
        <td className="ytcp-body1 px-3 text-right">
          {video.uploadStatus === "ready"
            ? formatCommentCount(video.commentCount)
            : "—"}
        </td>
      </tr>

      {unpublished || expanded ? (
        <tr data-detail-for={video.id}>
          <td colSpan={6} className="px-3 pb-4">
            {unpublished ? (
              <div className="flex items-center justify-between gap-4 rounded-compact border border-outline p-3">
                <p className="ytcp-caption1 m-0 text-secondary">{status.detail}</p>
                {onDiscard ? (
                  <Button
                    variant="outline"
                    size="s"
                    onClick={() => void onDiscard(video.id)}
                  >
                    Delete
                  </Button>
                ) : null}
              </div>
            ) : null}
            {expanded ? (
              <Claims
                claims={video.claims}
                scanned
                {...(onDispute ? { onDispute } : {})}
                className="mt-3"
              />
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}
