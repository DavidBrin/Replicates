"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ModeTab, ScreenBanner } from "@/components/ui/Panel";
import { SkewButton, SkewPanel } from "@/components/ui/SkewPanel";
import { bindSession, leaveOnline, roomErrorMessage, useOnlineStore } from "@/lib/onlineStore";
import { OnlineSession, setActiveSession, type OnlineSessionLike, type OpenSessionOptions } from "@/net/online/session";
import { makeRoomCode, normalizeRoomCode, roomCodeProblem } from "@/net/roomCode";
import type { RoomIntent } from "@/net/signalProtocol";

export type OpenSession = (roomCode: string, intent: RoomIntent, options: OpenSessionOptions) => Promise<OnlineSessionLike>;

/** A fresh four-letter code colliding three times running means something else is wrong. */
const MAX_CREATE_ATTEMPTS = 3;

/**
 * Online: make a room and read its code out, or type the code you were given.
 *
 * Nothing here plays. It opens the session, shows where the handshake has
 * got to, and once the direct connection is up hands over to the existing
 * screens — the host to stage select (the host picks the stage), the guest
 * straight to character select.
 */
export function OnlineLobby({ openSession = OnlineSession.open }: { openSession?: OpenSession }) {
  const router = useRouter();
  const status = useOnlineStore((s) => s.status);
  const role = useOnlineStore((s) => s.role);
  const roomCode = useOnlineStore((s) => s.roomCode);
  const error = useOnlineStore((s) => s.error);
  const errorReason = useOnlineStore((s) => s.errorReason);

  const [typed, setTyped] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const createAttempts = useRef(0);
  /** Only a room opened from this screen may move the player on. */
  const openedHere = useRef(false);
  /**
   * Which `connect` is the live one. Opening a session awaits the network, so
   * a player can leave (back button, browser back) before it answers; the
   * answer is then stale and must not start a room nobody is looking at.
   */
  const live = useRef(0);

  // Arriving here always starts afresh: a room left open by a back button or
  // a finished match must not bounce the player straight back into it.
  useEffect(() => {
    leaveOnline();
    return () => {
      live.current += 1;
    };
  }, []);

  const connect = useCallback(
    async (code: string, intent: RoomIntent) => {
      openedHere.current = true;
      const mine = (live.current += 1);
      // Everything a room leaves on the store goes, so a new one starts clean.
      useOnlineStore.getState().patch({
        status: "connecting",
        roomCode: code,
        role: null,
        error: null,
        errorReason: null,
        notice: null,
        remoteAway: false,
        config: null,
        hostStage: null,
      });
      // `?ice=relay` forces TURN, so a test can prove the relay works.
      const forceRelay = new URLSearchParams(window.location.search).get("ice") === "relay";
      try {
        const session = await openSession(code, intent, { forceRelay });
        if (live.current !== mine) {
          session.close();
          return;
        }
        setActiveSession(session);
        bindSession(session);
      } catch {
        if (live.current !== mine) return;
        useOnlineStore.getState().patch({ status: "error", errorReason: "unreachable", error: roomErrorMessage("unreachable", code) });
      }
    },
    [openSession],
  );

  // No React state is set in here: the retry effect below calls it.
  const create = useCallback(() => {
    createAttempts.current += 1;
    void connect(makeRoomCode(), "create");
  }, [connect]);

  const join = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const problem = roomCodeProblem(typed);
    setFormError(problem);
    const code = normalizeRoomCode(typed);
    if (problem || code === null) return;
    createAttempts.current = 0;
    void connect(code, "join");
  };

  // A freshly made code somebody else is using: quietly make another. Only
  // for a room this screen is making (`createAttempts` counts them): an old
  // error on arrival, or a join, never makes a room.
  useEffect(() => {
    if (status === "error" && errorReason === "taken" && createAttempts.current > 0 && createAttempts.current < MAX_CREATE_ATTEMPTS) {
      create();
    }
  }, [create, errorReason, status]);

  useEffect(() => {
    if (openedHere.current && status === "connected" && role !== null) router.push(role === "host" ? "/stage" : "/fighters");
  }, [role, router, status]);

  const busy = status === "connecting" || status === "waiting" || status === "linking" || status === "connected";
  const message = formError ?? error;

  return (
    <main className="flex min-h-dvh flex-col bg-[#101215]">
      <ScreenBanner
        onBack={() => {
          live.current += 1;
          leaveOnline();
          router.push("/menu");
        }}
        backLabel="Back to the main menu"
        tab={<ModeTab label="Online" caret={false} />}
      />

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-10 sm:px-8">
        <h1 className="font-display text-4xl tracking-[0.08em] text-white uppercase">Online</h1>

        {busy && role === "host" && status !== "connected" ? (
          <SkewPanel className="border-[3px] border-panel-ink bg-panel-bone" innerClassName="px-8 py-6 text-panel-ink">
            <p className="text-sm font-bold">Your room code</p>
            <p data-testid="room-code" className="font-display text-6xl tracking-[0.3em]">
              {roomCode}
            </p>
            <p className="mt-2 text-sm">
              {status === "linking" ? "They are in. Opening a direct connection…" : "Read it to the other player. Waiting for them to join…"}
            </p>
          </SkewPanel>
        ) : busy ? (
          <p role="status" className="text-white/80">
            {status === "linking" ? "Opening a direct connection…" : `Connecting to room ${roomCode ?? ""}…`}
          </p>
        ) : (
          <>
            <SkewButton
              onClick={() => {
                setFormError(null);
                createAttempts.current = 0;
                create();
              }}
              className="self-start border-[4px] border-panel-ink bg-smash-yellow px-8 py-4 text-panel-ink shadow-[0_8px_0_rgb(0_0_0/0.45)]"
              innerClassName="font-display text-2xl tracking-[0.16em] uppercase"
            >
              Create room
            </SkewButton>
            <form onSubmit={join} className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm font-bold text-white/80">
                Room code
                <input
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  maxLength={6}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  className="w-40 border-[3px] border-panel-ink bg-white px-3 py-2 font-display text-2xl tracking-[0.3em] text-panel-ink uppercase"
                />
              </label>
              <SkewButton
                type="submit"
                className="border-[3px] border-panel-ink bg-panel-bone px-6 py-3 text-panel-ink"
                innerClassName="font-display text-lg tracking-[0.14em] uppercase"
              >
                Join room
              </SkewButton>
            </form>
          </>
        )}

        {message ? (
          <p role="alert" className="text-sm font-bold text-smash-yellow">
            {message}
          </p>
        ) : null}
      </div>
    </main>
  );
}
