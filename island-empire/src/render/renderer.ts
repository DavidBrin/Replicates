import type { BuyItem, GameState, PlayerColour, RuntimeTile, TileCoord } from "@/engine/types";

import { type Anim, type AnimState, progress } from "./animations";
import { type Camera, visibleTileRange } from "./camera";
import { GROUND, OUTLINE, PLAYER_HEX, UI, WATER, WHITE, playerHex } from "./palette";
import { NATIVE, atlas, type SpriteEntry, type SpriteKey } from "./sprites";

/**
 * The board painter: a pure function of `(ctx, state, ui, camera, now)`
 * (SPEC §8, §10). It never mutates anything it is given, and it is only
 * called when something changed — the session owns the dirty flag.
 */

export interface ShieldBadge {
  at: TileCoord;
  defence: number;
  colour: PlayerColour | null;
}

export interface RenderUi {
  selected: TileCoord | null;
  /** Lit tiles while a unit is selected or a shop item is being placed. */
  litZone: TileCoord[];
  shopItem: BuyItem | null;
  /** Shield badges on capturable tiles of the move zone (SPEC §7). */
  shields: ShieldBadge[];
  /** Timestamp of the last selection, for the badge pop. */
  selectedAt: number;
  anims: AnimState;
  /** Draw only the sky — the hot-seat hand-off is hiding the board. */
  hidden: boolean;
  fontFamily: string;
  /** Whose units idle-bob: the acting human seat. */
  actingPlayer: number;
  reducedMotion: boolean;
}

export const SKY = UI.sky;

function key(t: TileCoord): string {
  return `${t.x},${t.y}`;
}

function tileAt(state: GameState, x: number, y: number): RuntimeTile | null {
  if (x < 0 || y < 0 || x >= state.width || y >= state.height) return null;
  return state.tiles[y * state.width + x] ?? null;
}

function isLand(t: RuntimeTile | null): boolean {
  return !!t && t.terrain !== "water";
}

function isGround(t: RuntimeTile): boolean {
  return (
    t.terrain === "grass" ||
    t.terrain === "sand" ||
    t.terrain === "snow" ||
    t.terrain === "grassField" ||
    t.terrain === "grave" ||
    t.terrain === "bridge"
  );
}

interface Frame {
  ctx: CanvasRenderingContext2D;
  cam: Camera;
  dpr: number;
  scale: number;
  /** Snapped screen x of tile column `tx`'s left edge, in CSS px. */
  sx: (tx: number) => number;
  sy: (ty: number) => number;
}

function snap(v: number, dpr: number): number {
  return Math.round(v * dpr) / dpr;
}

function blit(f: Frame, entry: SpriteEntry | null, x: number, y: number, size: number, alpha = 1): void {
  if (!entry) return;
  const s = size / NATIVE;
  if (alpha !== 1) f.ctx.globalAlpha = alpha;
  f.ctx.drawImage(entry.canvas, x, y - entry.oy * s, entry.w * s, entry.h * s);
  if (alpha !== 1) f.ctx.globalAlpha = 1;
}

/** Blit a native sub-rectangle of a sprite (the bead strips). */
function blitRegion(
  f: Frame,
  entry: SpriteEntry | null,
  srcX: number,
  srcY: number,
  srcW: number,
  srcH: number,
  x: number,
  y: number,
  size: number,
): void {
  if (!entry) return;
  const s = size / NATIVE;
  f.ctx.drawImage(entry.canvas, srcX, srcY + entry.oy, srcW, srcH, x, y, srcW * s, srcH * s);
}

function sprite(k: SpriteKey): SpriteEntry | null {
  return atlas.get(k);
}

