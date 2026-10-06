"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ChatLine } from "@/ports/sync";

import { createPollingLoop, LOBBY_MS, type PollingLoop } from "@/net/pollingLoop";

/**
 * POLL 1 and POLL 2, behind one hook (SPEC §6, §7).
 *
 * Both bodies carry a `version` cursor and a `chat` window, and both answer
 * `204 No Content` when nothing has moved — so both need exactly the same
 * three behaviours: keep the last body on a `204`, accumulate chat rather
 * than replacing it, and run on the lobby's 5-second cadence with jitter and
 * the hidden-tab stop (D11). That is this hook.
 *
 * The chat window is accumulated because the server sends only the lines
 * newer than `chatSince`: replacing the array would make the column flash
 * empty on every poll that carried no new line.
 *
 * **The cursors live for as long as the component does.** `path` is expected
 * to be fixed per mount — `/api/lobby` is a literal, and a lobby room's path
 * comes from the route segment, so a different code is a different mount. A
 * caller that wants to switch paths in place should give the component a
 * `key`, which is cheaper and clearer than resetting four pieces of state
 * from inside an effect.
 */

export interface ScreenPollBody {
  readonly version: number;
  readonly chat: readonly ChatLine[];
}

export interface ScreenPollState<T extends ScreenPollBody> {
  readonly data: T | null;
  readonly chat: readonly ChatLine[];
  readonly status: "loading" | "live" | "gone" | "error";
  /** Poll right now. Used after a write, and by the retry affordance. */
  readonly refresh: () => Promise<void>;
}

/** How many lines the columns keep. The log scrolls; memory does not grow. */
const CHAT_WINDOW = 200;

export function useScreenPoll<T extends ScreenPollBody>(
  path: string | null,
  intervalMs = LOBBY_MS,
): ScreenPollState<T> {
  const [data, setData] = useState<T | null>(null);
  const [chat, setChat] = useState<readonly ChatLine[]>([]);
  const [status, setStatus] = useState<ScreenPollState<T>["status"]>("loading");

  // Mutated only from inside `poll`, which is a callback and not render.
  const version = useRef(0);
  const chatSince = useRef(0);
  const etag = useRef<string | null>(null);
  const loop = useRef<PollingLoop | null>(null);

  const poll = useCallback(async () => {
    if (path === null) return;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (etag.current !== null) headers["If-None-Match"] = etag.current;

    const response = await fetch(
      `${path}${path.includes("?") ? "&" : "?"}since=${version.current}&chatSince=${chatSince.current}`,
      { method: "GET", headers, cache: "no-store" },
    );

    // A `204` is the common case and means exactly "nothing has moved": the
    // last body stays on screen and no cursor advances.
    if (response.status === 204) {
      setStatus("live");
      return;
    }
    if (response.status === 404 || response.status === 401 || response.status === 403) {
      setStatus("gone");
      loop.current?.stop();
      return;
    }
    if (!response.ok) {
      setStatus("error");
      return;
    }

    const body = (await response.json()) as T;
    version.current = body.version;
    etag.current = `W/"${body.version}"`;
    if (body.chat.length > 0) {
      chatSince.current = Math.max(chatSince.current, ...body.chat.map((line) => line.id));
      setChat((previous) => [...previous, ...body.chat].slice(-CHAT_WINDOW));
    }
    setData(body);
    setStatus("live");
  }, [path]);

  useEffect(() => {
    if (path === null) return;
    const created = createPollingLoop({ poll, intervalMs: () => intervalMs });
    loop.current = created;
    created.start();
    return () => {
      created.stop();
      loop.current = null;
    };
  }, [path, poll, intervalMs]);

  const refresh = useCallback(async () => {
    await (loop.current?.pollNow() ?? poll());
  }, [poll]);

  return { data, chat, status, refresh };
}
