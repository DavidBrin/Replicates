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
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { MatchOutcome } from "@/engine/types";
import { toFloat } from "@/engine/fixed";
import { createMatchRunner, type MatchRunner, type PlayerSlot as RunnerSlot } from "@/game/matchRunner";
import { bootstrapEngine, getFighterOrThrow, getStageOrThrow, schemeForMenuId } from "@/game/bootstrap";
import { FIGHTERS } from "@/fighters";
import { createKeyboardInput, type KeyboardInput } from "@/input/keyboard";
import { AudioEngine } from "@/audio";
import { conflictFreeSelection } from "@/input/schemes";
import {
  RANDOM_FIGHTER,
  stageIdForForm,
  useMatchConfig,
  type PlayerResultStat,
  type PlayerSlot,
} from "@/lib/matchConfig";
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

/**
 * Resolve a `?` pick to a real fighter.
 *
 * Seeded from the match seed rather than `Math.random`, because two peers in a
 * netplay match must resolve the same Random to the same fighter — and because
 * a replay of the same seed should produce the same match.
 */
function resolveRandom(fighterId: string | null, seed: number, port: number): string {
  if (fighterId && fighterId !== RANDOM_FIGHTER) return fighterId;
  const mixed = Math.abs(Math.imul(seed ^ (port + 1), 0x9e3779b1)) % FIGHTERS.length;
  return FIGHTERS[mixed].id;
}

