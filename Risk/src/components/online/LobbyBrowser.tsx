"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { PLAYABLE_MAP_SLUGS } from "@/components/online/maps";
import { DEFAULT_RULES, TURN_SECONDS, type Rules } from "@/engine/types";
import type { ChatSend } from "@/ports/sync";
import type { LobbyBrowseBody } from "@/net/types";

import ChatColumn from "./ChatColumn";
import IdentitySheet from "./IdentitySheet";
import { useScreenPoll } from "./useScreenPoll";

/**
 * `/lobby` — the online lobby browser (SPEC §7).
 *
 * Three columns: the online-players list (avatar, name, a green dot when
 * `online`), the open-lobbies list (title, host, map, `2/6`, `Join`), and a
 * global chat column — plus `Create` and a four-letter code entry field.
 *
 * **The shell renders immediately**, before the first poll answers, because
 * Neon's free tier scales to zero after five minutes idle and the cold start
 * lands on the first person through the door (§6.4). A spinner over an empty
 * page would make a 300 ms wake look like a broken site.
 *
 * POLL 1 at 5 s, through {@link useScreenPoll}: one invocation carries the
 * players, the lobbies, the chat and the caller's own heartbeat.
 */

/** Online lobbies always carry a turn timer; 90 s is §7's default. */
const ONLINE_RULES: Rules = { ...DEFAULT_RULES, turnSeconds: TURN_SECONDS[1] };

