"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ModeTab, ScreenBanner } from "@/components/ui/Panel";
import { ensureBakeInstalled } from "@/game/bake";
import { useBake } from "@/game/useBake";
import { SkewButton, SkewPanel } from "@/components/ui/SkewPanel";
import { bindSession, leaveOnline, roomErrorMessage, useOnlineStore, type OnlineStatus } from "@/lib/onlineStore";
import { OnlineSession, setActiveSession, type OnlineSessionLike, type OpenSessionOptions } from "@/net/online/session";
import { makeRoomCode, normalizeRoomCode, roomCodeProblem } from "@/net/roomCode";
import type { Role, RoomIntent } from "@/net/signalProtocol";
import { NO_WEBGL, canDrawWebGL } from "@/render3d/webgl";

export type OpenSession = (roomCode: string, intent: RoomIntent, options: OpenSessionOptions) => Promise<OnlineSessionLike>;

/** A fresh four-letter code colliding three times running means something else is wrong. */
const MAX_CREATE_ATTEMPTS = 3;

/** What the player reads when every fresh code was taken: not a code they never saw. */
const NO_FREE_CODE = "Could not find a free room code. Try again.";

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
  const storeStatus = useOnlineStore((s) => s.status);
  const role = useOnlineStore((s) => s.role);
  const roomCode = useOnlineStore((s) => s.roomCode);
  const storeError = useOnlineStore((s) => s.error);
  const errorReason = useOnlineStore((s) => s.errorReason);

  const [typed, setTyped] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  /**
   * What the player last asked this screen for. Until they ask, the store is
   * not this screen's to show: whatever an earlier visit left there is about
   * to be cleared, and must not flash, bounce the player on, or be announced.
   */
  const [tried, setTried] = useState<RoomIntent | null>(null);
  const errorId = useId();
  const codePanel = useRef<HTMLDivElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const joinButton = useRef<HTMLButtonElement>(null);
  /**
   * Which `connect` is the live one. Opening a session awaits the network, so
   * a player can leave (back button, browser back) before it answers; the
   * answer is then stale and must not start a room nobody is looking at.
   */
  const live = useRef(0);
  /** Set once the select screens have the room, so that leaving this screen must not close it. */
  const handedOn = useRef(false);

  // The bake's download starts on arrival, while the player reads the screen:
  // `connect` waits for it, and by then it is usually in (Plan 4).
  useBake();

  // Arriving here always starts afresh: a room left open by a back button or
  // a finished match must not bounce the player straight back into it.
  useEffect(() => {
    leaveOnline();
    return () => {
      live.current += 1;
      // Leaving any other way than on to the select screens (browser back, a
      // swipe) abandons the room: left open, it would stay joinable by code.
      if (!handedOn.current) leaveOnline();
    };
  }, []);

  /** `freshCodesLeft` is how many more codes a create may try if this one is taken. */
  async function connect(code: string, intent: RoomIntent, freshCodesLeft = 0): Promise<void> {
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
    // WebGL before anything (D57: a match is drawn only in 3D). A browser that
    // cannot draw the match opens no room: the other player would wait on a
    // match that never starts until their link monitor gave up, about ten
    // seconds. Asked on every try, so turning acceleration on and trying again works.
    if (!canDrawWebGL()) {
      useOnlineStore.getState().patch({ status: "error", error: NO_WEBGL });
      return;
    }
    // Then the bake, before the session (ruling R2): installing it changes this
    // build's engine fingerprint, and the first `hello` the session says must
    // already carry the bake's, or the other side refuses this one for good. One
    // that cannot load is this screen's error, in its own sentence; no room is
    // opened.
    try {
      await ensureBakeInstalled();
    } catch (e) {
      if (live.current !== mine) return;
      useOnlineStore.getState().patch({ status: "error", error: e instanceof Error ? e.message : String(e) });
      return;
    }
    if (live.current !== mine) return;
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
      if (freshCodesLeft > 0) {
        // A freshly made code somebody else is using: quietly make another.
        // This listener runs right after the store's, in the same pass, so
        // the refusal is replaced before anything is drawn.
        session.on((event) => {
          if (event.type === "error" && event.reason === "taken" && live.current === mine) {
            void connect(makeRoomCode(), "create", freshCodesLeft - 1);
          }
        });
      }
    } catch {
      if (live.current !== mine) return;
      useOnlineStore.getState().patch({ status: "error", errorReason: "unreachable", error: roomErrorMessage("unreachable", code) });
    }
  }

  const join = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const problem = roomCodeProblem(typed);
    setFormError(problem);
    const code = normalizeRoomCode(typed);
    if (problem || code === null) {
      codeInput.current?.focus();
      return;
    }
    setTried("join");
    void connect(code, "join");
  };

  const status: OnlineStatus = tried === null ? "idle" : storeStatus;
  const busy = status === "connecting" || status === "waiting" || status === "linking" || status === "connected";
  const showCode = busy && role === "host" && status !== "connected";
  // A taken code is only ever shown once the quiet retries have run out.
  const storeMessage = tried === null ? null : errorReason === "taken" ? NO_FREE_CODE : storeError;
  const message = formError ?? storeMessage;
  /** The room turned the code itself away: full, or no such room. Any other failure is not the code's fault. */
  const codeRefused = tried === "join" && (errorReason === "full" || errorReason === "not-found");
  /** The code the player typed is what is wrong, as opposed to a room that would not open. */
  const codeInvalid = formError !== null || codeRefused;

  useEffect(() => {
    if (tried !== null && status === "connected" && role !== null) {
      handedOn.current = true;
      router.push(role === "host" ? "/stage" : "/fighters");
    }
  }, [role, router, status, tried]);

  // The code is the one thing the host has to read out: put the reader there.
  useEffect(() => {
    if (showCode) codePanel.current?.focus();
  }, [showCode]);

  // A failed attempt puts the player back where they can try again: in the
  // box when the code is what did not work, so it can be fixed; otherwise on
  // the button they pressed, which was hidden while it ran.
  useEffect(() => {
    if (tried === null || busy || storeError === null) return;
    if (codeRefused) codeInput.current?.focus();
    else (tried === "join" ? joinButton : createButton).current?.focus();
  }, [busy, codeRefused, storeError, tried]);

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

        {showCode ? (
          <SkewPanel className="border-[3px] border-panel-ink bg-panel-bone" innerClassName="px-8 py-6 text-panel-ink">
            <div ref={codePanel} tabIndex={-1} data-testid="room-code-panel" className="outline-none">
              <p className="text-sm font-bold">Your room code</p>
              {/* Read as a word, "QRST" is nonsense: a screen reader gets the
                  letters. From a block of their own, so that a double-click on
                  the code selects the four letters and nothing else. */}
              <p data-testid="room-code" aria-hidden="true" className="font-display text-6xl tracking-[0.3em]">
                {roomCode}
              </p>
              <p className="sr-only">{spelledOut(roomCode)}</p>
            </div>
          </SkewPanel>
        ) : null}

        {!busy ? (
          <>
            <SkewButton
              ref={createButton}
              onClick={() => {
                setFormError(null);
                setTried("create");
                void connect(makeRoomCode(), "create", MAX_CREATE_ATTEMPTS - 1);
              }}
              className="self-start border-[4px] border-panel-ink bg-smash-yellow px-8 py-4 text-panel-ink shadow-[0_8px_0_rgb(0_0_0/0.45)] transition-transform hover:-translate-y-1"
              innerClassName="font-display text-2xl tracking-[0.16em] uppercase"
            >
              Create room
            </SkewButton>
            <form onSubmit={join} className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm font-bold text-white/80">
                Room code
                <input
                  ref={codeInput}
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  aria-invalid={codeInvalid || undefined}
                  aria-describedby={codeInvalid && message ? errorId : undefined}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  className="w-40 border-[3px] border-panel-ink bg-white px-3 py-2 font-display text-2xl tracking-[0.3em] text-panel-ink uppercase"
                />
              </label>
              <SkewButton
                ref={joinButton}
                type="submit"
                className="border-[3px] border-panel-ink bg-panel-bone px-6 py-3 text-panel-ink transition-transform hover:-translate-y-1"
                innerClassName="font-display text-lg tracking-[0.14em] uppercase"
              >
                Join room
              </SkewButton>
            </form>
          </>
        ) : null}

        {/* Always mounted: a live region only announces what changes inside one that was already there. */}
        <p role="status" aria-live="polite" className="text-white/80">
          {statusText(status, role, roomCode)}
        </p>

        {message ? (
          <p id={errorId} role="alert" className="text-sm font-bold text-smash-yellow">
            {message}
          </p>
        ) : null}
      </div>
    </main>
  );
}

/** What the status line says at each step of the handshake; nothing when there is nothing going on. */
function statusText(status: OnlineStatus, role: Role | null, roomCode: string | null): string {
  switch (status) {
    case "waiting":
      return role === "host" ? "Read it to the other player. Waiting for them to join…" : connecting(roomCode);
    case "linking":
      return role === "host" ? "They are in. Opening a direct connection…" : "Opening a direct connection…";
    case "connecting":
    case "connected":
      return connecting(roomCode);
    case "idle":
    case "error":
      return "";
  }
}

function connecting(roomCode: string | null): string {
  return `Connecting to room ${roomCode ?? ""}…`;
}

/** "QRST" as "Q R S T". */
function spelledOut(roomCode: string | null): string {
  return (roomCode ?? "").split("").join(" ");
}
