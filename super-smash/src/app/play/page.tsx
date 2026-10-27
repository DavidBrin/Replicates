"use client";

/**
 * The match itself.
 *
 * A canvas, a loop, and as little React as possible. Everything that changes at
 * 60Hz lives inside `createMatchRunner` and is painted directly; React is only
 * responsible for the things that change once a match — the countdown, the
 * pause overlay, the hand-off to the results screen. Re-rendering a component
 * tree sixty times a second to move a fighter would be the single easiest way
 * to lose frames here, so the game state deliberately never enters React state.
 *
 * Two ways in. Locally, the match is whatever the menus put in the match
 * config. Online, it is the host's start config, played through the active
 * session's transport with a rollback session; that is decided once, at
 * mount, because leaving an online match resets the very stores a local match
 * would otherwise restart from.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { MatchOutcome, MatchRules, StageDef } from "@/engine/types";
import { toFloat } from "@/engine/fixed";
import {
  createMatchRunner,
  type MatchRunner,
  type NetplayOptions,
  type PlayerSlot as RunnerSlot,
} from "@/game/matchRunner";
import { bootstrapEngine, getFighterOrThrow, resolveFighterId, resolveMatchStage, schemeForMenuId } from "@/game/bootstrap";
import { startLinkMonitor } from "@/game/linkMonitor";
import { runnerSlotsFor } from "@/game/onlineConfig";
import { createKeyboardInput, type KeyboardInput } from "@/input/keyboard";
import { createGamepadInput, padPortMap, type GamepadInput } from "@/input/gamepad";
import { AudioEngine } from "@/audio";
import { conflictFreeSelection } from "@/input/schemes";
import { useMatchConfig, type MatchResult, type PlayerResultStat, type PlayerSlot } from "@/lib/matchConfig";
import { leaveOnline, useOnlineStore } from "@/lib/onlineStore";
import { NetHud } from "@/components/match/NetHud";
import { ONLINE_RESULT_LINGER_MS } from "@/components/menu/Results";
import type { OnlineMatchConfig } from "@/net/online/lobby";
import { getActiveSession, type OnlineSessionLike } from "@/net/online/session";
import type { LinkHealth } from "@/net/online/watchdog";
import type { NetStats } from "@/net/rollback";
import { INTERNAL_HEIGHT, INTERNAL_WIDTH } from "@/render/renderer";
import { worldToScreen } from "@/render/camera";

/**
 * Who gets credit for a kill.
 *
 * `StepEvents.kos` reports who died, not who did it — the simulation has no
 * reason to care, since a stock is a stock. The results screen does care, so
 * the attribution is done here, in the presentation layer, the way the real
 * game does it: whoever last landed a hit on you owns your death, and if nobody
 * has touched you recently, you walked off the stage yourself.
 *
 * Three seconds, because that is Ultimate's own rule — a KO only counts as a
 * self-destruct if no opponent has hit you within the last three minutes of
 * game time in their scoring, but for a single stock the practical window that
 * feels right is much shorter. Anything longer and a fighter who was hit once
 * at the start of the stock and then dived into the blast zone reads as a kill.
 */
const KILL_CREDIT_FRAMES = 180;

/** Let the KO play out before cutting away — the freeze and the blast are the payoff for the whole match. */
const RESULT_DELAY_MS = 2400;

/** How often the HUD's ping, delay and rollback numbers refresh. */
const NET_STATS_MS = 250;

interface StatTracker {
  readonly kos: number[];
  readonly falls: number[];
  readonly sds: number[];
  readonly lastHitBy: number[];
  readonly lastHitFrame: number[];
}

function createTracker(count: number): StatTracker {
  return {
    kos: new Array(count).fill(0),
    falls: new Array(count).fill(0),
    sds: new Array(count).fill(0),
    lastHitBy: new Array(count).fill(-1),
    lastHitFrame: new Array(count).fill(-99999),
  };
}

function toRunnerSlots(players: readonly PlayerSlot[], seed: number): RunnerSlot[] {
  return players.map((p) => ({
    selection: {
      defId: resolveFighterId(p.fighterId, seed, p.port),
      costume: p.costume,
    },
    cpuLevel: p.kind === "cpu" ? p.cpuLevel : null,
    label: p.kind === "cpu" ? `CPU` : `P${p.port + 1}`,
  }));
}

/** Everything an online match needs, captured once when the page mounts. */
interface OnlineMount {
  readonly config: OnlineMatchConfig;
  readonly session: OnlineSessionLike;
  /** From the room's role: the host is port 0 and the guest port 1. */
  readonly localPort: number;
}

function onlineAtMount(): OnlineMount | null {
  const config = useOnlineStore.getState().config;
  const session = getActiveSession();
  const localPort = session?.localPort ?? null;
  return config && session && localPort !== null ? { config, session, localPort } : null;
}

