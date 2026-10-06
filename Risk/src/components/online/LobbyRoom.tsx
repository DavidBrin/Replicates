"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type { BotTier } from "@/engine/types";
import type { ChatSend } from "@/ports/sync";
import type { LobbyRoomBody } from "@/net/types";

import ChatColumn from "./ChatColumn";
import { useScreenPoll } from "./useScreenPoll";

/**
 * `/lobby/[code]` — the lobby room (SPEC §7).
 *
 * Six seat rows, each `open` / a human (name, colour, online dot, ready tick)
 * / a bot (robot chip, tier). Host-only controls: the map, add or remove a
 * bot, kick, and **the code itself shown large for reading aloud**. Everyone
 * gets `I'M READY` and the lobby chat column.
 *
 * **No ready-check timer.** RGD's ten-second check is a source of complaints
 * (§7's `[ours]`), so `BATTLE` simply enables at two or more occupied seats
 * with every human ready and waits as long as it takes.
 */

const TIERS: readonly BotTier[] = ["beginner", "easy", "medium", "hard", "expert"];

export interface LobbyRoomProps {
  readonly code: string;
}

export default function LobbyRoom({ code }: LobbyRoomProps) {
  const router = useRouter();
  const { data, chat, status, refresh } = useScreenPoll<LobbyRoomBody>(`/api/lobbies/${code}`);
  const [youId, setYouId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Which seat is mine is a question about the cookie, and POLL 2 does not
  // answer it; POLL 1 does, in `you`. One request on mount is cheaper than
  // adding a field to a poll that runs every five seconds.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/lobby?since=0&chatSince=0", { cache: "no-store" });
      if (!response.ok || cancelled) return;
      const body = (await response.json()) as { you?: { playerId: string } };
      if (body.you) setYouId(body.you.playerId);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The host's `BATTLE` sets the lobby to `playing` with a `gameId`; every
  // other client learns about it from the poll and follows.
  useEffect(() => {
    if (data?.status === "playing" && data.gameId !== null) {
      router.push(`/play/online/${data.gameId}`);
    }
  }, [data?.status, data?.gameId, router]);

  const post = useCallback(
    async (path: string, body?: unknown): Promise<Response> => {
      setBusy(true);
      setError(null);
      try {
        const response = await fetch(`/api/lobbies/${code}${path}`, {
          method: path === "" ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          cache: "no-store",
          body: JSON.stringify(body ?? {}),
        });
        await refresh();
        return response;
      } finally {
        setBusy(false);
      }
    },
    [code, refresh],
  );

  const say = useCallback(
    async (line: ChatSend) => {
      await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ scope: "lobby", scopeId: code, ...line }),
      });
      await refresh();
    },
    [code, refresh],
  );

  if (status === "gone") {
    return (
      <main data-testid="lobby-gone" className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
        <p className="text-[color:var(--text)]">That lobby is no longer there.</p>
        <button
          type="button"
          onClick={() => router.push("/lobby")}
          className="rounded-lg bg-[color:var(--go)] px-5 py-2 font-head font-bold text-white"
        >
          Back to Online
        </button>
      </main>
    );
  }

  const isHost = data !== null && youId !== null && data.hostId === youId;
  const mySeat = data?.seats.find((seat) => seat.playerId === youId) ?? null;
  const occupied = data?.seats.filter((seat) => seat.kind !== "open") ?? [];
  const everyoneReady = occupied
    .filter((seat) => seat.kind === "human")
    .every((seat) => seat.ready);
  const canStart = isHost && occupied.length >= 2 && everyoneReady;

  async function start(): Promise<void> {
    const response = await post("/start");
    if (response.status === 201) {
      const { gameId } = (await response.json()) as { gameId: string };
      router.push(`/play/online/${gameId}`);
      return;
    }
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    setError(
      body.error === "needTwoSeats"
        ? "Two seats have to be taken."
        : body.error === "notAllReady"
          ? "Everyone has to be ready."
          : "Could not start the game.",
    );
  }

  return (
    <main data-testid="lobby-room" className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-wide text-[color:var(--text-muted)]">Code</p>
          <p
            data-testid="lobby-code"
            className="font-head text-5xl font-black tracking-[0.3em] text-[color:var(--gold)]"
          >
            {code}
          </p>
        </div>
        <div className="flex-1">
          <h1 data-testid="lobby-title" className="font-head text-2xl font-bold text-[color:var(--text)]">
            {data?.title ?? "Lobby"}
          </h1>
          <p className="text-sm text-[color:var(--text-muted)]">
            {data?.mapSlug ?? "—"} · Turn timer:{" "}
            {data?.rules.turnSeconds === null || data === null
              ? "off"
              : `${data.rules.turnSeconds}s`}{" "}
            · AI: {data?.rules.aiDifficulty ?? "—"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="lobby-ready"
            disabled={busy || mySeat === null}
            aria-pressed={mySeat?.ready === true}
            onClick={() => void post("/ready", { ready: !(mySeat?.ready ?? false) })}
            className={`rounded-lg px-5 py-2 font-head font-bold ${
              mySeat?.ready
                ? "bg-[color:var(--ok)] text-white"
                : "border border-[color:var(--chrome-line)] text-[color:var(--text)]"
            } disabled:opacity-40`}
          >
            {"I'M READY"}
          </button>
          <button
            type="button"
            data-testid="lobby-leave"
            disabled={busy}
            onClick={async () => {
              await post("/leave");
              router.push("/lobby");
            }}
            className="rounded-lg border border-[color:var(--chrome-line)] px-4 py-2 font-head text-[color:var(--text)]"
          >
            Leave
          </button>
          {isHost && (
            <button
              type="button"
              data-testid="lobby-start"
              disabled={!canStart || busy}
              onClick={() => void start()}
              className="rounded-lg bg-[color:var(--go)] px-6 py-2 font-head text-lg font-bold text-white disabled:bg-[color:var(--disabled)]"
            >
              BATTLE
            </button>
          )}
        </div>
      </header>

      {error !== null && (
        <p data-testid="lobby-room-error" className="text-sm text-[color:var(--danger)]">
          {error}
        </p>
      )}

      <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[1fr_18rem]">
        <ol data-testid="lobby-seats" className="space-y-2">
          {(data?.seats ?? []).map((seat) => (
            <li
              key={seat.seat}
              data-testid={`lobby-seat-${seat.seat}`}
              data-kind={seat.kind}
              data-ready={seat.ready ? "true" : "false"}
              className="flex items-center gap-3 rounded-xl border border-[color:var(--chrome-line)] bg-[color:var(--chrome-800)] px-4 py-3"
            >
              <span className="w-6 font-head text-[color:var(--text-dim)]">{seat.seat + 1}</span>
              <span
                aria-hidden
                style={{ background: seat.colour ? `var(--p-${seat.colour})` : "transparent" }}
                className="h-8 w-8 rounded-full border border-[color:var(--chrome-line)]"
              />
              <span className="flex-1 truncate font-head text-[color:var(--text)]">
                {seat.kind === "open"
                  ? "Open"
                  : seat.kind === "bot"
                    ? `Bot · ${seat.tier ?? "medium"}`
                    : seat.displayName}
              </span>

              {seat.kind === "human" && (
                <>
                  <span
                    data-testid={seat.online ? "seat-online" : "seat-offline"}
                    aria-label={seat.online ? "online" : "away"}
                    className={`h-2 w-2 rounded-full ${
                      seat.online ? "bg-[color:var(--ok)]" : "bg-[color:var(--disabled)]"
                    }`}
                  />
                  {seat.ready && (
                    <span data-testid="seat-ready" aria-label="ready" className="text-[color:var(--ok)]">
                      ✓
                    </span>
                  )}
                </>
              )}

              {isHost && seat.kind === "open" && (
                <span className="flex items-center gap-1">
                  <select
                    data-testid={`lobby-add-bot-${seat.seat}`}
                    defaultValue=""
                    disabled={busy}
                    onChange={(event) => {
                      if (event.target.value === "") return;
                      void post("", {
                        seats: [{ seat: seat.seat, kind: "bot", tier: event.target.value }],
                      });
                    }}
                    className="rounded-lg border border-[color:var(--chrome-line)] bg-[color:var(--chrome-900)] px-2 py-1 text-sm text-[color:var(--text)]"
                  >
                    <option value="">Add a bot…</option>
                    {TIERS.map((tier) => (
                      <option key={tier} value={tier}>
                        {tier}
                      </option>
                    ))}
                  </select>
                </span>
              )}

              {isHost && seat.kind !== "open" && seat.playerId !== youId && (
                <button
                  type="button"
                  data-testid={`lobby-kick-${seat.seat}`}
                  disabled={busy}
                  onClick={() => void post("", { seats: [{ seat: seat.seat, kind: "open" }] })}
                  className="rounded-lg border border-[color:var(--danger)] px-3 py-1 text-sm text-[color:var(--danger)]"
                >
                  {seat.kind === "bot" ? "Remove" : "Kick"}
                </button>
              )}
            </li>
          ))}
        </ol>

        <ChatColumn lines={chat} onSend={(line) => void say(line)} title="Lobby" />
      </div>
    </main>
  );
}
