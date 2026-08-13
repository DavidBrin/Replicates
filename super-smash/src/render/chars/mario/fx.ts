/**
 * mario: what their moves paint on top of the figure.
 *
 * Keyed by move slot. A slot with no entry paints nothing, which is right
 * whenever the move’s whole graphic is its projectile — that is already drawn
 * by `drawProjectiles`, and a second glow on top only muddies it.
 *
 * Two things about the frame numbers, because both are silent when wrong.
 * `frame` here is `moveFrameOf(actionFrame)`, i.e. `actionFrame + 1`, which is
 * the number the frame data quotes — so a hitbox listed as live on 15–17 is
 * live when `frame` is 15 to 17 and no arithmetic is needed. And nothing below
 * calls `Math.random()`: the renderer can be asked to draw the same simulation
 * frame twice, and an effect that reshuffles itself between the two flickers.
 */

import {
  NOTHING,
  circle,
  crescent,
  glow,
  type FxFn,
} from "../../fxKit";
import { withAlpha } from "../../rigKit";
import type { MoveSlot } from "@/engine/types";
import type { ProjectilePainter } from "../../fxKit";

/**
 * A lobed blob, for fire.
 *
 * A circle reads as a ball and a ball does not read as flame at any size. What
 * does is an outline whose radius varies around the turn on two
 * incommensurable sinusoids, re-evaluated every frame so the tongues crawl.
 * The amplitude is modulated round the circle rather than constant: evenly
 * spaced lobes read unmistakably as a Super Star.
 */