export default function LobbyBrowser() {
  const router = useRouter();
  const { data, chat, status, refresh } = useScreenPoll<LobbyBrowseBody>("/api/lobby");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const needsIdentity = status === "gone";

  const say = useCallback(
    async (line: ChatSend) => {
      await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ scope: "global", ...line }),
      });
      await refresh();
    },
    [refresh],
  );

  async function create(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/lobbies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          title: `${data?.you.displayName ?? "A"}'s game`,
          mapSlug: PLAYABLE_MAP_SLUGS[0] ?? "classic-world",
          rules: ONLINE_RULES,
          maxSeats: 6,
        }),
      });
      if (response.status === 409) {
        // Already hosting: the response carries the code, so the right answer
        // is to take the host back to their own room rather than refuse.
        const body = (await response.json()) as { code?: string };
        if (body.code) {
          router.push(`/lobby/${body.code}`);
          return;
        }
      }
      if (!response.ok) {
        setError("Could not create a lobby.");
        return;
      }
      const { code: created } = (await response.json()) as { code: string };
      router.push(`/lobby/${created}`);
    } finally {
      setBusy(false);
    }
  }

  async function join(target: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/lobbies/${target}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({}),
      });
      if (response.status === 404) {
        setError("No lobby with that code.");
        return;
      }
      if (response.status === 409) {
        const body = (await response.json()) as { error?: string };
        if (body.error === "alreadySeated") {
          router.push(`/lobby/${target}`);
          return;
        }
        setError(body.error === "lobbyFull" ? "That lobby is full." : "That seat is taken.");
        return;
      }
      if (!response.ok) {
        setError("Could not join.");
        return;
      }
      router.push(`/lobby/${target}`);
    } finally {
      setBusy(false);
    }
  }

  if (needsIdentity) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <IdentitySheet title="Pick a name to play online" onClaimed={() => void refresh()} />
      </main>
    );
  }

  return (
    <main data-testid="lobby-browser" className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-head text-3xl font-black text-[color:var(--text)]">Online</h1>
        <div className="flex items-center gap-2">
          <input
            data-testid="lobby-code-input"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase().slice(0, 4))}
            placeholder="CODE"
            aria-label="Lobby code"
            className="w-24 rounded-lg border border-[color:var(--chrome-line)] bg-[color:var(--chrome-900)] px-3 py-2 text-center font-head text-lg tracking-widest text-[color:var(--text)]"
          />
          <button
            type="button"
            data-testid="lobby-join-code"
            disabled={code.length !== 4 || busy}
            onClick={() => void join(code)}
            className="rounded-lg border border-[color:var(--chrome-line)] px-4 py-2 font-head font-bold text-[color:var(--text)] disabled:opacity-40"
          >
            Join
          </button>
          <button
            type="button"
            data-testid="lobby-create"
            disabled={busy}
            onClick={() => void create()}
            className="rounded-lg bg-[color:var(--go)] px-5 py-2 font-head font-bold text-white disabled:bg-[color:var(--disabled)]"
          >
            Create
          </button>
        </div>
      </header>

      {error !== null && (
        <p data-testid="lobby-error" className="text-sm text-[color:var(--danger)]">
          {error}
        </p>
      )}

      <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[18rem_1fr_18rem]">
        <section
          data-testid="online-players"
          className="rounded-xl border border-[color:var(--chrome-line)] bg-[color:var(--chrome-800)]"
        >
          <h2 className="border-b border-[color:var(--chrome-line)] px-4 py-3 font-head text-sm font-bold tracking-wide uppercase text-[color:var(--text-muted)]">
            Players
          </h2>
          <ul className="space-y-1 p-3">
            {(data?.players ?? []).map((player) => (
              <li
                key={player.id}
                data-testid="online-player"
                className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-[color:var(--text)]"
              >
                <span
                  aria-hidden
                  style={{ background: `var(--p-${player.colour})` }}
                  className="h-6 w-6 rounded-full border border-[color:var(--chrome-line)]"
                />
                <span className="flex-1 truncate">{player.displayName}</span>
                <span
                  data-testid={player.online ? "player-online" : "player-offline"}
                  aria-label={player.online ? "online" : "away"}
                  className={`h-2 w-2 rounded-full ${
                    player.online ? "bg-[color:var(--ok)]" : "bg-[color:var(--disabled)]"
                  }`}
                />
              </li>
            ))}
            {data !== null && data.players.length === 0 && (
              <li className="px-2 py-1 text-sm text-[color:var(--text-dim)]">Nobody else yet.</li>
            )}
          </ul>
        </section>

        <section
          data-testid="open-lobbies"
          className="rounded-xl border border-[color:var(--chrome-line)] bg-[color:var(--chrome-800)]"
        >
          <h2 className="border-b border-[color:var(--chrome-line)] px-4 py-3 font-head text-sm font-bold tracking-wide uppercase text-[color:var(--text-muted)]">
            Open games
          </h2>
          <ul className="divide-y divide-[color:var(--chrome-line)]">
            {(data?.lobbies ?? []).map((lobby) => (
              <li
                key={lobby.code}
                data-testid="lobby-row"
                className="flex flex-wrap items-center gap-3 px-4 py-3"
              >
                <span className="font-head text-lg tracking-widest text-[color:var(--gold)]">
                  {lobby.code}
                </span>
                <span className="flex-1 truncate text-[color:var(--text)]">{lobby.title}</span>
                <span className="text-sm text-[color:var(--text-muted)]">{lobby.hostName}</span>
                <span className="text-sm text-[color:var(--text-muted)]">{lobby.mapSlug}</span>
                <span data-testid="lobby-seats" className="text-sm text-[color:var(--text)]">
                  {lobby.seatsTaken}/{lobby.maxSeats}
                </span>
                <button
                  type="button"
                  data-testid="lobby-join"
                  disabled={busy || lobby.seatsTaken >= lobby.maxSeats}
                  onClick={() => void join(lobby.code)}
                  className="rounded-lg bg-[color:var(--go)] px-4 py-1.5 font-head font-bold text-white disabled:bg-[color:var(--disabled)]"
                >
                  Join
                </button>
              </li>
            ))}
            {data !== null && data.lobbies.length === 0 && (
              <li className="px-4 py-6 text-sm text-[color:var(--text-dim)]">
                No open games. Create one.
              </li>
            )}
          </ul>
        </section>

        <ChatColumn lines={chat} onSend={(line) => void say(line)} title="All" />
      </div>
    </main>
  );
}
