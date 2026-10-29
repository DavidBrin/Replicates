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
 *
 * The world is drawn in 3D (Plan 4): three stacked canvases inside the
 * `aria-label="Match"` element — the stage's sky, the WebGL world, and the 2D
 * overlay with the HUD and every effect. A match mounts once the bake is
 * installed and the 3D code (its own chunk, `useWorld3d`) has loaded, and its
 * clock starts once every fighter has a model or a stand-in.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { BakeTables } from "@/engine/acmd/bakeTables";
import type { MatchOutcome, MatchRules, StageDef } from "@/engine/types";
import { toFloat } from "@/engine/fixed";
import {
  createMatchRunner,
  type MatchRunner,
  type NetplayOptions,
  type PlayerSlot as RunnerSlot,
} from "@/game/matchRunner";
import { bootstrapEngine, resolveFighterId, resolveMatchStage, schemeForMenuId } from "@/game/bootstrap";
import { startLinkMonitor } from "@/game/linkMonitor";
import { runnerSlotsFor } from "@/game/onlineConfig";
import { GAME_SIM_CONTEXT } from "@/game/simContext";
import { useBake } from "@/game/useBake";
import { useWorld3d, type World3dModule } from "@/game/useWorld3d";
// Types only: the module itself (and three.js) arrives through `useWorld3d`'s `import()`.
import type { WorldLayers } from "@/game/world3d";
import type { Presenter3D } from "@/render3d/renderer3d";
import { createKeyboardInput, type KeyboardInput } from "@/input/keyboard";
import { createGamepadInput, padPortMap, type GamepadInput } from "@/input/gamepad";
import { AudioEngine } from "@/audio";
import { conflictFreeSelection } from "@/input/schemes";
import { useMatchConfig, type MatchResult, type PlayerResultStat, type PlayerSlot } from "@/lib/matchConfig";
import { ONLINE_RESULT_LINGER_MS, leaveOnline, roomErrorMessage, useOnlineStore } from "@/lib/onlineStore";
import { NetHud } from "@/components/match/NetHud";
import type { OnlineMatchConfig, RefuseReason } from "@/net/online/lobby";
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

/**
 * Online, the longest a match waits for its fighters' models before playing the
 * rest as stand-ins (ruling R3). The peer whose models came first stands at its
 * prediction cap until this one starts, and its link monitor calls the match
 * lost after `STALL_LOST_MS` (10 s) without a confirmed frame: half that leaves
 * room for the two starts landing apart. A local match waits on the loader's
 * own timeouts instead (`MODEL_TIMEOUT_MS` per request).
 */
const ONLINE_MODEL_WAIT_MS = 5_000;

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

/**
 * The leave an online match's unmount scheduled, not yet run.
 *
 * Leaving /play any way but to the results (browser Back, a swipe) abandons
 * the match, and the room with it. But React's development mode unmounts and
 * remounts every effect once on the way in, and that must not end a match
 * before it starts. So the unmount leaves a moment later, and a remount in the
 * same task finds this and cancels it. Module-level so the remount can.
 */
let pendingLeave: ReturnType<typeof setTimeout> | null = null;

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
  /** The WebGL and background canvases under `canvas` (Plan 4). */
  readonly layers: WorldLayers;
  readonly bake: BakeTables;
  /** `world3d.ts`, loaded by `useWorld3d` (three.js in its own chunk). */
  readonly world: World3dModule;
  /** The longest the match waits for models (online, ruling R3); absent, the loader's own timeouts. */
  readonly modelWaitMs?: number;
  /** Every fighter has a model or a stand-in; the match has started. */
  readonly onReady: () => void;
  readonly onError: (message: string) => void;
}

/**
 * What holds a match's clock: the pause menu, a test or `fightsheet.mjs`
 * hand-cranking it (`__smashDebug.pause`), or the match being over before it
 * could start (refused, abandoned).
 */
type Hold = "menu" | "debug" | "over";