function terrainKey(state: GameState, t: RuntimeTile, waterFrame: number): SpriteKey {
  const biome = state.biome;
  switch (t.terrain) {
    case "grass":
    case "sand":
    case "snow":
      return { kind: "ground", biome, frame: (t.x * 7 + t.y * 13) % 6 };
    case "water":
      return { kind: "water", biome, frame: waterFrame };
    case "bridge": {
      const n = tileAt(state, t.x, t.y - 1);
      const s = tileAt(state, t.x, t.y + 1);
      const vertical = isLand(n) || isLand(s);
      return { kind: "bridge", biome, frame: vertical ? 0 : 1 };
    }
    case "grassField":
      return { kind: "field", biome };
    case "grave":
      return { kind: "grave", biome };
    case "forestPine":
      return { kind: "forestPine", biome };
    case "forestPalm":
      return { kind: "forestPalm", biome };
    case "forestIcePine":
      return { kind: "forestIcePine", biome };
    case "mountain":
      return { kind: "mountain", biome };
  }
}

function roadMask(state: GameState, t: RuntimeTile): number {
  let m = 0;
  if (tileAt(state, t.x, t.y - 1)?.road) m |= 1;
  if (tileAt(state, t.x + 1, t.y)?.road) m |= 2;
  if (tileAt(state, t.x, t.y + 1)?.road) m |= 4;
  if (tileAt(state, t.x - 1, t.y)?.road) m |= 8;
  return m;
}

export function fontFor(px: number, family: string): string {
  return `700 ${Math.round(px)}px ${family}`;
}

/** White pixel text with the warm-black outline, centred at (x, y). */
export function outlinedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  px: number,
  family: string,
  fill = WHITE,
): void {
  ctx.font = fontFor(px, family);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2, px / 5);
  ctx.strokeStyle = OUTLINE;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