interface MountArgs {
  readonly canvas: HTMLCanvasElement;
  readonly slots: RunnerSlot[];
  readonly ports: readonly number[];
  readonly stage: StageDef;
  readonly rules: MatchRules;
  readonly seed: number;
  readonly keyboard: KeyboardInput | null;
  readonly gamepad: GamepadInput | null;
  readonly net: NetplayOptions | null;
  readonly onResult: (result: MatchResult) => void;
}

interface Mounted {
  readonly runner: MatchRunner;
  dispose(): void;
}

/**
 * The runner and everything that hangs off it — sound, kill credit, the e2e
 * debug handles — built the same way for a local and an online match.
 */
function mountMatch(args: MountArgs): Mounted {
  const { canvas, slots, ports } = args;

  // Every sound in the game is synthesised on demand, so there is nothing
  // to preload and no reason to build the context before it can be heard.
  // Autoplay policy suspends an AudioContext created outside a gesture, and
  // arriving here from the character-select screen means the player has
  // already clicked — but a deep link or a reload has not, so the unlock
  // stays armed until the first key or click either way.
  //
  // Wrapped separately from the match: a browser with no Web Audio, or one
  // that refuses to build a context, should cost the player their sound and
  // nothing else.
  let audio: AudioEngine | null = null;
  let releaseAudioGesture: (() => void) | null = null;
  try {
    audio = new AudioEngine();
    releaseAudioGesture = audio.unlockOnGesture();
    void audio.resume().catch(() => {});
  } catch {
    audio = null;
  }

  const tracker = createTracker(slots.length);
  const runner = createMatchRunner({
    stage: args.stage,
    players: slots,
    rules: args.rules,
    seed: args.seed,
    getFighter: getFighterOrThrow,
    keyboard: args.keyboard,
    gamepad: args.gamepad,
    net: args.net,
    audio,
    onFrame: (state, events) => {
      // The canvas is opaque to an end-to-end test, so the frame counter is
      // published deliberately: it is the one honest signal that the
      // simulation is advancing.
      (window as unknown as { __smashFrame?: number }).__smashFrame = state.frame;

      for (const hit of events.hits) {
        if (hit.attacker === hit.victim) continue;
        tracker.lastHitBy[hit.victim] = hit.attacker;
        tracker.lastHitFrame[hit.victim] = state.frame;
      }
      for (const ko of events.kos) {
        tracker.falls[ko.port] += 1;
        const killer = tracker.lastHitBy[ko.port];
        const recent = state.frame - tracker.lastHitFrame[ko.port] <= KILL_CREDIT_FRAMES;
        if (killer >= 0 && recent) tracker.kos[killer] += 1;
        else tracker.sds[ko.port] += 1;
        tracker.lastHitBy[ko.port] = -1;
      }
    },
    onEnd: (outcome: MatchOutcome) => {
      const stats: PlayerResultStat[] = ports.map((port) => ({
        port,
        kos: tracker.kos[port] ?? 0,
        falls: tracker.falls[port] ?? 0,
        sds: tracker.sds[port] ?? 0,
      }));
      args.onResult({
        kind: outcome.kind,
        placings: outcome.placings,
        stats,
        fighters: Object.fromEntries(slots.map((s, i) => [ports[i], s.selection.defId])),
        ...(args.net ? { online: true } : {}),
      });
    },
  });

  // How an end-to-end test sees the simulation. Accessors rather than a
  // per-frame snapshot: publishing a fresh object 60 times a second would put
  // real garbage on the hot loop to serve a test that reads it twice.
  (window as unknown as { __smashDebug?: unknown }).__smashDebug = {
    get frame() {
      return runner.frame;
    },
    get stageId() {
      return runner.state.stageId;
    },
    // Hand-cranking the loop, for looking at a single frame (D46).
    pause: () => runner.stop(),
    resume: () => runner.start(canvas),
    step: (n = 1) => runner.advance(n),
    screenPositions: () =>
      runner.state.fighters.map((f) => {
        const p = worldToScreen(runner.camera, toFloat(f.x), toFloat(f.y));
        return { port: f.port, x: p.x / INTERNAL_WIDTH, y: p.y / INTERNAL_HEIGHT };
      }),
    moveFrames: () =>
      runner.state.fighters.map((f) => {
        const def = f.move ? getFighterOrThrow(f.defId) : null;
        return { port: f.port, move: f.move, total: (f.move && def?.moves[f.move]?.totalFrames) ?? 0 };
      }),
    fighters: () =>
      runner.state.fighters.map((f) => ({
        port: f.port,
        x: toFloat(f.x),
        y: toFloat(f.y),
        action: f.action,
        actionFrame: f.actionFrame,
        move: f.move,
        damage: toFloat(f.damage),
        stocks: f.stocks,
        facing: f.facing,
        intangible: f.intangible,
        hitstun: f.hitstun,
      })),
  };

  const mounted: Mounted = {
    runner,
    dispose() {
      runner.dispose();
      releaseAudioGesture?.();
      // Disposed, not just silenced: browsers cap how many AudioContexts a
      // page may hold, and leaking one per match eventually mutes the game.
      audio?.dispose();
      delete (window as unknown as { __smashDebug?: unknown }).__smashDebug;
    },
  };
  try {
    runner.start(canvas);
  } catch (e) {
    mounted.dispose();
    throw e;
  }
  return mounted;
}

