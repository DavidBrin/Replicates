/**
 * fox: what their moves paint on top of the figure.
 *
 * Keyed by move slot. A slot with no entry paints nothing, which is right
 * whenever the move’s whole graphic is its projectile — that is already drawn
 * by `drawProjectiles`, and a second glow on top only muddies it.
 */

import {
  NOTHING,
  glow,
  polygon,
  type FxFn,
} from "../../fxKit";
import { withAlpha } from "../../rigKit";
import type { MoveSlot } from "@/engine/types";
import type { ProjectilePainter } from "../../fxKit";

/**
 * Where the pistol sits, in rig units forward of and above his feet.
 *
 * Taken off the pose in `poses.ts` rather than invented: the hand is at the
 * holster at (1.2, 4.3) on action frame 3 and locked out at (4.1, 7.0) on
 * action frame 10, and the barrel runs 2.4 units forward of the grip — which
 * puts the muzzle within half a unit of the (7.0, 6.0) the bolt actually
 * spawns at, so the shot leaves the gun rather than leaving his elbow.
 *
 * An effect cannot ask the renderer where a bone ended up — `FxContext` gives
 * it the feet and the scale and nothing else — so this is the one place a
 * duplicated number is unavoidable. Changing the arm angles in `neutralB`
 * without changing these two points is what would break it.
 */
const HOLSTERED = { x: 1.2, y: 4.3 } as const;
const AIMED = { x: 4.1, y: 7.0 } as const;

