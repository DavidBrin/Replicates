"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PixelButton } from "@/components/ui/PixelButton";
import { Star } from "@/components/ui/StarRow";
import { MAX_STARS, furthestUnlocked, isUnlocked, starsFor, totalStars } from "@/content/campaign";
import { LEVEL_IDS, LEVEL_META, type LevelId } from "@/content/levels/index";
import {
  OVERWORLD_ASPECT,
  OVERWORLD_BRIDGES,
  OVERWORLD_ISLANDS,
  OVERWORLD_NODES,
  OVERWORLD_PATH,
  OVERWORLD_PROPS,
  type OverworldNode,
  type Point,
} from "@/content/overworld";
import type { Progress } from "@/ports/localProgress";

import { Avatar, Lock, Prop } from "./overworldSprites";
import { readLocalProgress, useProgress } from "./useProgress";

/**
 * The campaign overworld (SPEC §7 `/campaign`, D28): an SVG island in three
 * sections with a winding dirt path, a node per level showing its stars and
 * lock state, and the walking avatar. Two ways to move:
 *
 * - **Sequential advance** — on mount, if a level beyond where the avatar
 *   last stood has been unlocked (you just won), the avatar walks there.
 * - **Tap-to-jump** — tapping any unlocked node walks the avatar straight
 *   there (fast, capped at ~700 ms) and opens that level's intro. This is the
 *   fix for the original's walk-only navigation.
 *
 * Where the avatar stands is remembered per device in localStorage.
 */

const W = OVERWORLD_ASPECT.width;
const H = OVERWORLD_ASPECT.height;
const AVATAR_KEY = "island-empire:overworld:v1";
const INK = "var(--ie-ink, #1A1010)";

const px = (p: Point) => ({ x: p.x * W, y: p.y * H });

function readAvatarNode(): LevelId | null {
  try {
    const raw = window.localStorage.getItem(AVATAR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: string };
    return (LEVEL_IDS as readonly string[]).includes(parsed.at ?? "") ? (parsed.at as LevelId) : null;
  } catch {
    return null;
  }
}

function writeAvatarNode(at: LevelId): void {
  try {
    window.localStorage.setItem(AVATAR_KEY, JSON.stringify({ at }));
  } catch {
    /* storage unavailable — the avatar simply starts at the furthest level next time */
  }
}

/** Points of `OVERWORLD_PATH` from node a to node b, inclusive, in walking order. */
function routeBetween(a: OverworldNode, b: OverworldNode): Point[] {
  const lo = Math.min(a.pathIndex, b.pathIndex);
  const hi = Math.max(a.pathIndex, b.pathIndex);
  const slice = OVERWORLD_PATH.slice(lo, hi + 1);
  return a.pathIndex <= b.pathIndex ? [...slice] : [...slice].reverse();
}

function nodeOf(id: LevelId): OverworldNode {
  return OVERWORLD_NODES.find((n) => n.levelId === id)!;
}

export interface OverworldProps {
  /** Injected for tests; defaults to `localProgress`. */
  readProgress?: () => Progress;
}