interface Mounted {
  readonly runner: MatchRunner;
  /** Hold the clock for `reason`, or let it go; it runs once the fighters are ready and nothing holds it. */
  hold(reason: Hold, held: boolean): void;
  dispose(): void;
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * The runner and everything that hangs off it — sound, kill credit, the e2e
 * debug handles — built the same way for a local and an online match.
 */
function mountMatch(args: MountArgs): Mounted {
  const { canvas, slots, ports } = args;

  // The 3D world under the overlay (Plan 4), drawing the game's fighters — the
  // same defs, limb-bone scripts and all, that the sim steps. First, so a page
  // that cannot draw it (no WebGL) has nothing else to release.
  const presenter: Presenter3D = args.world.createWorld(
    args.layers,
    args.stage,
    slots.map((s) => GAME_SIM_CONTEXT.fighter(s.selection.defId)),
    args.bake,
    args.modelWaitMs === undefined ? {} : { modelWaitMs: args.modelWaitMs },
  );
  let stopFollowing: () => void;
  try {
    stopFollowing = args.world.followSize(args.layers.gl, presenter);
  } catch (e) {
    presenter.dispose();
    throw e;
  }

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

  // Released with the match, or straight away if the runner cannot be built:
  // the context and the gesture listener would otherwise outlive the page.
  const releaseAudio = () => {
    releaseAudioGesture?.();
    // Disposed, not just silenced: browsers cap how many AudioContexts a
    // page may hold, and leaking one per match eventually mutes the game.
    audio?.dispose();
  };

  const tracker = createTracker(slots.length);
  let runner: MatchRunner;
  try {
    runner = createMatchRunner({
      stage: args.stage,
      players: slots,
      rules: args.rules,
      seed: args.seed,
      // The game's fighters, as the 3D world draws them: limb-bone scripts and all.
      getFighter: (id) => GAME_SIM_CONTEXT.fighter(id),
      keyboard: args.keyboard,
      gamepad: args.gamepad,
      net: args.net,
      audio,
      presenter,
      background: args.layers.background,
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
          rules: args.rules,
          ...(args.net ? { online: true } : {}),
        });
      },
    });
  } catch (e) {
    releaseAudio();
    stopFollowing();
    presenter.dispose();
    throw e;
  }

  let disposed = false;
  /** Every fighter has a model or a stand-in, and the runner has its canvas. */
  let ready = false;
  let ticking = false;
  const holds = new Set<Hold>();
  /**
   * Run the clock exactly when the fighters are ready and nothing holds it. A
   * hold placed while the models load is kept: the match must not start behind
   * the pause menu, nor start ticking under a test that has already taken the
   * clock (DISPATCH-NOTES 20.4).
   */
  const syncClock = () => {
    if (disposed || !ready) return;
    const run = holds.size === 0;
    if (run === ticking) return;
    ticking = run;
    if (run) runner.start(canvas);
    else runner.stop();
  };
  const hold = (reason: Hold, held: boolean) => {
    if (held) holds.add(reason);
    else holds.delete(reason);
    syncClock();
  };

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
    // Hand-cranking the loop, for looking at a single frame (D46). A pause
    // taken while the fighters load holds: the match never starts its own
    // clock under a test's steps.
    pause: () => hold("debug", true),
    resume: () => hold("debug", false),
    step: (n = 1) => runner.advance(n),
    screenPositions: () =>
      runner.state.fighters.map((f) => {
        const p = worldToScreen(runner.camera, toFloat(f.x), toFloat(f.y));
        return { port: f.port, x: p.x / INTERNAL_WIDTH, y: p.y / INTERNAL_HEIGHT };
      }),
    moveFrames: () =>
      runner.state.fighters.map((f) => {
        // The game's def: a limb slot's length is its script's, not the legacy table's.
        const def = f.move ? GAME_SIM_CONTEXT.fighter(f.defId) : null;
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

  // What the 3D layer is doing, for e2e (Plan 4): draw calls, triangles, buffer, lost context, models.
  (window as unknown as { __smashRender?: unknown }).__smashRender = { info: () => presenter.info() };

  const mounted: Mounted = {
    runner,
    hold,
    dispose() {
      // Once: a start that failed disposes here, and the page's cleanup comes later.
      if (disposed) return;
      disposed = true;
      stopFollowing();
      // Frees the presenter too (`MatchRunner.dispose`).
      runner.dispose();
      releaseAudio();
      delete (window as unknown as { __smashDebug?: unknown }).__smashDebug;
      delete (window as unknown as { __smashRender?: unknown }).__smashRender;
    },
  };
  const failed = (e: unknown) => {
    if (disposed) return;
    mounted.dispose();
    args.onError(messageOf(e));
  };

  // The match starts once every fighter has its model or a stand-in, so nobody
  // plays the first second against an invisible opponent. Locally that can take
  // the loader's whole timeout twice over (the index, then the glb); it always
  // ends, in a model or a stand-in. A fighter that cannot be drawn at all is an
  // error the page shows, not a match that never starts.
  void presenter.ready.then(() => {
    if (disposed) return;
    ready = true;
    args.onReady();
    try {
      // Started even when a hold is in: that is what hands the runner its
      // canvas, so a held match still paints the frames a test steps. A hold
      // stops it again before it has run a frame.
      runner.start(canvas);
      ticking = true;
      syncClock();
      if (!ticking) runner.redraw();
    } catch (e) {
      failed(e);
    }
  }, failed);
  return mounted;
}

export default function PlayPage() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const glRef = useRef<HTMLCanvasElement | null>(null);
  const bgRef = useRef<HTMLCanvasElement | null>(null);
  const runnerRef = useRef<MatchRunner | null>(null);
  const mountedRef = useRef<Mounted | null>(null);
  const keyboardRef = useRef<KeyboardInput | null>(null);
  const bake = useBake();
  const { world, error: worldError } = useWorld3d();

  const players = useMatchConfig((s) => s.players);
  const stageId = useMatchConfig((s) => s.stageId);
  const stageForm = useMatchConfig((s) => s.stageForm);
  const rules = useMatchConfig((s) => s.rules);
  const bindings = useMatchConfig((s) => s.bindings);
  const setResult = useMatchConfig((s) => s.setResult);

  const [online] = useState(onlineAtMount);
  // Seated for an online match with none to play: the start was withdrawn
  // (the opponent left) before this page mounted. The seats are two humans on
  // one keyboard, not a local match, so this goes back to where the room is.
  const [stranded] = useState(() => online === null && useMatchConfig.getState().online);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [netStats, setNetStats] = useState<NetStats | null>(null);
  const [linkHealth, setLinkHealth] = useState<LinkHealth>("ok");
  const [peerAway, setPeerAway] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [loading, setLoading] = useState(true);
  // A bake that fails its digest says "…does not match this version of the game. Reload the page."
  const shownError = error ?? bake.error ?? worldError;

  /** Cancels the hand-off to the results screen while it waits out the KO's play-out. */
  const cancelResultRef = useRef<(() => void) | null>(null);

  const quit = useCallback(() => {
    // Leaving during the play-out must not be followed by the results.
    cancelResultRef.current?.();
    runnerRef.current?.dispose();
    keyboardRef.current?.detach();
    router.push("/menu");
    if (online) leaveOnline();
  }, [online, router]);

  useEffect(() => {
    if (!stranded) return;
    const session = getActiveSession();
    if (session === null) {
      // No room left to go back to: start again from the lobby.
      leaveOnline();
      router.replace("/online");
      return;
    }
    // The room stays open to pair again. The select screens say why it is
    // waiting (`error ?? notice`) and hold Ready until it is connected.
    router.replace(session.role === "host" ? "/stage" : "/fighters");
  }, [stranded, router]);

  /* ------------------------------------------------------------ local match -- */

  useEffect(() => {
    if (online || stranded) return;
    const canvas = canvasRef.current;
    const gl = glRef.current;
    const background = bgRef.current;
    if (!canvas || !gl || !background || bake.tables === null || world === null) return;
    const tables = bake.tables;

    let mounted: Mounted | null = null;
    let keyboard: KeyboardInput | null = null;
    let gamepad: GamepadInput | null = null;
    let resultTimer = 0;
    cancelResultRef.current = () => window.clearTimeout(resultTimer);

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
        layers: { gl, background },
        bake: tables,
        world,
        onReady: () => setLoading(false),
        onError: (message) => setError(message),
      });
      runnerRef.current = mounted.runner;
      mountedRef.current = mounted;
    } catch (e) {
      // Deferred out of the effect body: setting state synchronously here
      // cascades a second render before the first has committed.
      const message = e instanceof Error ? e.message : String(e);
      queueMicrotask(() => setError(message));
    }

    return () => {
      // Leaving during the KO's play-out must not be followed by the results.
      window.clearTimeout(resultTimer);
      cancelResultRef.current = null;
      mounted?.dispose();
      keyboard?.detach();
      gamepad?.detach();
      runnerRef.current = null;
      mountedRef.current = null;
      keyboardRef.current = null;
    };
  }, [online, stranded, players, stageId, stageForm, rules, bindings, router, setResult, bake.tables, world]);

  /* ----------------------------------------------------------- online match -- */

  useEffect(() => {
    if (!online) return;
    const { config, session, localPort } = online;
    // The room went wrong between this page's render and now — the guest
    // refused this start (another build), or the room failed — and the store
    // has withdrawn the start and says why, for good. Leaving would wipe that,
    // and so would a leave still pending from a remount: back to where the
    // room is instead, as when stranded.
    if (getActiveSession() === session && useOnlineStore.getState().errorReason !== null) {
      if (pendingLeave !== null) clearTimeout(pendingLeave);
      pendingLeave = null;
      router.replace(session.role === "host" ? "/stage" : "/fighters");
      return;
    }
    // React's development remount: the unmount just undone withdrew the start
    // and scheduled a leave, but this is the same match, so neither stands.
    if (pendingLeave !== null) {
      clearTimeout(pendingLeave);
      pendingLeave = null;
      useOnlineStore.getState().patch({ config });
    }
    // The match this page read while rendering is over: browser Back from the
    // results within their grace, whose unmount withdraws the start in this
    // same commit and leaves the room a moment later. A match built now would
    // run on a closing transport, frozen until the link monitor called it
    // lost, so start again instead.
    if (getActiveSession() !== session || useOnlineStore.getState().config !== config) {
      leaveOnline();
      router.replace("/online");
      return;
    }
    const canvas = canvasRef.current;
    const gl = glRef.current;
    const background = bgRef.current;
    if (!canvas || !gl || !background || bake.tables === null || world === null) return;
    const tables = bake.tables;

    let mounted: Mounted | null = null;
    let stopMonitor: (() => void) | null = null;
    let statsTimer = 0;
    let resultTimer = 0;
    cancelResultRef.current = () => window.clearTimeout(resultTimer);
    let finished = false;
    /** The result has gone to the results screen, and the room with it. */
    let handedOff = false;
    /**
     * The match cannot finish: nobody wins, and the results say why at once.
     * After a desync the runner lingers on disposal, re-sending the hash that
     * showed it, so the other side finds the same desync. A match that already
     * ended here is left to its play-out and its input linger: its result is
     * final.
     */
    const abandon = (kind: "connectionLost" | "desync") => {
      if (finished) return;
      mounted?.hold("over", true);
      finish(
        {
          kind,
          placings: [],
          stats: [],
          fighters: { 0: config.fighters[0], 1: config.fighters[1] },
          rules: config.rules,
          online: true,
        },
        0,
      );
    };
    /**
     * The guest could not play this host's start: it runs another build (Plan
     * 2 Task 27), or could not read the start (the same build's, but
     * malformed). Nothing was played, so there are no results either: the
     * match stops, and the overlay says why; its way out leaves the room.
     */
    const refused = (reason: RefuseReason) => {
      if (finished) return;
      finished = true;
      stopMonitor?.();
      mounted?.hold("over", true);
      setError(roomErrorMessage(reason, session.roomCode));
    };
    const offRefusal = session.on((event) => {
      if (event.type === "lobby" && event.message.kind === "refuse" && session.role === "host") refused(event.message.reason);
    });
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
      resultTimer = window.setTimeout(() => {
        handedOff = true;
        router.push("/results");
      }, delayMs);
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
          // The two machines' confirmed states differ: they are no longer
          // playing the same match, so neither may crown anyone. The report
          // stays in the console for diagnosis.
          onDesync: (report) => {
            console.warn("David-Smash: desync", report);
            abandon("desync");
          },
        },
        onResult: (result) => finish(result, RESULT_DELAY_MS),
        layers: { gl, background },
        bake: tables,
        world,
        modelWaitMs: ONLINE_MODEL_WAIT_MS,
        onReady: () => {
          setLoading(false);
          // Watched from its start, not from mount (ruling R3): a model still
          // loading is not a stalled link. Nothing to watch once it is over.
          if (finished) return;
          stopMonitor = startLinkMonitor({
            transport: session.transport,
            session,
            // A match stuck with packets still arriving is lost too.
            confirmedFrame: () => runner.netStats?.confirmedFrame ?? -1,
            onHealth: (health, away) => {
              setLinkHealth(health);
              setPeerAway(away);
            },
            onLost: () => abandon("connectionLost"),
          });
        },
        onError: (message) => setError(message),
      });
      const runner = mounted.runner;
      runnerRef.current = runner;
      statsTimer = window.setInterval(() => {
        setNetStats(runner.netStats);
        // Sampled with the numbers: the HUD times the stall itself.
        setStalled(runner.stalled);
      }, NET_STATS_MS);
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
      offRefusal();
      window.clearInterval(statsTimer);
      window.clearTimeout(resultTimer);
      cancelResultRef.current = null;
      stopMonitor?.();
      mounted?.dispose();
      keyboard.detach();
      gamepad.detach();
      runnerRef.current = null;
      keyboardRef.current = null;
      delete (window as unknown as { __smashNet?: unknown }).__smashNet;
      if (!handedOff) {
        // Gone some other way than to the results (browser Back, a swipe): the
        // match is abandoned, and the room with it. The start is withdrawn
        // now, or the guest's character select, mounting in this same commit,
        // would follow it straight back here; the room is left a moment later
        // (see `pendingLeave`), and only if it is still this match's.
        useOnlineStore.getState().patch({ config: null });
        pendingLeave = setTimeout(() => {
          pendingLeave = null;
          if (getActiveSession() === session) leaveOnline();
        }, 0);
      }
    };
  }, [online, bindings, router, setResult, bake.tables, world]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code !== "Escape") return;
      setPaused((p) => {
        const next = !p;
        // An online match cannot pause — the other player's game would stall
        // behind this one — so Esc only brings up the way out.
        // Held rather than stopped: Esc while the fighters load keeps the match from starting behind the menu.
        if (!online) mountedRef.current?.hold("menu", next);
        return next;
      });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [online]);

  return (
    <main className="relative flex h-dvh w-full items-center justify-center bg-black">
      {/* Three layers, one picture: the stage's sky, the 3D world, then the 2D
          overlay (HUD, tags, effects). Each 16:9, stretched to the same box, so
          they line up whatever the window's shape. */}
      <div aria-label="Match" className="relative h-full w-full">
        <canvas ref={bgRef} data-layer="background" width={INTERNAL_WIDTH} height={INTERNAL_HEIGHT} className="absolute inset-0 h-full w-full" />
        <canvas ref={glRef} data-layer="world" className="absolute inset-0 h-full w-full" />
        <canvas ref={canvasRef} data-layer="overlay" width={INTERNAL_WIDTH} height={INTERNAL_HEIGHT} className="absolute inset-0 h-full w-full" />
        {loading && !shownError && (
          <p role="status" className="absolute inset-x-0 bottom-8 text-center font-menu text-sm text-white/70">
            Loading fighters…
          </p>
        )}
      </div>

      {online && !shownError ? <NetHud stats={netStats} health={linkHealth} peerAway={peerAway} stalled={stalled} /> : null}

      {shownError && (
        <div
          role="alert"
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 p-8 text-center"
        >
          <p className="font-display text-3xl text-smash-yellow">THE MATCH COULD NOT START</p>
          <p className="max-w-lg font-menu text-sm text-white/80">{shownError}</p>
          <button
            onClick={quit}
            className="mt-2 skew-x-[-12deg] bg-smash-red px-6 py-2 font-display text-xl text-white"
          >
            <span className="inline-block skew-x-[12deg]">BACK TO MENU</span>
          </button>
        </div>
      )}

      {paused && !shownError && (
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