export const fx: Partial<Record<MoveSlot, FxFn>> = {
  /**
   * Fox, Blaster. The gun itself, because the rig does not carry one.
   *
   * A pistol welded to his hand would be wrong in the twenty-five moves that
   * are not this one — he holsters it, and `rig.ts` draws the holster on his
   * right thigh — so the weapon belongs to the move rather than to the
   * fighter, which is what this layer is for.
   *
   * Effects paint *under* the figure, so the grip disappears behind his hand
   * and the barrel is what shows. That is the right way round: a barrel
   * sticking forward past the fist reads as a drawn pistol at any size, and
   * nothing is lost by the part inside his grip being hidden.
   *
   * `frame` is counted the way the frame data is, so the numbers below are the
   * frame-data ones: the bolt's `spawnFrame` is 11 and that is where the flash
   * goes.
   */
  neutralB: ({ ctx, x, y, u, frame, dir }) => {
    if (frame < 5 || frame > 31) return NOTHING;

    // Track the hand out of the holster.
    //
    // The cube is not decoration. The pose's own span from the holster key to
    // the shot carries `ease: "in"`, which is cubic, so a gun interpolated
    // linearly across the same frames is half way up while the hand is a fifth
    // of the way — and on the first capture the pistol was visibly floating
    // two units in front of the fist through the whole draw. Same span, same
    // curve: `applyEase("in")` is `c³`, and the arm's span runs from action
    // frame 3 to action frame 10, which is frame 4 to frame 11 here.
    const c = Math.min(1, Math.max(0, (frame - 4) / 7));
    const rise = c * c * c;
    const kick = frame >= 11 && frame <= 13 ? (14 - frame) / 3 : 0;
    const gx = HOLSTERED.x + (AIMED.x - HOLSTERED.x) * rise;
    const gy = HOLSTERED.y + (AIMED.y - HOLSTERED.y) * rise + kick * 0.35;
    // Muzzle up while it kicks, level otherwise.
    const tilt = -0.18 + kick * 0.5;

    const hx = x + dir * u * gx;
    const hy = y - u * gy;

    ctx.save();
    ctx.translate(hx, hy);
    ctx.scale(dir, 1);
    ctx.rotate(tilt);

    // Barrel, receiver, under-barrel and grip — four boxes, which at this size
    // is a pistol and anything more detailed is noise. Dark charcoal rather
    // than the steel grey it was: the real weapon is near-black with an orange
    // accent stripe along the upper housing and a lit amber muzzle bezel, and
    // the light bits are the *markings*, not the body.
    ctx.fillStyle = "#31363E";
    ctx.fillRect(0, -u * 0.34, u * 2.45, u * 0.5);
    ctx.fillStyle = "#22262D";
    ctx.fillRect(-u * 0.5, -u * 0.62, u * 1.5, u * 0.95);
    ctx.fillRect(u * 1.9, -u * 0.44, u * 0.62, u * 0.7);
    ctx.fillStyle = "#1A1D23";
    ctx.fillRect(-u * 0.36, u * 0.2, u * 0.72, u * 1.15);
    // The under-barrel with its indicator lamp, and the orange stripe. Between
    // them they are the whole reason this reads as a Star Fox sidearm at eight
    // pixels rather than as a revolver.
    ctx.fillRect(u * 0.3, u * 0.08, u * 1.5, u * 0.32);
    ctx.fillStyle = "#3FD8FF";
    ctx.fillRect(u * 1.35, u * 0.14, u * 0.34, u * 0.2);
    ctx.fillStyle = "#FF8A2A";
    ctx.fillRect(u * 0.2, -u * 0.56, u * 1.5, u * 0.2);
    ctx.fillRect(u * 2.36, -u * 0.4, u * 0.18, u * 0.62);

    // The muzzle flash, on the frame the bolt leaves and the two after it.
    //
    // Violet, and not the warm amber it was. The real flash is a pair of
    // indigo crescents opening forward around the muzzle with magenta shards
    // through them — a *different* hue from the bolt, which is what stops the
    // flash and the first frames of the shot merging into one orange smear.
    if (kick > 0) {
      ctx.globalCompositeOperation = "lighter";
      glow(ctx, u * 2.7, -u * 0.08, u * 2.8 * kick, withAlpha("#7961FF", kick));
      ctx.strokeStyle = withAlpha("#9E8CFF", kick);
      ctx.lineWidth = Math.max(1.5, u * 0.34 * kick);
      for (const rad of [1.05, 1.65]) {
        ctx.beginPath();
        ctx.arc(u * 2.3, 0, u * rad * (0.6 + 0.5 * kick), -1.15, 1.15);
        ctx.stroke();
      }
      ctx.fillStyle = withAlpha("#FF6ED2", kick);
      for (const a of [-0.62, -0.2, 0.2, 0.62]) {
        ctx.beginPath();
        ctx.moveTo(u * 2.4, -u * 0.16);
        ctx.lineTo(u * (2.4 + 2.6 * kick * Math.cos(a)), u * 2.6 * kick * Math.sin(a));
        ctx.lineTo(u * 2.4, u * 0.16);
        ctx.closePath();
        ctx.fill();
      }
      glow(ctx, u * 2.5, 0, u * 1.1 * kick, withAlpha("#FFFFFF", kick));
    }
    ctx.restore();
    return NOTHING;
  },

  /**
   * Fox, Reflector. A hexagon is the single most recognisable shape in his
   * whole moveset.
   *
   * Two things changed here after checking it against the move rather than
   * against the previous drawing.
   *
   * **It surrounds him.** SmashWiki: "Activates his Reflector, surrounding
   * himself with a blue hexagonal energy field." It was drawn 3.4 units out to
   * his front, which is a shield *held* rather than a field he is inside, and
   * it is also a worse read: a hexagon centred on the fighter is unmistakable
   * at any size, and one floating beside him looks like a projectile.
   *
   * **It is honest about its window.** The file's own comment already claimed
   * the hexagon is on screen "for exactly the frames the reflector is out",
   * and it was not — it ran from frame 1 to `total - 6`, thirty frames, when
   * the thing reflects on frames 4 to 23. The whole value of drawing it is
   * telling the opponent when it is safe to throw something, so a field that
   * outlives its own reflect window is worse than no field.
   *
   * It pops in oversize on frame 3 (the hitbox frame), settles over two
   * frames, holds, and snaps out on 23 rather than fading — the shine ends
   * abruptly and the graphic should too.
   *
   * ## Three things reference corrected on the second pass
   *
   * **It does not spin.** The first drawing rotated the hexagon at 0.18 rad a
   * frame and counter-rotated an inner one, plus three scan lines crawling up
   * it. The real field snaps into place and *holds* — which is not a detail,
   * because the whole job of the graphic is to say "this is up, for exactly
   * these frames", and a field that visibly churns is telling the eye it is
   * doing something continuous. All of that is gone.
   *
   * **It is pointy-top.** Vertices at top and bottom, flat vertical edges left
   * and right; `polygon` puts its first vertex at angle 0, so the orientation
   * is a fixed `-PI/2` and never a function of the frame. A flat-top hexagon is
   * a different shape at a glance and this one is his logo.
   *
   * **There is a device, and it flares.** The Reflector is a hexagonal puck
   * that hovers at his chest, and in every capture of the move the brightest
   * thing inside the field is a white four-point star on it. It is the detail
   * that stops the field reading as a bubble that happened to appear.
   */
  downB: ({ ctx, x, y, u, frame, over }) => {
    // Frame 3 is the hitbox; 4 to 23 is the reflect window; the two frames
    // after are the dispel.
    if (frame < 3 || frame > 25) return NOTHING;
    const pop = frame <= 5 ? (6 - frame) / 3 : 0;
    const out = frame > 23 ? (frame - 23) / 3 : 0;
    const cx = x;
    const cy = y - u * 5.5;
    // Half again his standing height, which is what "surrounding himself" means
    // and what the real field measures. At the 6.0 it was, the hexagon was only
    // a fifth taller than he is and his boots stuck out of the bottom of it.
    const r = u * 7.2 * (1 + pop * 0.35 - out * 0.55);
    const alpha = 1 - out;
    // A vertex at the top and the bottom, so the left and right edges are
    // vertical. Constant: the field holds still.
    const UP = -Math.PI / 2;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    glow(ctx, cx, cy, r * 1.25, withAlpha("#1B2FA8", 0.34 * alpha));
    // Saturated blue rather than the pale one it was: under `lighter` a pale
    // blue over a blue sky is nearly invisible, and the field's own band is the
    // most saturated thing in the real move.
    ctx.fillStyle = withAlpha("#1B39D8", 0.30 * alpha);
    polygon(ctx, cx, cy, r, 6, UP);
    ctx.fill();

    // Two rims: a bright edge and a second one just inside it, which is how the
    // real field reads — a band with a lit boundary rather than a flat wash.
    ctx.strokeStyle = withAlpha("#E4F6FF", alpha);
    ctx.lineWidth = Math.max(1.5, u * 0.34);
    polygon(ctx, cx, cy, r, 6, UP);
    ctx.stroke();
    ctx.strokeStyle = withAlpha("#7FD8FF", 0.7 * alpha);
    ctx.lineWidth = Math.max(1, u * 0.16);
    polygon(ctx, cx, cy, r * 0.88, 6, UP);
    ctx.stroke();

    if (pop > 0) glow(ctx, cx, cy, r * 0.8, withAlpha("#FFFFFF", 0.55 * pop));
    ctx.restore();

    // The device at his chest, in front of him — it is a puck he holds out, and
    // behind the body it is nothing at all.
    over(() => {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      // The field's front face, over the body. Without it the hexagon is a
      // decal on the background: a fighter *inside* an energy field is tinted
      // by it, and nothing about the body changed when the shine came up. Low
      // enough to keep his own colours legible, which is the same trade the
      // flame envelope makes on Fire Fox.
      ctx.fillStyle = withAlpha("#2A5CFF", 0.16 * alpha);
      polygon(ctx, cx, cy, r, 6, UP);
      ctx.fill();
      const dx = cx;
      const dy = cy + u * 0.4;
      const s = u * 1.15;
      ctx.fillStyle = withAlpha("#9FE6FF", 0.85 * alpha);
      polygon(ctx, dx, dy, s, 6, UP);
      ctx.fill();
      glow(ctx, dx, dy, s * 2.4, withAlpha("#FFFFFF", (0.5 + 0.4 * pop) * alpha));
      // The four-point star: two crossed spikes, the brightest thing inside the
      // field and the reason the eye lands on his chest rather than on the rim.
      ctx.fillStyle = withAlpha("#FFFFFF", alpha);
      const long = s * (3.0 + 1.4 * pop);
      const thin = s * 0.22;
      ctx.beginPath();
      ctx.moveTo(dx - long, dy);
      ctx.lineTo(dx, dy - thin);
      ctx.lineTo(dx + long, dy);
      ctx.lineTo(dx, dy + thin);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(dx, dy - long);
      ctx.lineTo(dx + thin, dy);
      ctx.lineTo(dx, dy + long);
      ctx.lineTo(dx - thin, dy);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    });
    return NOTHING;
  },

  /**
   * Fox, Fire Fox. "Engulfs himself in an aura of flame before launching
   * himself in a fiery tackle."
   *
   * Half of this move is painted rather than posed, and it is the half that
   * makes the other half legible: the pose spends nineteen frames in a held
   * coil and then thirty in a rigid straight line, and neither of those is an
   * animation on its own. What sells them is that the coil is *gathering* and
   * the straight line is *on fire*. Without this the recovery reads as a
   * fighter standing to attention for forty-five frames — which is exactly
   * what the first full-length capture of it showed.
   *
   * `frame` is counted the way the frame data is, so these are the frame-data
   * numbers: the charging hitbox is frames 20-32 and the momentum entry fires
   * on frame 20, which is why the ignition is there and not anywhere else.
   */
  upB: ({ ctx, x, y, u, frame, dir, over }) => {
    if (frame < 3 || frame > 82) return NOTHING;
    const core = { x, y: y - u * 5.6 };

    /**
     * The half of the flame he is *inside*.
     *
     * The move is "engulfs himself in an aura of flame", and an effect painted
     * under the fighter cannot show that: everything below was drawn behind
     * him, so the aura was a rim of orange around his outline and the comet was
     * a thin plume leaking out from under his boots. The first full capture of
     * it was a fox standing to attention on a small campfire — which is the
     * exact failure `over` exists for, and the reason it now paints twice.
     *
     * The split is: anything *outside* his silhouette stays behind, where it
     * can be as bright as it likes without hiding him; anything that has to lie
     * across the body goes over at an alpha that leaves him legible inside it.
     * Fire Fox has to read as a fighter *in* a flame, not as a fighter next to
     * one, and a silhouette that vanished into the fire would be the opposite
     * mistake.
     *
     * The callback runs with the canvas state the renderer left rather than the
     * state here, so it saves and restores its own.
     */
    const inFront = (paint: () => void) =>
      over(() => {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        paint();
        ctx.restore();
      });

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // ---- frames 3-19: the gather.
    //
    // **It climbs him from the floor.** Round one drew twenty motes spiralling
    // *inward* on two counter-rotating rings, with the reasoning that "fire
    // converging on him is a charge, fire leaving him is an explosion". It is a
    // good argument and it is not what the move does: in the game a white smoke
    // burst erupts at ground level, flame rises around his legs, and by frame
    // ten he is inside a column standing about twice his own height, licking
    // *upward and outward* the whole way. Nothing about it converges.
    //
    // Which matters beyond accuracy, because a ring of small motes is the one
    // thing that will not read at match scale — the first capture of it was a
    // fox standing in a light drizzle of sparks. A column is one big shape.
    //
    // Nine tongues across his width, each a tapered wedge on its own flicker
    // phase, drawn as three colour bands from the outside in: red at the edges,
    // orange inside that, gold at the heart, which is the ramp the real fire
    // has and the reason it reads as flame rather than as a glow.
    if (frame < 20) {
      const k = (frame - 3) / 17;
      const grow = Math.min(1, k * 1.25);

      /** One flame tongue, rooted on the floor and leaning as it rises. */
      const tongue = (bx: number, w: number, h: number, lean: number, colour: string) => {
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.moveTo(bx - w, y);
        ctx.quadraticCurveTo(bx - w * 0.9, y - h * 0.5, bx + lean, y - h);
        ctx.quadraticCurveTo(bx + w * 0.9, y - h * 0.5, bx + w, y);
        ctx.closePath();
        ctx.fill();
      };

      /**
       * The column, painted once behind him and once — narrower and dimmer —
       * in front. Fire he is standing behind is a backdrop; fire that also
       * passes across his boots and his chest is fire he is *in*, and that is
       * the whole difference between this and a bonfire.
       */
      const column = (scale: number, alpha: number) => {
        for (let i = 0; i < 9; i++) {
          const off = (i - 4) / 4;
          // Tongues near the middle are the tallest, so the column has a shape
          // rather than being a hedge.
          const shoulder = 1 - 0.30 * off * off;
          const flick = 0.80 + 0.34 * Math.sin(frame * 0.55 + i * 2.1);
          const h = u * (3 + 17 * grow) * shoulder * flick * scale;
          // Wide and overlapping. At a third of this width the nine tongues
          // never touched and the column drew a single spire with a picket
          // fence round it — a flame is one mass with a serrated top, so
          // neighbours have to overlap before they read as fire at all.
          const w = u * (2.5 - 0.7 * Math.abs(off)) * scale;
          const band = Math.abs(off) > 0.6 ? "#FF2A24" : Math.abs(off) > 0.25 ? "#FF6531" : "#FFD25A";
          tongue(core.x + off * u * 4.0 * scale, w, h, -off * u * 1.4, withAlpha(band, alpha));
        }
      };

      // The smoke and the root of the fire, at his feet where it starts.
      glow(ctx, core.x, y, u * (3 + 5 * grow), withAlpha("#FFD9A8", 0.30 + 0.34 * grow));
      column(1, 0.50 + 0.26 * grow);
      glow(ctx, core.x, y - u * 4 * grow, u * (2 + 6 * grow), withAlpha("#FF6531", 0.16 + 0.34 * k));
      ctx.restore();

      inFront(() => {
        column(0.62, 0.20 + 0.16 * grow);
        glow(ctx, core.x, core.y, u * (2.0 + 2.2 * k), withAlpha("#FFD25A", 0.12 + 0.26 * k));
      });
      return NOTHING;
    }

    // ---- frame 20-23: ignition. A ring leaving him at speed, plus a flash.
    if (frame <= 23) {
      const b = (frame - 20) / 3;
      ctx.strokeStyle = withAlpha("#FFF0C0", 1 - b);
      ctx.lineWidth = Math.max(2, u * 1.4 * (1 - b));
      ctx.beginPath();
      ctx.arc(core.x, core.y, u * (2 + 11 * b), 0, Math.PI * 2);
      ctx.stroke();
      glow(ctx, core.x, core.y, u * (9 - 3 * b), withAlpha("#FFF4D0", 0.95 - 0.5 * b));
    }

    // ---- frames 20-72: the comet.
    //
    // The trail streams *opposite the launch*, and the launch is the momentum
    // entry in `fighters/fox.ts`: x 1.3, y 4.3, i.e. up and forward at about
    // 73 degrees. So the tail goes down and back, `dir`-signed so it is behind
    // him whichever way he is facing. The context follows him as he flies, so
    // this stays attached without the effect knowing where he is.
    const life = Math.min(1, (frame - 20) / 52);
    const fade = frame > 72 ? Math.max(0, 1 - (frame - 72) / 8) : 1;
    const tx = -dir * 0.30;
    const ty = 0.96;

    // Eighteen puffs at 1.3 units apart rather than nine at 2.5: at the wider
    // spacing the first capture drew a *string of beads* behind him, because a
    // radial gradient falls off faster than the eye joins two of them up. The
    // rule is that consecutive puffs have to overlap by more than their own
    // radius, and then the same nine-unit plume reads as one continuous flame.
    for (let i = 1; i <= 18; i++) {
      const d = i * u * 1.3;
      const taper = 1 - i / 22;
      const w = u * 3.9 * taper * (0.88 + 0.22 * Math.sin(frame * 0.7 + i * 0.9));
      // Two thirds rather than a half, and the far end stays orange rather
      // than sliding toward brown. Under `lighter` a low-alpha warm colour over
      // a dark blue sky sums to a muddy `#93655` grey — the plume was read as
      // dirty smoke on a review, which for the one graphic that has to say
      // "on fire" is the whole failure.
      const a = fade * 0.66 * taper;
      if (a <= 0) continue;
      glow(
        ctx,
        core.x + tx * d,
        core.y + ty * d,
        Math.max(1, w),
        withAlpha(i < 7 ? "#FFF0B4" : i < 13 ? "#FF9A2E" : "#FF4A16", a),
      );
    }

    // The body of the flame, wrapped round him and stretched along the launch.
    ctx.save();
    ctx.translate(core.x, core.y);
    ctx.rotate(-dir * 0.28);
    ctx.scale(0.72, 1.5);
    glow(ctx, 0, 0, u * 6.0, withAlpha("#FFE9B0", fade * 0.85));
    ctx.restore();
    ctx.restore();

    // The envelope. Six tongues stacked head-to-boot, each licking back toward
    // the launch and each on its own beat off the frame counter, plus a white
    // core at the chest — which is what turns the silhouette from a fox with a
    // bonfire under him into a fox inside a flame.
    //
    // The stack spans `core.y ± 4.4` units rather than starting at the chest
    // and going down: `core` is his middle, so a stack that only descends
    // leaves his head and ears outside the fire, and the head is the part a
    // player is actually looking at.
    inFront(() => {
      ctx.save();
      ctx.translate(core.x, core.y);
      ctx.rotate(-dir * 0.28);
      for (let i = 0; i < 6; i++) {
        const up = u * (4.4 - i * 1.6);
        const flick = 0.84 + 0.28 * Math.sin(frame * 0.62 + i * 1.7);
        glow(
          ctx,
          -dir * u * 0.22 * i,
          -up,
          u * (3.4 - i * 0.18) * flick,
          withAlpha(i < 2 ? "#FFC468" : i < 4 ? "#FFF0C4" : "#FFA23A", fade * (0.50 - i * 0.04)),
        );
      }
      ctx.restore();
      glow(ctx, core.x, core.y, u * 2.6, withAlpha("#FFFFFF", fade * (0.40 + 0.24 * (1 - life))));
    });

    return NOTHING;
  },

  /**
   * Fox, Fox Illusion — the afterimages, which *are* the move. Ultimate's are
   * copies of the model rather than an abstract blur, and blue-tinted; that is
   * where both the colour and the three discrete ghosts come from. Without
   * them a fighter who has silently travelled fifty units is a rendering
   * fault, and with them he is the fastest character in the game.
   *
   * Live from frame 18, where the engine's `momentum` entry launches him, to
   * 32 — a couple of frames past the trailing hitbox — fading over the last
   * six. Everything is `back * something` so it trails the way he came from
   * whichever way he faces, and every wobble is derived from `frame`, so two
   * players watching the same replay see the same trail.
   *
   * Ghost *slabs* rather than translucent copies of the figure: fifteen
   * capsules at 40% alpha on top of fifteen more is mud at this size, and the
   * tapering slab is what the eye actually reads as "he was there a frame ago".
   */
  sideB: ({ ctx, x, y, u, frame, dir }) => {
    if (frame < 18 || frame > 32) return NOTHING;
    const fade = frame <= 26 ? 1 : Math.max(0, 1 - (frame - 26) / 6);
    const back = -dir;
    const mid = y - u * 4.2;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // The wash he is inside: one long taper from his back to well behind him,
    // brightest where he is and gone twenty-six units back.
    const tail = x + back * u * 26;
    const wash = ctx.createLinearGradient(x, mid, tail, mid);
    wash.addColorStop(0, withAlpha("#F4FEFF", fade * 0.5));
    wash.addColorStop(0.45, withAlpha("#31E8FF", fade * 0.22));
    wash.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = wash;
    ctx.beginPath();
    ctx.moveTo(x + back * u * 0.5, mid - u * 3.4);
    ctx.lineTo(tail, mid - u * 0.5);
    ctx.lineTo(tail, mid + u * 0.5);
    ctx.lineTo(x + back * u * 0.5, mid + u * 3.4);
    ctx.closePath();
    ctx.fill();

    // Three of him, further back and fainter each time.
    for (let i = 0; i < 3; i++) {
      const near = u * (2.2 + i * 5.4);
      const far = near + u * (5.0 - i * 0.8);
      const hn = u * (2.9 - i * 0.55);
      const hf = hn * 0.45;
      // Blown out to white rather than tinted blue: the afterimages are copies
      // of the model washed to near-white, and the *cyan* in the move is the
      // speed lines, not the bodies. Tinting the ghosts as well turned the
      // whole move one flat colour and lost the two layers against each other.
      ctx.fillStyle = withAlpha(i === 0 ? "#FFFFFF" : "#E8FBFF", fade * (0.52 - i * 0.15));
      ctx.beginPath();
      ctx.moveTo(x + back * near, mid - hn);
      ctx.lineTo(x + back * far, mid - hf);
      ctx.lineTo(x + back * far, mid + hf);
      ctx.lineTo(x + back * near, mid + hn);
      ctx.closePath();
      ctx.fill();
    }

    // Speed lines at seven heights, each a different length, crawling on a
    // clock taken off the frame number rather than off a random number.
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(1, u * 0.2);
    for (let i = 0; i < 7; i++) {
      const h = 1.2 + i * 1.4;
      const wob = (((frame * 7 + i * 13) % 5) - 2) * u * 0.12;
      const from = u * (1.5 + ((i * 5) % 7));
      const to = from + u * (10 + ((i * 3 + frame) % 6) * 2.4);
      ctx.strokeStyle = withAlpha("#7BF2FF", fade * (0.66 - i * 0.06));
      ctx.beginPath();
      ctx.moveTo(x + back * from, y - u * h + wob);
      ctx.lineTo(x + back * to, y - u * h + wob);
      ctx.stroke();
    }
    ctx.restore();
    return NOTHING;
  },

};

