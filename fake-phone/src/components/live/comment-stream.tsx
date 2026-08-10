"use client";

/**
 * The comment stream: lower-left, stacked bottom-up, rising and fading.
 *
 * research/instagram-live-ui.md §0 rates this the second-strongest signal that
 * a stream is live (after the badge), and §3 gives the treatment: a small
 * circular avatar, a bold username, regular message text, all white with a
 * text-shadow rather than a bubble, three to five visible at once, older ones
 * fading out. Every timing number in §3 is LOW-confidence, so the ones here are
 * chosen defaults.
 */

import type { LiveComment } from "@/domain/live-session";

export function CommentStream({
  comments,
  elapsedMs,
}: {
  readonly comments: readonly LiveComment[];
  readonly elapsedMs: number;
}) {
  return (
    <div
      data-testid="comment-stream"
      // Hidden from assistive tech on purpose. A screen reader narrating a
      // stream of simulated comments would be noise at best, and at worst it
      // would announce out loud — next to the person this is meant to protect
      // — that the audience is not real.
      aria-hidden="true"
      className="pointer-events-none absolute bottom-16 left-3 z-30 flex w-[72%] flex-col justify-end gap-2"
    >
      {comments.map((comment) => (
        <CommentRow key={comment.id} comment={comment} age={elapsedMs - comment.at} />
      ))}
    </div>
  );
}

/** Comments start fading once they are this old, so the stack thins out
 * instead of sitting on the video. §3 says "a few seconds"; this is a default. */
const FADE_AFTER_MS = 9_000;
const FADE_OVER_MS = 4_000;

function CommentRow({ comment, age }: { readonly comment: LiveComment; readonly age: number }) {
  const fade = Math.min(1, Math.max(0, (age - FADE_AFTER_MS) / FADE_OVER_MS));
  const opacity = 1 - fade * 0.9;

  if (comment.kind === "system") {
    // §3: join notices are visually distinct from real comments — no avatar,
    // not bold, dimmed. The copy itself is a chosen default (see
    // `LIVE_JOIN_MESSAGE`), not a verified string.
    return (
      <p
        className="fp-live-enter text-[13px] leading-tight text-white/70"
        style={{ opacity, textShadow: "0 1px 2px rgba(0,0,0,0.55)" }}
      >
        {comment.text}
      </p>
    );
  }

  return (
    <div className="fp-live-enter flex items-start gap-2" style={{ opacity }}>
      <span
        className="mt-0.5 h-6 w-6 shrink-0 rounded-full text-[10px] font-semibold leading-6 text-center text-white/90"
        // A generated avatar rather than a fetched image: no network request on
        // a screen that must work with no signal, and no third-party face.
        style={{ backgroundColor: `hsl(${comment.avatarHue} 45% 42%)` }}
      >
        {comment.username.slice(0, 1).toUpperCase()}
      </span>
      <p
        className="text-[14px] leading-tight text-white"
        style={{ textShadow: "0 1px 2px rgba(0,0,0,0.55)" }}
      >
        <span className="font-bold">{comment.username}</span>{" "}
        <span className="font-normal">{comment.text}</span>
      </p>
    </div>
  );
}