export function render(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  ui: RenderUi,
  cam: Camera,
  now: number,
): void {
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = SKY;
  ctx.fillRect(0, 0, cam.viewW, cam.viewH);
  if (ui.hidden) return;

  const f: Frame = {
    ctx,
    cam,
    dpr,
    scale: cam.tilePx / NATIVE,
    sx: (tx) => snap((tx - cam.x) * cam.tilePx, dpr),
    sy: (ty) => snap((ty - cam.y) * cam.tilePx, dpr),
  };
  const range = visibleTileRange(cam);
  const waterFrame = ui.reducedMotion ? 0 : Math.floor(now / 500) % 2;
  const lit = new Set(ui.litZone.map(key));
  const zoneActive = ui.litZone.length > 0 && (ui.selected !== null || ui.shopItem !== null);
  const slidingFrom = new Map<string, Anim>();
  const slidingTo = new Set<string>();
  const crumbling = new Set<string>();
  for (const a of ui.anims.items) {
    if (a.type === "slide") {
      slidingFrom.set(key(a.from), a);
      slidingTo.add(key(a.to));
    }
    if (a.type === "crumble") crumbling.add(key(a.at));
  }

  // ---- pass 1: terrain, roads, grid, decorations, beads --------------------
  for (let y = range.y0; y <= range.y1; y++) {
    for (let x = range.x0; x <= range.x1; x++) {
      const t = tileAt(state, x, y);
      if (!t) continue;
      const px = f.sx(x);
      const py = f.sy(y);
      const size = f.sx(x + 1) - px;
      blit(f, sprite(terrainKey(state, t, waterFrame)), px, py, size);
      if (t.terrain === "water") {
        if (isLand(tileAt(state, x, y - 1))) blit(f, sprite({ kind: "beachN" }), px, py, size);
        if (isLand(tileAt(state, x, y + 1))) blit(f, sprite({ kind: "beachS" }), px, py, size);
        if (isLand(tileAt(state, x - 1, y))) blit(f, sprite({ kind: "beachW" }), px, py, size);
        if (isLand(tileAt(state, x + 1, y))) blit(f, sprite({ kind: "beachE" }), px, py, size);
      }
      if (t.road && t.terrain !== "water") {
        blit(f, sprite({ kind: "road", frame: roadMask(state, t) }), px, py, size);
      } else {
        // grid lines: 1 native px in the biome's darker hue; water uses its shade, faint
        const g = t.terrain === "water" ? WATER.shade : GROUND[state.biome].grid;
        ctx.globalAlpha = t.terrain === "water" ? 0.35 : 1;
        ctx.fillStyle = g;
        const lw = Math.max(1 / dpr, f.scale);
        ctx.fillRect(px, py, size, lw);
        ctx.fillRect(px, py, lw, size);
        ctx.globalAlpha = 1;
      }
      if (t.decoration && isGround(t) && t.terrain !== "grassField" && t.terrain !== "grave") {
        blit(f, sprite({ kind: t.decoration }), px, py, size);
      }
    }
  }

  // territory beads — both sides of a contested edge (SPEC §8)
  for (let y = range.y0; y <= range.y1; y++) {
    for (let x = range.x0; x <= range.x1; x++) {
      const t = tileAt(state, x, y);
      if (!t || t.owner === null) continue;
      const colour = state.players[t.owner]?.colour ?? null;
      const h = sprite({ kind: "beadsH", colour });
      const v = sprite({ kind: "beadsV", colour });
      const px = f.sx(x);
      const py = f.sy(y);
      const size = f.sx(x + 1) - px;
      const s = size / NATIVE;
      if (tileAt(state, x, y - 1)?.owner !== t.owner) blitRegion(f, h, 0, 0, 32, 4, px, py, size);
      if (tileAt(state, x, y + 1)?.owner !== t.owner) blitRegion(f, h, 0, 0, 32, 4, px, py + 28 * s, size);
      if (tileAt(state, x - 1, y)?.owner !== t.owner) blitRegion(f, v, 0, 0, 4, 32, px, py, size);
      if (tileAt(state, x + 1, y)?.owner !== t.owner) blitRegion(f, v, 0, 0, 4, 32, px + 28 * s, py, size);
    }
  }

  // ---- pass 2: move-zone wash ------------------------------------------------
  if (zoneActive) {
    ctx.fillStyle = "rgba(0,0,0,0.30)";
    for (let y = range.y0; y <= range.y1; y++) {
      for (let x = range.x0; x <= range.x1; x++) {
        if (lit.has(`${x},${y}`)) continue;
        if (ui.selected && ui.selected.x === x && ui.selected.y === y) continue;
        const px = f.sx(x);
        const py = f.sy(y);
        ctx.fillRect(px, py, f.sx(x + 1) - px, f.sy(y + 1) - py);
      }
    }
    const frame = sprite({ kind: "dottedFrame" });
    for (const z of ui.litZone) {
      if (z.x < range.x0 || z.x > range.x1 || z.y < range.y0 || z.y > range.y1) continue;
      const px = f.sx(z.x);
      blit(f, frame, px, f.sy(z.y), f.sx(z.x + 1) - px);
    }
  }

  // ---- pass 3: buildings and units, row by row so tall sprites overlap upward
  for (let y = range.y0; y <= range.y1 + 1; y++) {
    for (let x = range.x0; x <= range.x1; x++) {
      const t = tileAt(state, x, y);
      if (!t) continue;
      const k = key(t);
      const px = f.sx(x);
      const py = f.sy(y);
      const size = f.sx(x + 1) - px;
      const owner = t.owner === null ? null : (state.players[t.owner]?.colour ?? null);
      if (t.building && !crumbling.has(k)) {
        blit(f, sprite({ kind: t.building, biome: state.biome, colour: owner }), px, py, size);
      }
      if (t.unit && !slidingTo.has(k) && !slidingFrom.has(k)) {
        const bob =
          !ui.reducedMotion && t.unit.readyToMove && t.owner === ui.actingPlayer
            ? (Math.floor(now / 500) % 2) * f.scale
            : 0;
        blit(f, sprite({ kind: `knight${t.unit.level}`, colour: owner }), px, py - bob, size);
      }
    }
  }

  // ---- pass 4: selection ring + shields ---------------------------------------
  if (ui.selected) {
    const px = f.sx(ui.selected.x);
    const py = f.sy(ui.selected.y);
    const size = f.sx(ui.selected.x + 1) - px;
    ctx.lineWidth = Math.max(2, f.scale * 1.5);
    ctx.strokeStyle = OUTLINE;
    ctx.strokeRect(px + 1, py + 1, size - 2, size - 2);
    ctx.strokeStyle = WHITE;
    ctx.lineWidth = Math.max(1, f.scale);
    ctx.strokeRect(px + 1, py + 1, size - 2, size - 2);
  }
  if (ui.shields.length > 0) {
    const pop = ui.reducedMotion ? 1 : Math.min(1, (now - ui.selectedAt) / 100);
    for (const b of ui.shields) {
      const px = f.sx(b.at.x);
      const py = f.sy(b.at.y);
      const size = f.sx(b.at.x + 1) - px;
      const badge = size * 0.62 * (0.6 + 0.4 * pop);
      const bx = px + size / 2 - badge / 2;
      const by = py + size / 2 - badge / 2;
      blit(f, sprite({ kind: "shield", colour: b.colour }), bx, by, badge);
      outlinedText(ctx, String(b.defence), px + size / 2, py + size / 2 + badge * 0.02, badge * 0.36, ui.fontFamily);
    }
  }

  // ---- pass 5: animations -------------------------------------------------------
  for (const a of ui.anims.items) drawAnim(f, state, ui, a, now);
}