/** Painters for this fighter’s own projectiles, keyed by projectile def id. */
export const projectiles: Readonly<Record<string, ProjectilePainter>> = {
  /**
   * The Blaster bolt.
   *
   * Keyed by the projectile's def id in `fighters/fox.ts`, not by the move.
   * Without a painter it falls through to `paintEnergy`, which is a round
   * orange ball — the same graphic as Samus's Charge Shot and Mario's
   * fireball, and the exact thing this layer exists to stop.
   *
   * It has to read as a *laser*, and what makes something read as a laser is
   * length along its own direction of travel plus a core hotter than its
   * jacket. So: a stretched lozenge with a white centre in a red-orange
   * sheath, plus a tail that tapers off behind. The context arrives translated
   * to the bolt but deliberately not rotated, so the heading is applied here —
   * which is also what keeps it correct for the shots his throws fire off at
   * angles.
   *
   * It travels 5.5 units a frame and lives 22 frames, so it crosses about a
   * third of Final Destination; and it does *not* die on contact, which is why
   * the graphic is drawn at full strength for its whole life rather than
   * fading in the way a spent projectile would.
   */
  blaster: ({ ctx, u, age, heading }) => {
    // A single frame of extra heat as it leaves the muzzle.
    const born = age <= 1 ? 1 : 0;
    // **It grows.** The bolt's own parameters are an initial length of 3 that
    // reaches 11.25 over its travel — it leaves the muzzle as a spark and is a
    // needle by the time it is across the stage, which is most of why the real
    // one reads as travelling rather than as sliding. Held at a constant
    // length it looked like a decal being dragged.
    const grow = Math.min(1, age / 7);
    const len = u * (1.9 + 3.4 * grow + born * 0.8);
    const r = u * (0.40 - 0.08 * grow);

    ctx.save();
    ctx.rotate(heading);
    ctx.globalCompositeOperation = "lighter";

    // The tail: a long, low-alpha taper behind the head, which is what makes a
    // 5.5-units-a-frame projectile look like it is moving in a still frame.
    const tail = ctx.createLinearGradient(0, 0, -len * 2.4, 0);
    tail.addColorStop(0, withAlpha("#F12D93", 0.55));
    tail.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = tail;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(-len * 2.4, 0);
    ctx.lineTo(0, r);
    ctx.closePath();
    ctx.fill();

    // Small and tight. A glow as wide as the bolt is long turns it into a lens
    // flare — which is what the first live capture showed against Battlefield's
    // blue. The bolt has to be longer than its own halo.
    glow(ctx, 0, 0, len * 0.42, withAlpha("#FF5CC0", 0.5 + born * 0.2));

    // The jacket, then the core. Both ellipses stretched along the heading.
    //
    // **Magenta, not orange.** This was a red-orange bolt for a round, which is
    // the colour a laser is assumed to be rather than the colour this one is:
    // sampled off the game's own art it runs white core → pale pink → hot
    // magenta → deep crimson, hue 315-348 with nothing warm in it. Orange also
    // put it in the same family as Mario's fireball and Samus's shot, which is
    // the exact collision this layer exists to prevent.
    ctx.fillStyle = "#FF2BC9";
    ctx.beginPath();
    ctx.ellipse(0, 0, len, r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#F99CCC";
    ctx.beginPath();
    ctx.ellipse(0, 0, len * 0.74, r * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.ellipse(0, 0, len * 0.5, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  },
};