export function Overworld({ readProgress = readLocalProgress }: OverworldProps) {
  const router = useRouter();
  const [avatarNode, setAvatarNode] = useState<LevelId>("01");
  const [avatarPos, setAvatarPos] = useState<Point>(() => ({ ...OVERWORLD_NODES[0]! }));
  const [walking, setWalking] = useState(false);
  const [facing, setFacing] = useState<1 | -1>(1);
  const [toast, setToast] = useState<string | null>(null);
  const animRef = useRef<number | null>(null);
  const walkingRef = useRef(false);

  const cancelWalk = useCallback(() => {
    if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    animRef.current = null;
    walkingRef.current = false;
    setWalking(false);
  }, []);

  /** Animates the avatar along the path to `target`; resolves when it arrives. */
  const walkTo = useCallback(
    (from: LevelId, target: LevelId, speed: "walk" | "jump"): Promise<void> =>
      new Promise((resolve) => {
        const route = routeBetween(nodeOf(from), nodeOf(target));
        if (route.length < 2) {
          setAvatarPos({ ...nodeOf(target) });
          resolve();
          return;
        }
        const lengths: number[] = [];
        let total = 0;
        for (let i = 1; i < route.length; i++) {
          const d = Math.hypot((route[i]!.x - route[i - 1]!.x) * W, (route[i]!.y - route[i - 1]!.y) * H);
          lengths.push(d);
          total += d;
        }
        // Sequential walking: ~0.9 px/ms. Tap-to-jump: fast, capped.
        const duration = speed === "walk" ? Math.min(2200, total / 0.9) : Math.min(700, Math.max(250, total / 3));
        walkingRef.current = true;
        setWalking(true);
        const start = performance.now();
        const step = (now: number) => {
          const t = Math.min(1, (now - start) / duration);
          let dist = t * total;
          let seg = 0;
          while (seg < lengths.length - 1 && dist > lengths[seg]!) {
            dist -= lengths[seg]!;
            seg++;
          }
          const a = route[seg]!;
          const b = route[seg + 1]!;
          const f = lengths[seg]! === 0 ? 1 : dist / lengths[seg]!;
          setFacing(b.x >= a.x ? 1 : -1);
          setAvatarPos({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
          if (t < 1) {
            animRef.current = requestAnimationFrame(step);
          } else {
            animRef.current = null;
            walkingRef.current = false;
            setWalking(false);
            resolve();
          }
        };
        animRef.current = requestAnimationFrame(step);
      }),
    [],
  );

  // Once progress is known: place the avatar, and walk it forward if a new level opened.
  const progress = useProgress(readProgress, (p) => {
    const furthest = furthestUnlocked(p) as LevelId;
    const stored = readAvatarNode();
    const startAt: LevelId = stored && isUnlocked(p, stored) ? stored : furthest;
    setAvatarNode(startAt);
    setAvatarPos({ ...nodeOf(startAt) });
    if (startAt !== furthest && LEVEL_IDS.indexOf(furthest) > LEVEL_IDS.indexOf(startAt)) {
      void walkTo(startAt, furthest, "walk").then(() => {
        setAvatarNode(furthest);
        writeAvatarNode(furthest);
      });
    } else {
      writeAvatarNode(startAt);
    }
  });

  useEffect(() => cancelWalk, [cancelWalk]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1400);
    return () => clearTimeout(t);
  }, [toast]);

  const onNodeTap = useCallback(
    (id: LevelId) => {
      if (!progress || walkingRef.current) return;
      if (!isUnlocked(progress, id)) {
        const i = LEVEL_IDS.indexOf(id);
        setToast(`WIN LEVEL ${LEVEL_IDS[i - 1]} FIRST`);
        return;
      }
      void walkTo(avatarNode, id, "jump").then(() => {
        setAvatarNode(id);
        writeAvatarNode(id);
        router.push(`/campaign/${id}/intro`);
      });
    },
    [progress, avatarNode, walkTo, router],
  );

  const stars = progress ? totalStars(progress) : 0;
  const pathPoints = useMemo(() => OVERWORLD_PATH.map((p) => px(p)), []);
  const pathD = useMemo(() => pathPoints.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" "), [pathPoints]);
  const avatarPx = px(avatarPos);

  return (
    <main className="relative flex min-h-dvh flex-col" style={{ background: "var(--ie-water)" }} data-testid="overworld">
      {/* top bar */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-2 p-3">
        <PixelButton href="/" variant="cream" size="sm" aria-label="Back to menu" className="pointer-events-auto">
          {"<"}
        </PixelButton>
        <h1 className="ie-outline ie-caps text-xl">Campaign</h1>
        <div className="ie-outline ie-caps flex items-center gap-1 text-sm" aria-label={`${stars} of ${MAX_STARS} stars`}>
          <Star lit size={18} />
          <span data-testid="total-stars">
            {stars}/{MAX_STARS}
          </span>
        </div>
      </header>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mx-auto h-dvh w-full max-w-[720px] select-none"
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label="Campaign island"
      >
        <defs>
          <pattern id="ie-waves" width="120" height="80" patternUnits="userSpaceOnUse">
            <rect x="10" y="20" width="26" height="4" fill="var(--ie-water-shade)" opacity="0.55" />
            <rect x="70" y="56" width="20" height="4" fill="var(--ie-water-shade)" opacity="0.55" />
            <rect x="44" y="66" width="14" height="4" fill="#ffffff" opacity="0.25" />
          </pattern>
          <pattern id="ie-grass-fleck" width="60" height="60" patternUnits="userSpaceOnUse">
            <rect x="8" y="12" width="4" height="4" fill="var(--ie-grass-fleck)" opacity="0.5" />
            <rect x="40" y="36" width="4" height="4" fill="var(--ie-grass-fleck)" opacity="0.5" />
            <rect x="26" y="50" width="4" height="4" fill="var(--ie-grass-fleck)" opacity="0.5" />
          </pattern>
        </defs>

        <rect width={W} height={H} fill="var(--ie-water)" />
        <rect width={W} height={H} fill="url(#ie-waves)" />

        {/* islands: beach fringe, then grass, then fleck */}
        {OVERWORLD_ISLANDS.map((poly, i) => {
          const pts = poly.map((p) => px(p)).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
          return (
            <g key={i}>
              <polygon points={pts} fill="var(--ie-beach)" stroke="var(--ie-water-shade)" strokeWidth={22} strokeLinejoin="round" opacity={0.9} />
              <polygon points={pts} fill="var(--ie-beach)" stroke="var(--ie-beach)" strokeWidth={22} strokeLinejoin="round" />
              <polygon points={pts} fill="var(--ie-grass)" stroke="var(--ie-grass-grid)" strokeWidth={6} strokeLinejoin="round" />
              <polygon points={pts} fill="url(#ie-grass-fleck)" />
            </g>
          );
        })}

        {/* bridges */}
        {OVERWORLD_BRIDGES.map((b, i) => {
          const a = px(b.from);
          const c = px(b.to);
          const y0 = Math.min(a.y, c.y) - 8;
          const h = Math.abs(c.y - a.y) + 16;
          return (
            <g key={i}>
              <rect x={a.x - 26} y={y0} width={52} height={h} fill="var(--ie-wood-light)" stroke={INK} strokeWidth={3} />
              {Array.from({ length: Math.floor(h / 14) }, (_, k) => (
                <rect key={k} x={a.x - 22} y={y0 + 6 + k * 14} width={44} height={4} fill="var(--ie-wood-deep)" />
              ))}
              <rect x={a.x - 30} y={y0} width={6} height={h} fill="var(--ie-wood-deep)" stroke={INK} strokeWidth={2} />
              <rect x={a.x + 24} y={y0} width={6} height={h} fill="var(--ie-wood-deep)" stroke={INK} strokeWidth={2} />
            </g>
          );
        })}

        {/* dirt path */}
        <path d={pathD} fill="none" stroke="var(--ie-wood-plank)" strokeWidth={30} strokeLinecap="round" strokeLinejoin="round" />
        <path d={pathD} fill="none" stroke="#d3ad6a" strokeWidth={20} strokeLinecap="round" strokeLinejoin="round" />
        <path d={pathD} fill="none" stroke="#c19a58" strokeWidth={4} strokeDasharray="10 18" strokeLinecap="round" />

        {/* props behind nodes */}
        {OVERWORLD_PROPS.map((p, i) => {
          const q = px(p);
          return <Prop key={i} kind={p.kind} x={q.x} y={q.y} scale={p.scale} />;
        })}

        {/* nodes */}
        {OVERWORLD_NODES.map((node) => {
          const q = px(node);
          const unlocked = progress ? isUnlocked(progress, node.levelId) : node.levelId === "01";
          const count = progress ? starsFor(progress, node.levelId) : 0;
          const meta = LEVEL_META[node.levelId];
          return (
            <g
              key={node.levelId}
              role="button"
              tabIndex={0}
              aria-label={`Level ${node.levelId}: ${meta.name}${unlocked ? "" : " (locked)"}, ${count} of 3 stars`}
              aria-disabled={!unlocked}
              data-testid={`node-${node.levelId}`}
              data-unlocked={unlocked}
              data-stars={count}
              className="cursor-pointer outline-none focus-visible:opacity-80"
              onClick={() => onNodeTap(node.levelId)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onNodeTap(node.levelId);
                }
              }}
            >
              <circle cx={q.x} cy={q.y} r={34} fill={INK} opacity={0.25} transform="translate(0 5)" />
              <circle cx={q.x} cy={q.y} r={34} fill={unlocked ? "var(--ie-wood-plank)" : "var(--ie-stone)"} stroke={INK} strokeWidth={4} />
              <circle cx={q.x} cy={q.y} r={24} fill={unlocked ? "#d3ad6a" : "var(--ie-stone-light)"} stroke={unlocked ? "var(--ie-wood-deep)" : "var(--ie-stone-dark)"} strokeWidth={4} />
              {unlocked ? (
                <text
                  x={q.x}
                  y={q.y + 9}
                  textAnchor="middle"
                  fontSize={26}
                  fontWeight={700}
                  fill="#fff"
                  stroke={INK}
                  strokeWidth={4}
                  paintOrder="stroke"
                  style={{ fontFamily: "var(--font-pixel), monospace" }}
                >
                  {Number(node.levelId)}
                </text>
              ) : (
                <Lock x={q.x} y={q.y} />
              )}
              {/* stars above the node */}
              <g transform={`translate(${q.x - 33} ${q.y - 68})`}>
                {[0, 1, 2].map((i) => (
                  <g key={i} transform={`translate(${i * 24} ${i === 1 ? -6 : 0})`}>
                    <foreignObject width={22} height={22} style={{ overflow: "visible" }}>
                      <Star lit={i < count} size={22} />
                    </foreignObject>
                  </g>
                ))}
              </g>
            </g>
          );
        })}

        <Avatar x={avatarPx.x} y={avatarPx.y - 30} walking={walking} facing={facing} />
      </svg>

      {/* bottom hint */}
      <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-2 p-4 text-center">
        {toast && (
          <div className="ie-bubble ie-pop" role="status">
            {toast}
          </div>
        )}
        <div className="ie-outline ie-caps text-xs opacity-90">Tap any unlocked level to travel there</div>
      </footer>
    </main>
  );
}

export default Overworld;