function drawAnim(f: Frame, state: GameState, ui: RenderUi, a: Anim, now: number): void {
  const { ctx } = f;
  const p = progress(a, now);
  switch (a.type) {
    case "slide": {
      const x = a.from.x + (a.to.x - a.from.x) * p;
      const y = a.from.y + (a.to.y - a.from.y) * p;
      const px = f.sx(x);
      const py = f.sy(y);
      blit(f, sprite({ kind: `knight${a.level}`, colour: a.colour }), px, py, f.cam.tilePx);
      break;
    }
    case "flash": {
      const px = f.sx(a.at.x);
      const py = f.sy(a.at.y);
      ctx.globalAlpha = 0.7 * (1 - p);
      ctx.fillStyle = PLAYER_HEX[a.colour];
      ctx.fillRect(px, py, f.cam.tilePx, f.cam.tilePx);
      ctx.globalAlpha = 1;
      break;
    }
    case "coin": {
      const ease = p * (2 - p);
      const x = a.from.x + (a.to.x - a.from.x) * ease + 0.5;
      const y = a.from.y + (a.to.y - a.from.y) * ease + 0.5 - Math.sin(p * Math.PI) * 0.6;
      const size = f.cam.tilePx * 0.4;
      blit(f, sprite({ kind: "coin" }), f.sx(x) - size / 2, f.sy(y) - size / 2, size);
      break;
    }
    case "float": {
      const rise = (16 / NATIVE) * f.cam.tilePx * p;
      const cx = f.sx(a.at.x + 0.5);
      const cy = f.sy(a.at.y + 0.25) - rise;
      ctx.globalAlpha = 1 - p * p;
      outlinedText(ctx, a.text, cx, cy, f.cam.tilePx * 0.3, ui.fontFamily, a.colour);
      ctx.globalAlpha = 1;
      break;
    }
    case "fade": {
      const px = f.sx(a.at.x);
      const py = f.sy(a.at.y);
      if (a.kind === "grave") {
        blit(f, sprite({ kind: "grave", biome: state.biome }), px, py, f.cam.tilePx, 1 - p);
      } else if (a.level) {
        blit(f, sprite({ kind: `knight${a.level}`, colour: a.colour }), px, py, f.cam.tilePx, 1 - p);
      }
      break;
    }
    case "crumble": {
      const shake = Math.sin(p * Math.PI * 8) * f.scale * 2 * (1 - p);
      const px = f.sx(a.at.x) + shake;
      const py = f.sy(a.at.y);
      blit(f, sprite({ kind: "city", biome: state.biome, colour: a.colour }), px, py, f.cam.tilePx, 1 - p);
      break;
    }
  }
}

/** Convenience for tests and the HUD: the hex of a seat, or neutral. */
export function colourOf(state: GameState, player: number | null): string {
  return playerHex(player === null ? null : (state.players[player]?.colour ?? null));
}