function toRunnerSlots(players: readonly PlayerSlot[], seed: number): RunnerSlot[] {
  return players.map((p) => ({
    selection: {
      defId: resolveRandom(p.fighterId, seed, p.port),
      costume: p.costume,
    },
    cpuLevel: p.kind === "cpu" ? p.cpuLevel : null,
    label: p.kind === "cpu" ? `CPU` : `P${p.port + 1}`,
  }));
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

  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const quit = useCallback(() => {
    runnerRef.current?.stop();
    keyboardRef.current?.detach();
    router.push("/menu");
  }, [router]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let runner: MatchRunner | null = null;
    let keyboard: KeyboardInput | null = null;
    let audio: AudioEngine | null = null;
    let releaseAudioGesture: (() => void) | null = null;

    try {
      bootstrapEngine();
      // The menus keep the stage and its form apart, because the stage-select
      // toggle cycles independently of which stage is highlighted. `GameState`
      // has room for exactly one string, so they are composed here — and by the
      // store's own helper rather than by restating the suffix convention, so a
      // change to how forms are named cannot silently desync the two.
      const stage = getStageOrThrow(stageIdForForm(stageId, stageForm));
      // A fixed seed per mount rather than a random one: the whole simulation is
      // reproducible from it, which is what makes a desync report actionable.
      const seed = 0x5eed1e55;
      const slots = toRunnerSlots(players, seed);

      const humans = players.filter((p) => p.kind === "human");
      if (humans.length > 0) {
        // `conflictFreeSelection` is what stops two people picking mirror-image
        // presets that share six physical keys (DECISIONS D8). It hands back a
        // set that provably cannot collide, earlier entries winning.
        // With `bindings`, so a player who rebound their keys plays on the keys
        // they chose. Without it this reads the factory preset and the whole
        // controls screen is decorative.
        const requested = humans.map((p) => ({
          port: p.port,
          scheme: schemeForMenuId(p.scheme, bindings[p.scheme]),
        }));
        const chosen = conflictFreeSelection(requested.map((r) => r.scheme));
        // Paired back to their owners by membership, not by index.
        // `conflictFreeSelection` *drops* rejected entries, so from the first
        // rejection onwards `active[i]` and `humans[i]` are different people:
        // with three humans whose second preset collides, the third player's
        // keys would have driven the second player's fighter.
        const kept = new Set(chosen.active);
        keyboard = createKeyboardInput(requested.filter((r) => kept.has(r.scheme)));
        // Constructing the reader only computes the code→button table; it binds
        // no listeners. Without this call `drain()` answers "nothing is held"
        // truthfully and forever, and every human port plays a match it cannot
        // touch. The cleanup below and `quit()` both already `detach()`, so this
        // is the missing half of a lifecycle the rest of the file assumed.
        keyboard.attach();
        keyboardRef.current = keyboard;
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
      // nothing else. Sharing the outer `catch` would turn that into "THE MATCH
      // COULD NOT START", which is a strictly worse trade.
      try {
        audio = new AudioEngine();
        releaseAudioGesture = audio.unlockOnGesture();
        void audio.resume().catch(() => {});
      } catch {
        audio = null;
      }

      const tracker = createTracker(players.length);

      runner = createMatchRunner({
        stage,
        players: slots,
        rules,
        seed,
        getFighter: getFighterOrThrow,
        keyboard,
        audio,
        onFrame: (state, events) => {
          // The canvas is opaque to an end-to-end test, so the frame counter is
          // published deliberately: it is the one honest signal that the
          // simulation is advancing, and asserting on it beats scraping pixels
          // or trusting a timeout.
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
          const stats: PlayerResultStat[] = players.map((p) => ({
            port: p.port,
            kos: tracker.kos[p.port] ?? 0,
            falls: tracker.falls[p.port] ?? 0,
            sds: tracker.sds[p.port] ?? 0,
          }));
          setResult({
            kind: outcome.kind,
            placings: outcome.placings,
            stats,
            fighters: Object.fromEntries(
              slots.map((s, i) => [players[i].port, s.selection.defId]),
            ),
          });
          // Let the KO play out before cutting away — the freeze and the blast
          // are the payoff for the whole match.
          window.setTimeout(() => router.push("/results"), 2400);
        },
      });
      runnerRef.current = runner;

      // How an end-to-end test sees the simulation. The canvas is opaque, so
      // without this the only assertable signal is "frames are advancing" —
      // which is true of a match nobody can control, and is exactly why a dead
      // keyboard shipped green. Accessors rather than a per-frame snapshot:
      // publishing a fresh object 60 times a second would put real garbage on
      // the hot loop to serve a test that reads it twice.
      const live = runner;
      const liveCanvas = canvas;
      (window as unknown as { __smashDebug?: unknown }).__smashDebug = {
        get frame() {
          return live.frame;
        },
        // Hand-cranking the loop, for looking at a single frame.
        //
        // A screenshot costs about a quarter of a second, which is fifteen
        // simulation frames — so a running match cannot be photographed
        // mid-attack at all, and every animation in the game was being judged
        // from whatever frame the shutter happened to land on. Stopping the
        // clock and stepping by hand is the difference between "the forward
        // smash looks wrong" and knowing which frame of it is wrong.
        //
        // `advance` gathers input the ordinary way, so keys held by the
        // driver are read exactly as a player's would be.
        pause: () => live.stop(),
        resume: () => live.start(liveCanvas),
        step: (n = 1) => live.advance(n),
        // Where each fighter is *on screen*, 0..1 across the match canvas, so a
        // capture can crop around the fighter it is photographing rather than
        // around the middle of the stage. A fighter who spawns near an edge
        // otherwise lands on the crop boundary and is reviewed sixty pixels
        // tall.
        screenPositions: () =>
          live.state.fighters.map((f) => {
            const p = worldToScreen(live.camera, toFloat(f.x), toFloat(f.y));
            return { port: f.port, x: p.x / INTERNAL_WIDTH, y: p.y / INTERNAL_HEIGHT };
          }),
        fighters: () =>
          live.state.fighters.map((f) => ({
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

      runner.start(canvas);
    } catch (e) {
      // Deferred out of the effect body on purpose. Setting state synchronously
      // here cascades a second render before the first has committed; a match
      // that failed to start is a once-per-mount event, so a microtask costs
      // nothing and keeps the effect a one-way trip into the game loop.
      const message = e instanceof Error ? e.message : String(e);
      queueMicrotask(() => setError(message));
    }

    return () => {
      runner?.stop();
      keyboard?.detach();
      releaseAudioGesture?.();
      // Disposed, not just silenced: an AudioContext is a real OS audio device
      // handle, and browsers cap how many a page may hold. Leaking one per
      // match means a player who quits and restarts enough times gets a game
      // that can no longer make any sound at all.
      audio?.dispose();
      runnerRef.current = null;
      keyboardRef.current = null;
      delete (window as unknown as { __smashDebug?: unknown }).__smashDebug;
    };
  }, [players, stageId, stageForm, rules, bindings, router, setResult]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code !== "Escape") return;
      setPaused((p) => {
        const next = !p;
        const canvas = canvasRef.current;
        if (next) runnerRef.current?.stop();
        else if (canvas) runnerRef.current?.start(canvas);
        return next;
      });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <main className="relative flex h-dvh w-full items-center justify-center bg-black">
      <canvas
        ref={canvasRef}
        width={INTERNAL_WIDTH}
        height={INTERNAL_HEIGHT}
        aria-label="Match"
        className="h-full w-full"
      />

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
          <p className="font-display text-5xl tracking-widest text-white">PAUSED</p>
          <p className="font-menu text-sm text-white/70">Esc to resume</p>
          <button
            onClick={quit}
            className="skew-x-[-12deg] bg-smash-red px-6 py-2 font-display text-xl text-white"
          >
            <span className="inline-block skew-x-[12deg]">QUIT MATCH</span>
          </button>
        </div>
      )}
    </main>
  );
}