export default function PlayPage() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runnerRef = useRef<MatchRunner | null>(null);
  const keyboardRef = useRef<KeyboardInput | null>(null);

  const players = useMatchConfig((s) => s.players);
  const stageId = useMatchConfig((s) => s.stageId);
  const stageForm = useMatchConfig((s) => s.stageForm);
  const rules = useMatchConfig((s) => s.rules);
  const bindings = useMatchConfig((s) => s.bindings);
  const setResult = useMatchConfig((s) => s.setResult);

  const [online] = useState(onlineAtMount);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [netStats, setNetStats] = useState<NetStats | null>(null);
  const [linkHealth, setLinkHealth] = useState<LinkHealth>("ok");
  const [peerAway, setPeerAway] = useState(false);

  const quit = useCallback(() => {
    runnerRef.current?.dispose();
    keyboardRef.current?.detach();
    router.push("/menu");
    if (online) leaveOnline();
  }, [online, router]);

  /* ------------------------------------------------------------ local match -- */

  useEffect(() => {
    if (online) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let mounted: Mounted | null = null;
    let keyboard: KeyboardInput | null = null;
    let gamepad: GamepadInput | null = null;
    let resultTimer = 0;

    try {
      bootstrapEngine();
      // A fixed seed per mount rather than a random one: the whole simulation is
      // reproducible from it, which is what makes a desync report actionable.
      const seed = 0x5eed1e55;
      // Random is a menu token, not a stage. Resolve it — and fold in the form —
      // before the engine ever sees the id, or it throws `Unknown stage "random"`.
      const stage = resolveMatchStage(stageId, stageForm, (seed ^ ((Math.random() * 0x7fffffff) | 0)) | 0);
      const slots = toRunnerSlots(players, seed);

      const humans = players.filter((p) => p.kind === "human");
      if (humans.length > 0) {
        // `conflictFreeSelection` stops two people picking mirror-image presets
        // that share physical keys (DECISIONS D8), with the player's own
        // rebinding applied (D33). Paired back to owners by membership, not by
        // index: it drops rejected entries.
        const requested = humans.map((p) => ({
          port: p.port,
          scheme: schemeForMenuId(p.scheme, bindings[p.scheme]),
        }));
        const chosen = conflictFreeSelection(requested.map((r) => r.scheme));
        const kept = new Set(chosen.active);
        keyboard = createKeyboardInput(requested.filter((r) => kept.has(r.scheme)));
        // Constructing the reader binds no listeners; without this, `drain()`
        // truthfully reports "nothing held" forever (D29).
        keyboard.attach();
        keyboardRef.current = keyboard;
        // One pad per human, in connection order: the first pad is the first
        // human. Held for the match, so a pad unplugging moves nobody else's.
        gamepad = createGamepadInput({ portForPad: padPortMap(humans.map((p) => p.port)), holdPorts: true });
        gamepad.attach();
      }

      mounted = mountMatch({
        canvas,
        slots,
        ports: players.map((p) => p.port),
        stage,
        rules,
        seed,
        keyboard,
        gamepad,
        net: null,
        onResult: (result) => {
          setResult(result);
          resultTimer = window.setTimeout(() => router.push("/results"), RESULT_DELAY_MS);
        },
      });
      runnerRef.current = mounted.runner;
    } catch (e) {
      // Deferred out of the effect body: setting state synchronously here
      // cascades a second render before the first has committed.
      const message = e instanceof Error ? e.message : String(e);
      queueMicrotask(() => setError(message));
    }

    return () => {
      // Quitting during the KO's play-out must not be followed by the results.
      window.clearTimeout(resultTimer);
      mounted?.dispose();
      keyboard?.detach();
      gamepad?.detach();
      runnerRef.current = null;
      keyboardRef.current = null;
    };
  }, [online, players, stageId, stageForm, rules, bindings, router, setResult]);

  /* ----------------------------------------------------------- online match -- */

  useEffect(() => {
    if (!online) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { config, session, localPort } = online;

    let mounted: Mounted | null = null;
    let stopMonitor: (() => void) | null = null;
    let statsTimer = 0;
    let resultTimer = 0;
    let finished = false;
    // Each player is on their own machine, so each gets Config 1 (with their
    // own rebinding) and every pad, on their own port.
    const keyboard = createKeyboardInput([{ port: localPort, scheme: schemeForMenuId("arrows", bindings.arrows) }]);
    const gamepad = createGamepadInput({ portForPad: () => localPort });

    const finish = (result: MatchResult, delayMs: number) => {
      if (finished) return;
      finished = true;
      stopMonitor?.();
      setResult(result);
      // The room is the results screen's to leave: at once after a lost
      // connection, after a short grace otherwise (Results.tsx), during which
      // the runner keeps this side's last inputs going out (`lingerMs`).
      resultTimer = window.setTimeout(() => router.push("/results"), delayMs);
    };

    try {
      bootstrapEngine();
      keyboard.attach();
      keyboardRef.current = keyboard;
      gamepad.attach();
      // Built from the host's start config alone, never from this machine's
      // seats: the two peers must start from the identical state.
      mounted = mountMatch({
        canvas,
        slots: runnerSlotsFor(config),
        ports: [0, 1],
        stage: resolveMatchStage(config.stageId, config.stageForm, config.seed),
        rules: config.rules,
        seed: config.seed,
        keyboard,
        gamepad,
        net: {
          transport: session.transport,
          localPorts: [localPort],
          lingerMs: ONLINE_RESULT_LINGER_MS,
          isOpen: () => session.transport.status === "open",
          onDesync: (report) => console.warn("David-Smash: desync", report),
        },
        onResult: (result) => finish(result, RESULT_DELAY_MS),
      });
      const runner = mounted.runner;
      runnerRef.current = runner;
      stopMonitor = startLinkMonitor({
        transport: session.transport,
        session,
        onHealth: (health, away) => {
          setLinkHealth(health);
          setPeerAway(away);
        },
        onLost: () => {
          runner.stop();
          finish(
            {
              kind: "connectionLost",
              placings: [],
              stats: [],
              fighters: { 0: config.fighters[0], 1: config.fighters[1] },
              online: true,
            },
            0,
          );
        },
      });
      statsTimer = window.setInterval(() => setNetStats(runner.netStats), NET_STATS_MS);
      (window as unknown as { __smashNet?: unknown }).__smashNet = {
        stats: () => runner.netStats,
        localPort,
        turn: session.turn,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      queueMicrotask(() => setError(message));
    }

    return () => {
      window.clearInterval(statsTimer);
      window.clearTimeout(resultTimer);
      stopMonitor?.();
      mounted?.dispose();
      keyboard.detach();
      gamepad.detach();
      runnerRef.current = null;
      keyboardRef.current = null;
      delete (window as unknown as { __smashNet?: unknown }).__smashNet;
    };
  }, [online, bindings, router, setResult]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code !== "Escape") return;
      setPaused((p) => {
        const next = !p;
        // An online match cannot pause — the other player's game would stall
        // behind this one — so Esc only brings up the way out.
        if (!online) {
          const canvas = canvasRef.current;
          if (next) runnerRef.current?.stop();
          else if (canvas) runnerRef.current?.start(canvas);
        }
        return next;
      });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [online]);

  return (
    <main className="relative flex h-dvh w-full items-center justify-center bg-black">
      <canvas
        ref={canvasRef}
        width={INTERNAL_WIDTH}
        height={INTERNAL_HEIGHT}
        aria-label="Match"
        className="h-full w-full"
      />

      {online && !error ? <NetHud stats={netStats} health={linkHealth} peerAway={peerAway} /> : null}

      {error && (
        <div
          role="alert"
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 p-8 text-center"
        >
          <p className="font-display text-3xl text-smash-yellow">THE MATCH COULD NOT START</p>
          <p className="max-w-lg font-menu text-sm text-white/80">{error}</p>
          <button
            onClick={quit}
            className="mt-2 skew-x-[-12deg] bg-smash-red px-6 py-2 font-display text-xl text-white"
          >
            <span className="inline-block skew-x-[12deg]">BACK TO MENU</span>
          </button>
        </div>
      )}

      {paused && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/70">
          <p className="font-display text-5xl tracking-widest text-white">{online ? "MENU" : "PAUSED"}</p>
          <p className="font-menu text-sm text-white/70">
            {online ? "The match keeps running · Esc to return" : "Esc to resume"}
          </p>
          <button
            onClick={quit}
            className="skew-x-[-12deg] bg-smash-red px-6 py-2 font-display text-xl text-white"
          >
            <span className="inline-block skew-x-[12deg]">{online ? "LEAVE MATCH" : "QUIT MATCH"}</span>
          </button>
        </div>
      )}
    </main>
  );
}