function flame(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  phase: number,
  stretch = 1,
): void {
  const N = 40;
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const tongue = Math.max(0, Math.sin(a * 5 + phase));
    const amp = 0.26 * (0.45 + 0.55 * Math.cos(a * 2 + phase * 0.4));
    const w = r * (1 + amp * tongue ** 1.5 + 0.05 * Math.sin(a * 3 - phase));
    const px = cx + Math.cos(a) * w * stretch;
    const py = cy + Math.sin(a) * w;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

export const fx: Partial<Record<MoveSlot, FxFn>> = {
  /**
   * Forward smash, the fire palm.
   *
   * The 17.8% half of this move is a radius-5 fire hitbox centred 8.6 units in
   * front of him at chest height; the 14.7% half is his forearm — the *close*
   * hit is the weak one. So the graphic goes where the fire hitbox actually is
   * at the size it actually is. Matching them is what makes a move honest to
   * fight, and mismatching them is the single commonest reason a replicate
   * feels wrong to someone who plays the original.
   *
   * Before it, an ember gathering in the cocked palm — behind his hip, which
   * is where the hand is during the wind-up, not out in front where it ends
   * up. A charge with no tell is a charge nobody has to respect.
   */
  fsmash: ({ ctx, x, y, u, dir, frame }) => {
    ctx.save();
    if (frame < 15) {
      const k = Math.min(1, frame / 14);
      // In the cocked fist at his chest, which is where the hand is during the
      // wind-up — the pose brings both fists up into a guard and leans away,
      // rather than cocking the palm behind the hip as it used to.
      const px = x + u * 1.8 * dir;
      const py = y - u * 5.2;
      glow(ctx, px, py, u * (0.9 + 2.0 * k), withAlpha("#FF9A1F", 0.2 + 0.34 * k));
      ctx.fillStyle = withAlpha("#FFE49A", 0.55 * k);
      circle(ctx, px, py, u * 0.55 * k);
      ctx.restore();
      return NOTHING;
    }

    const age = frame - 15;
    if (age > 6) {
      ctx.restore();
      return NOTHING;
    }
    // Blooms over two frames, holds for the three live ones, then decays.
    const grow = Math.min(1, (age + 1) / 2.5);
    // Out inside four frames of the hitbox expiring. It used to linger to
    // age 9, and a half-alpha red flame over a dark stage is not a dying fire,
    // it is a brown smudge.
    const fade = age <= 3 ? 1 : 1 - (age - 3) / 4;
    const cx = x + u * 7.6 * dir;
    const cy = y - u * 6.9;
    const r = u * 4.4 * grow;
    const phase = frame * 0.9;

    ctx.globalAlpha = fade;
    // The throat of the blast, back along the arm, so it reads as coming *from*
    // him rather than as a fireball someone parked in front of him.
    const throat = ctx.createLinearGradient(x + u * 2.2 * dir, y - u * 6.7, cx, cy);
    throat.addColorStop(0, withAlpha("#FFF3C4", 0.9));
    throat.addColorStop(1, withAlpha("#FF6A18", 0.15));
    ctx.fillStyle = throat;
    ctx.beginPath();
    ctx.moveTo(x + u * 2.2 * dir, y - u * 6.3);
    ctx.lineTo(cx, cy + r * 0.55);
    ctx.lineTo(cx, cy - r * 0.55);
    ctx.lineTo(x + u * 2.2 * dir, y - u * 7.1);
    ctx.closePath();
    ctx.fill();

    glow(ctx, cx, cy, r * 1.7, withAlpha("#FF6A18", 0.5));
    ctx.fillStyle = withAlpha("#E5352B", 0.88);
    flame(ctx, cx, cy, r, phase, 1.12);
    ctx.fillStyle = withAlpha("#FF9A1F", 0.95);
    flame(ctx, cx, cy, r * 0.7, phase * 1.4 + 2, 1.12);
    ctx.fillStyle = "#FFF3C4";
    flame(ctx, cx, cy, r * 0.32, phase * 1.9 + 4, 1.18);
    ctx.restore();
    return NOTHING;
  },

  /*
   * Up smash, the headbutt, has no entry here on purpose.
   *
   * There was a swipe arc in this slot for one round of this pass and it is
   * gone. The decompiled `AttackHi4` script carries no effect call, and what a
   * player actually reads is the head travelling 235° from behind his heels to
   * out in front of his toes — which is now in the pose rather than painted on
   * top of it. The arc that was here read as a grey banana beside his ear, not
   * as the path of anything, which is what inventing a graphic the original
   * does not have tends to look like.
   *
   * A caveat for the next round, because the negative evidence is weaker than
   * it looks: Ultimate Frame Data's hitbox captures have VFX suppressed —
   * pixel-sampling them finds no orange anywhere on the forward smash either,
   * and that one certainly has fire. If someone turns up gameplay footage with
   * a swipe on it, this is the slot.
   */

  /**
   * Down smash, the breakdance sweep.
   *
   * Dust rather than energy: this is a leg scything along a floor, and the
   * body is laid out flat at ankle height while it happens. Front pass on
   * frames 5-6 and back pass on 14, matching the two hitboxes, each gone
   * inside five frames so the two reads stay separate — a single arc spanning
   * both would say one long sweep, which is the opposite of what the move
   * does.
   *
   * Kept low and wide. The hitboxes sit at y 1.8 with a 4-unit radius reaching
   * nearly five units out either way, so the dust is a shallow fan skimming
   * the stage rather than the head-height arc that was here before — which was
   * drawn at the height his *hips* used to be, back when this move was posed
   * as a crouch.
   */
  dsmash: ({ ctx, x, y, u, dir, frame }) => {
    const pass = (start: number, side: number) => {
      const age = frame - start;
      if (age < 0 || age > 5) return;
      const fade = (1 - age / 5) * 0.6;
      const spread = 0.42 + age * 0.16;
      const cy = y - u * 1.0;
      const mid = side > 0 ? 0 : Math.PI;
      ctx.save();
      ctx.fillStyle = withAlpha("#D9CFC0", fade);
      crescent(ctx, x, cy, u * (4.2 + age * 0.75), u * 1.15, mid - spread, mid + spread);
      ctx.fill();
      // A thinner skim further out, so the fan has a leading edge and reads as
      // travelling rather than as a static smudge on the floor.
      ctx.fillStyle = withAlpha("#EFE7DA", fade * 0.75);
      crescent(ctx, x, cy, u * (5.6 + age * 0.95), u * 0.5, mid - spread * 0.7, mid + spread * 0.7);
      ctx.fill();
      ctx.restore();
    };
    pass(5, dir);
    pass(14, -dir);
    return NOTHING;
  },

  /**
   * Neutral special, Fireball: the heat left in the glove.
   *
   * Three frames, and only from the frame the ball exists. The real move has
   * no telegraph, and anything painted before frame 17 would lie about how
   * safe it is to challenge.
   */
  neutralB: ({ ctx, x, y, u, dir, frame }) => {
    const since = frame - 17;
    if (since < 0 || since > 2) return NOTHING;
    const px = x + dir * u * 4.4;
    const py = y - u * 6.1;
    ctx.save();
    ctx.globalAlpha = 1 - since / 3;
    glow(ctx, px, py, u * (0.85 + since * 0.24), "rgba(255,236,176,0.75)", "rgba(255,132,32,0.3)");
    ctx.restore();
    return NOTHING;
  },

  /**
   * Side special, Cape.
   *
   * The cape is the move, and round one had almost every fact about it wrong.
   * Reference (SmashWiki's Cape article, the official Move-List render, and
   * the in-game footage frame-stepped) settles four things:
   *
   * **It is yellow.** Cape Feather yellow, on *both* faces — there is no red
   * outside and no contrasting lining; the folded-under faces only read darker
   * because they are shaded. Round one painted it deep red with a yellow
   * lining, which is the single reason it disappeared: a red sheet over a red
   * shirt is one shape, and the whole graphic vanished on exactly the frames
   * the hitbox was live. Yellow is the only colour in this move that Mario is
   * not already wearing, and it is the colour the move actually is.
   *
   * **It is worn round the neck, not held.** The article is generated on frame
   * 1 and fastened at his throat with a small red clasp; it hangs down his back
   * and whips round on its own. So it is anchored at the collar and swings, not
   * carried by a hand — which also means the pose does not have to fake a grip.
   *
   * **It sweeps across the chest, not over the head.** Both damage hitboxes and
   * the reflector sit at y ≈ 6.5–6.7, a shade under half his height. Round one
   * arced it over the top, which is Marth's cape, not Mario's.
   *
   * **It is big.** At full billow it is about one Mario-height across. Round
   * one's was roughly a head and a half — small enough to read as a mitten.
   *
   * Reflect is live 9–20 and the hitboxes 12–14, so the sheet is at its widest
   * across 12–14 and is folding away by 20. It is painted `over` from the
   * moment it crosses the shoulder, because from there on it is genuinely in
   * front of him and cloth behind a body is not cloth, it is a rug.
   */
  sideB: ({ ctx, x, y, u, dir, frame, over }) => {
    if (frame < 3 || frame > 28) return NOTHING;
    // Eased so it is slow behind him and fast through the front: that is what
    // a flourish does, and it is what puts the widest shape on 12–14 rather
    // than four frames before them.
    const travel = Math.min(1, Math.max(0, (frame - 4) / 10));
    const p = 1 - (1 - travel) ** 2;
    // 0 is forward, +90 up, 180 back, 270 down. The window starts at 190–262,
    // which is the cloth hanging down his back, and ends at 302–374, which is
    // spread across his front centred 22° below the collar — chest height,
    // where the hitboxes and the reflector actually are.
    //
    // It travels the 108° *through the bottom* rather than over the top, and
    // that is the whole shape of this graphic. Interpolating the short way
    // round swings it over his head, which is Marth's cape; the reference is
    // explicit that Mario's never leaves chest height. Going under also keeps
    // the sheet's upper edge at 9.4 units against a head that tops out at
    // 12.4, so it never fights the port tag either.
    const a = ((198 + 108 * p) * Math.PI) / 180;
    const fold = frame <= 17 ? 1 : Math.max(0, 1 - (frame - 17) / 9);
    const open = Math.min(1, frame / 5);

    // The collar, not the hand: fixed at the throat for the whole swing.
    const ax = x + u * 0.2 * dir;
    const ay = y - u * 7.5;
    // Gathered against his back at the start and flung out to a full sheet by
    // the time the hitbox is live. 8 units is about three quarters of his
    // height from the collar, which with the sheet's own width comes out at
    // roughly one Mario across — the size the reference measures.
    const R = u * (3.8 + 7.4 * p) * (0.55 + 0.45 * fold) * open;
    // 74°. Every extra ten degrees is another unit of cloth above the
    // shoulder, and `over` still lands under the port tag, which lives there.
    const spread = (74 * Math.PI) / 180;

    const sheet = (rad: number, from: number, to: number, ripple: number) => {
      // A quadrilateral with a rippled far edge, not a sector.
      //
      // A sector struck from the collar is as tall as it is wide however the
      // taper is tuned, and a critic looking at that version called it "a
      // yellow sack" — correctly. The reference measures Mario's cape as a
      // broad sheet **wider than it is long**, so the far edge is a straight
      // chord between two corners rather than an arc, and the ripple runs
      // along that chord where it is actually legible. The collar end is given
      // a little width too, so it is cloth gathered at a clasp rather than a
      // triangle pinned to a point.
      const px = (ang: number, r: number) => [ax + Math.cos(ang) * r * dir, ay - Math.sin(ang) * r] as const;
      const [x0, y0] = px(a + from, rad);
      const [x1, y1] = px(a + to, rad * 0.9);
      const [cx0, cy0] = px(a + from, u * 0.7);
      const [cx1, cy1] = px(a + to, u * 0.7);
      // Unit normal to the far edge, for the flap.
      const ex = x1 - x0;
      const ey = y1 - y0;
      const len = Math.hypot(ex, ey) || 1;
      const nx = -ey / len;
      const ny = ex / len;

      const N = 14;
      ctx.beginPath();
      ctx.moveTo(cx0, cy0);
      for (let i = 0; i <= N; i++) {
        const k = i / N;
        // Pinned at the corners, loosest in the middle — a hem flaps, its
        // corners are held by the weight of the cloth behind them.
        const wave = ripple * len * Math.sin(Math.PI * k) * Math.sin(k * 3.4 + frame * 0.55);
        ctx.lineTo(x0 + ex * k + nx * wave, y0 + ey * k + ny * wave);
      }
      ctx.lineTo(cx1, cy1);
      ctx.closePath();
    };

    const paint = () => {
      ctx.save();
      ctx.globalAlpha = 0.97 * fold;
      ctx.fillStyle = "#F7C51B";
      sheet(R, 0, spread, 0.075);
      ctx.fill();
      // A fold in the same cloth, not a lining. The reference is explicit that
      // Mario's cape is Cape-Feather yellow on *both* faces and that the
      // under-surfaces only read darker because they are shaded, so this is one
      // stop down rather than a second colour, and it covers a third of the
      // sheet rather than half.
      ctx.fillStyle = "#D6A312";
      sheet(R * 0.78, spread * 0.62, spread * 1.0, 0.05);
      ctx.fill();
      ctx.restore();
    };

    // Behind him until it clears the shoulder, in front of him after — the one
    // thing `over` exists for.
    if (p < 0.3) paint();
    else over(paint);

    // The swoosh, and the sparks the real move throws off the leading edge.
    // Both live only on the frames the cape is actually travelling fast.
    if (frame >= 9 && frame <= 17) {
      const k = (frame - 9) / 8;
      over(() => {
        ctx.save();
        ctx.globalAlpha = 0.55 * (1 - k);
        ctx.fillStyle = "rgba(214,244,255,0.85)";
        // Drawn in a mirrored frame so the angle arithmetic never has a `dir`
        // in it: the crescent runs along the leading half of the sheet, and a
        // sign applied to an angle *and* to the frame is a sign applied twice.
        ctx.save();
        ctx.translate(ax, ay);
        ctx.scale(dir, 1);
        // Along the middle of the leading edge and *inside* the sheet's radius.
        // Hung off the outer edge it swung below the stage on the last frames
        // of the sweep, because the sweep finishes pointing down-and-forward.
        crescent(ctx, 0, 0, R * 0.88, u * 1.3, -a - spread * 0.46, -a - spread * 0.06);
        ctx.fill();
        ctx.restore();
        ctx.globalAlpha = 0.9 * (1 - k);
        for (let i = 0; i < 4; i++) {
          // Along the upper half of the leading edge: the sweep finishes
          // pointing down and forward, so sparks spaced evenly across the
          // sheet end up scattered along the floor.
          const t = 0.04 + 0.14 * i;
          const ang = a + spread * t;
          const rr = R * (1.0 + 0.09 * ((i * 3) % 2));
          const sx = ax + Math.cos(ang) * rr * dir;
          const sy = ay - Math.sin(ang) * rr;
          const size = u * (0.5 + 0.3 * ((i * 5) % 3)) * (1 - k);
          ctx.fillStyle = i % 2 === 0 ? "#FF6CE0" : "#FFE27A";
          ctx.beginPath();
          for (let q = 0; q < 8; q++) {
            const b = (q / 8) * Math.PI * 2;
            const r = q % 2 === 0 ? size : size * 0.26;
            const px = sx + Math.cos(b) * r;
            const py = sy + Math.sin(b) * r;
            if (q === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      });
    }
    return NOTHING;
  },

  /**
   * Up special, Super Jump Punch: the coins.
   *
   * The single most recognisable thing about the move, and the pose cannot say
   * it. Round one drew them from the fist, under the fighter, on a fixed
   * timeline. All three are wrong, and the reference is unusually explicit
   * about why:
   *
   * **They come out of the victim, not the fist.** Every one of this move's
   * hitboxes carries the `coin` collision attribute — the coins *are* the hit
   * effect, spawned at the point of contact. SmashWiki: "if the attack strikes
   * an enemy during the jump, coins fly out of the enemy." So a Super Jump
   * Punch that hits nothing produces no coins at all, and that is a read worth
   * having: a player who sees coins knows the move connected. `struckWith` is
   * exactly this distinction — a number once a box has won, `null` while the
   * simulation is watching and nothing has landed, `undefined` in the
   * animation lab where there is no match to ask. Coins on not-`null` means
   * they appear on connection and in the lab, and never on a whiff.
   *
   * **They come in bursts, one per hit.** The move lands up to seven times —
   * 3–6, then a rehit every other frame through 15, then the finisher on 17 —
   * so the coins arrive in seven separate puffs rather than as one shower.
   *
   * **They go in front.** Painted under the fighter they were behind his own
   * cap for their whole life, which is what `over` exists for.
   *
   * The coins themselves are **Star Coins** — gold, with a star struck into
   * the face, not a "1". At this size the star is four pixels across, so it is
   * only drawn on the frames a coin is more than half face-on; edge-on it is
   * a sliver and any detail on it is mud.
   */
  upB: ({ ctx, x, y, u, dir, frame, struckWith, over }) => {
    if (struckWith === null || frame < 3 || frame > 32) return NOTHING;

    // The rehit schedule: the 5% on 3, five 0.6% looping hits every other
    // frame, the 3% finisher on 17. Each entry is (frame, height) — the
    // hitboxes climb from chest to over the head as he rises, so the coins
    // start where the hit that made them was.
    const bursts: readonly (readonly [number, number])[] = [
      [3, 6.5], [7, 8.5], [9, 8.8], [11, 9.2], [13, 9.6], [15, 10.2], [17, 11.5],
    ];

    over(() => {
      ctx.save();
      for (const [born, height] of bursts) {
        const age = frame - born;
        if (age < 0 || age > 13) continue;
        const life = Math.min(1, (13 - age) / 5);
        for (let i = 0; i < 3; i++) {
          // Deterministic scatter off the pair (burst, index): the renderer can
          // be asked to draw the same simulation frame twice and anything that
          // reshuffles between the two flickers. Three per burst rather than
          // four, at three quarters the size and thrown from four units in
          // front of him: seven overlapping bursts of big coins spawning at
          // his chest buried his own face under an opaque gold mass, which is
          // a hit effect eating the fighter it is supposed to decorate.
          const seed = born * 7 + i * 3;
          const outward = 0.34 + 0.30 * ((seed % 5) / 4);
          const side = i % 2 === 0 ? 1 : -0.55;
          const rise = 1.05 + 0.26 * ((seed % 3) / 2);
          // Out from the contact point, which sits in front of him — the
          // engine's boxes reach four units forward — then pulled back down.
          const px = x + dir * u * (4.4 + side * outward * age * 0.7);
          const py = y - u * (height + rise * age - 0.075 * age * age);
          const turn = Math.abs(Math.cos(age * 0.44 + seed * 0.7));
          const r = u * 0.78;

          ctx.globalAlpha = life;
          ctx.fillStyle = "#8A5D06";
          ctx.beginPath();
          ctx.ellipse(px, py, r * (0.14 + 0.86 * turn), r, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#FFD629";
          ctx.beginPath();
          ctx.ellipse(px, py, r * (0.1 + 0.66 * turn), r * 0.78, 0, 0, Math.PI * 2);
          ctx.fill();
          if (turn < 0.55) continue;
          ctx.fillStyle = "#FFF3B0";
          ctx.beginPath();
          for (let k = 0; k < 10; k++) {
            const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
            const rr = (k % 2 === 0 ? 0.44 : 0.18) * r;
            const sx = px + Math.cos(a) * rr * turn;
            const sy = py + Math.sin(a) * rr;
            if (k === 0) ctx.moveTo(sx, sy);
            else ctx.lineTo(sx, sy);
          }
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.restore();
    });
    return NOTHING;
  },

  /**
   * Down special, F.L.U.D.D.
   *
   * Three graphics, and round one had the most important one flatly wrong.
   *
   * **The water is not a cone.** F.L.U.D.D. fires **seven discrete pumps, one
   * every five frames, each living twelve** — so at most three globs are in the
   * air at once and what you see is a broken, dashed line of water, not a jet.
   * Every parameter below is from SmashWiki's own table for the move: initial
   * speed 4.3, default angle 12° *above* horizontal, gravity 0.17, size
   * multiplier 0.8–1.2 per glob. Working those through gives about fifty units
   * of travel ending a unit and a half below where it left — a long, nearly
   * flat spray that dies about a third of the way across Battlefield, which is
   * what the move actually covers. The translucent triangle that was here read
   * as a beam attack, and F.L.U.D.D. **deals no damage at all**: it pushes. A
   * player who learns to respect a beam will lose stocks to that lie.
   *
   * **He is holding the nozzle beside his head.** Round one drew it over his
   * shoulder, where it was hidden behind him for the whole move and the water
   * appeared to come out of his face. The reference is specific — in *Smash*,
   * unlike *Sunshine*, the nozzle is pulled up **next to his head**, gripped in
   * one hand with the other on a handle — so it is drawn `over`, in front of
   * the body, ending where his gloves are and where the water starts.
   *
   * The tank stays *under* the fighter, which suits a backpack exactly: it
   * wants to be behind him. It is the graphic that tells you which special he
   * threw from the very first frame, long before any water exists.
   */
  downB: ({ ctx, x, y, u, dir, frame, total, over }) => {
    const appear = Math.min(1, frame / 5);
    const leave = Math.min(1, (total - frame) / 6);
    const alpha = Math.min(appear, leave);

    // The tank, behind the shoulders. Water tank, two handles, yellow nozzle,
    // and it only exists while the move is out.
    //
    // Called rather than deferred, on purpose: effects paint under the fighter
    // by default and a backpack is the one thing here that wants to stay there.
    const tank = () => {
      ctx.save();
      ctx.globalAlpha = alpha;
      const tx = x - u * 2.3 * dir;
      const ty = y - u * 7.4;
      const tw = u * 1.5;
      const th = u * 2.1;
      ctx.fillStyle = "#2A1810";
      ctx.beginPath();
      ctx.roundRect(tx - tw - u * 0.16, ty - th - u * 0.16, (tw + u * 0.16) * 2, (th + u * 0.16) * 2, u * 0.8);
      ctx.fill();
      ctx.fillStyle = "#E4ECF2";
      ctx.beginPath();
      ctx.roundRect(tx - tw, ty - th, tw * 2, th * 2, u * 0.7);
      ctx.fill();
      ctx.fillStyle = "#3B7BD9";
      ctx.beginPath();
      ctx.roundRect(tx - tw, ty - th * 0.25, tw * 2, th * 0.5, u * 0.2);
      ctx.fill();
      ctx.fillStyle = "#8FB6E8";
      circle(ctx, tx + u * 0.2 * dir, ty - th * 0.55, u * 0.42);
      // The hose. Without it the tank is a white box parked behind a man
      // rather than a thing he is wearing, and the nozzle in his hands is
      // connected to nothing.
      ctx.strokeStyle = "#2A1810";
      ctx.lineWidth = Math.max(1, u * 0.42);
      ctx.beginPath();
      ctx.moveTo(tx + u * 0.9 * dir, ty - th * 0.8);
      ctx.quadraticCurveTo(x + u * 0.4 * dir, y - u * 10.6, x + u * 2.6 * dir, y - u * 9.1);
      ctx.stroke();
      ctx.restore();
    };
    tank();

    // Where the nozzle points, and therefore where the water leaves: the
    // muzzle, 12° above horizontal, level with the top of his head.
    const ANGLE = (12 * Math.PI) / 180;
    const ox = x + u * 6.5 * dir;
    const oy = y - u * 9.7;

    // The nozzle itself, in his hands and in front of him. It is *stowed*
    // until he brings it up: the pack is on his back from frame 1, but the
    // nozzle only exists once the pose has hands to put it in, or it hangs in
    // the air beside a man hunched over a pump.
    const raise = Math.min(1, Math.max(0, (frame - 16) / 5));
    if (raise > 0) over(() => {
      ctx.save();
      ctx.globalAlpha = alpha * raise;
      ctx.translate(x + u * 2.9 * dir, y - u * 8.9);
      ctx.scale(dir, 1);
      ctx.rotate(-ANGLE);
      ctx.fillStyle = "#2A1810";
      ctx.beginPath();
      ctx.roundRect(-u * 0.7, -u * 0.82, u * 4.4, u * 1.64, u * 0.6);
      ctx.fill();
      ctx.fillStyle = "#E4ECF2";
      ctx.beginPath();
      ctx.roundRect(-u * 0.54, -u * 0.66, u * 4.1, u * 1.32, u * 0.5);
      ctx.fill();
      ctx.fillStyle = "#3B7BD9";
      ctx.beginPath();
      ctx.roundRect(u * 0.5, -u * 0.66, u * 0.8, u * 1.32, u * 0.16);
      ctx.fill();
      ctx.fillStyle = "#FFCC00";
      ctx.beginPath();
      ctx.roundRect(u * 2.9, -u * 0.56, u * 0.9, u * 1.12, u * 0.24);
      ctx.fill();
      ctx.restore();
    });

    // The pumps. Seven of them on a five-frame cadence from frame 21, which is
    // where the reference has the water start; the last two are cut off by the
    // end of a 48-frame uncharged animation, exactly as they are in the
    // original when the move is not charged.
    over(() => {
      ctx.save();
      for (let i = 0; i < 7; i++) {
        const born = 21 + i * 5;
        const age = frame - born;
        if (age < 0 || age > 12) continue;
        // Deterministic per-pump scale in the documented 0.8–1.2 band. Nothing
        // here may call Math.random(): the renderer can be asked to draw the
        // same simulation frame twice, and a glob that resizes between the two
        // flickers.
        const size = 0.8 + 0.4 * (((i * 7) % 5) / 4);
        const px = ox + dir * u * 4.3 * Math.cos(ANGLE) * age;
        const py = oy - u * (4.3 * Math.sin(ANGLE) * age - 0.5 * 0.17 * age * age);
        const fade = Math.min(1, (12 - age) / 4) * alpha;
        // Sized against the windbox, which is radius 4 before the multiplier —
        // nearly a Mario-height across. Drawn any smaller and three globs 21
        // units apart read as a dotted line rather than as a spray, which is
        // the mistake the first pass at this made.
        const r = u * 2.8 * size;
        ctx.globalAlpha = 0.5 * fade;
        glow(ctx, px, py, r * 1.7, "rgba(150,215,255,0.55)", "rgba(96,178,255,0)");
        ctx.globalAlpha = 0.82 * fade;
        ctx.fillStyle = "#8FD0FF";
        // Stretched along its own flight, which is what a thrown blob of water
        // does and what stops seven circles reading as a string of beads.
        ctx.beginPath();
        ctx.ellipse(px, py, r * 1.35, r * 0.88, -ANGLE * dir, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#EAF7FF";
        ctx.beginPath();
        ctx.ellipse(px - dir * r * 0.3, py - r * 0.22, r * 0.6, r * 0.4, -ANGLE * dir, 0, Math.PI * 2);
        ctx.fill();
      }
      // Spatter at the muzzle while it is firing.
      if (frame >= 21) {
        ctx.globalAlpha = 0.45 * alpha;
        ctx.fillStyle = "#EAF6FF";
        for (let i = 0; i < 3; i++) {
          const a = (frame * 0.4 + i * 2.1) % 6.283;
          circle(ctx, ox + Math.cos(a) * u * 0.9, oy + Math.sin(a) * u * 0.9, u * 0.34);
        }
      }
      ctx.restore();
    });
    return NOTHING;
  },
};

/** Painters for this fighter’s own projectiles, keyed by projectile def id. */
export const projectiles: Readonly<Record<string, ProjectilePainter>> = {
  /**
   * The Fireball.
   *
   * It bounces, so it *rolls*: the rotation is on the projectile's own age and
   * has nothing to do with its heading, which is why the context arrives
   * unrotated. Everything that has an orientation — the trail, the ash — is
   * drawn before the rotate and stays in world space; only the ball turns.
   *
   * The lobes are unevenly weighted round the circle on purpose. Five evenly
   * spaced ones read unmistakably as a Super Star.
   */
  fireball: ({ ctx, u, age, dir, frame }) => {
    // Sized against its own hitbox, which is radius 2.6 world units. Drawn at
    // 1.5 it was visibly smaller than the thing it hits with, which is the
    // wrong way round for a projectile — a player should never be caught by a
    // fireball that looked like it went past.
    const r = u * 1.9;
    const puff = frame * 0.5;

    ctx.save();

    // Ash and smoke, trailing behind and rising.
    for (let i = 1; i <= 2; i++) {
      glow(
        ctx,
        -dir * r * (1.9 + i * 0.85),
        -r * (0.5 + i * 0.4) + r * 0.12 * Math.sin(puff + i * 1.7),
        r * (0.44 + i * 0.16),
        `rgba(66, 42, 30, ${(0.3 - i * 0.09).toFixed(2)})`,
        `rgba(74, 50, 38, ${(0.16 - i * 0.05).toFixed(2)})`,
      );
    }

    // The heat it throws. Before the trail, or it washes the flame out.
    glow(ctx, -dir * r * 0.1, 0, r * 1.75, "rgba(255,168,60,0.5)", "rgba(255,84,18,0.2)");

    for (let i = 0; i < 3; i++) {
      const lift = (i - 1) * 0.42;
      const len = r * (0.85 + 0.38 * Math.sin(puff + i * 2.1));
      const g = ctx.createLinearGradient(
        -dir * r * 0.85,
        0,
        -dir * (r * 0.85 + len),
        lift * r - len * 0.5,
      );
      g.addColorStop(0, "rgba(255,230,148,0.82)");
      g.addColorStop(0.4, "rgba(250,128,28,0.5)");
      g.addColorStop(1, "rgba(200,44,14,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-dir * r * 0.3, lift * r - r * 0.3);
      ctx.quadraticCurveTo(
        -dir * (r * 0.8 + len * 0.55),
        lift * r - r * 0.36 - len * 0.3,
        -dir * (r * 0.85 + len),
        lift * r - len * 0.5,
      );
      ctx.quadraticCurveTo(
        -dir * (r * 0.8 + len * 0.45),
        lift * r + r * 0.24,
        -dir * r * 0.3,
        lift * r + r * 0.3,
      );
      ctx.closePath();
      ctx.fill();
    }

    ctx.rotate(age * 0.3 * dir);

    ctx.beginPath();
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const tongue = Math.max(0, Math.sin(5 * a + puff * 0.3));
      const amp = 0.22 * (0.45 + 0.55 * Math.cos(2 * a + 1.3));
      const w = r * (1 + amp * tongue ** 1.5);
      const px = Math.cos(a) * w;
      const py = Math.sin(a) * w;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    const body = ctx.createRadialGradient(-r * 0.24, -r * 0.26, r * 0.04, 0, 0, r * 1.16);
    body.addColorStop(0, "#FFF4D2");
    body.addColorStop(0.28, "#FFC42E");
    body.addColorStop(0.66, "#F26212");
    body.addColorStop(1, "#C9280C");
    ctx.fillStyle = body;
    ctx.fill();
    ctx.clip();

    // A lit side and a shaded side orbiting inside the outline. Without them a
    // spinning fireball and a still one are the same picture.
    const hot = ctx.createRadialGradient(-r * 0.36, -r * 0.36, 0, -r * 0.36, -r * 0.36, r * 0.72);
    hot.addColorStop(0, "rgba(255,255,244,1)");
    hot.addColorStop(0.42, "rgba(255,222,124,0.6)");
    hot.addColorStop(1, "rgba(255,160,50,0)");
    ctx.fillStyle = hot;
    circle(ctx, -r * 0.36, -r * 0.36, r * 0.72);

    const cool = ctx.createRadialGradient(r * 0.5, r * 0.48, 0, r * 0.5, r * 0.48, r * 0.95);
    cool.addColorStop(0, "rgba(146,24,8,0.62)");
    cool.addColorStop(1, "rgba(176,44,12,0)");
    ctx.fillStyle = cool;
    circle(ctx, r * 0.5, r * 0.48, r * 0.95);

    ctx.restore();
  },
};
