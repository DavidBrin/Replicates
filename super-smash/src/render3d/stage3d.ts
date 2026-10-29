/**
 * The stage in 3D: one solid per platform, generated from the sim's own
 * platform rectangles (`StageDef.platforms`), so the surface a fighter stands on
 * is the surface the sim lands them on — no art to drift out of step.
 *
 * A main platform is a wall-sided block `HARD_PLATFORM_DEPTH` deep below its
 * top: exactly the solid the sim collides with, so a fighter that is pushed off
 * a wall, or stopped by an underside, is pushed off and stopped by what is drawn
 * (ruling R13). A soft platform is a thin slab: the sim gives it no body, only
 * a top surface to land on. Each is one mesh with vertex colours from the
 * stage's palette (`stagePaintFor`), so a whole stage is one draw call per
 * platform — Battlefield is four.
 *
 * Moving platforms are placed every frame with `platformCentreX`, the sim's own
 * function, rather than the 2D art's float sine, so they never disagree.
 */

import { BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshLambertMaterial } from "three";

import { toFloat } from "@/engine/fixed";
import { HARD_PLATFORM_DEPTH, platformCentreX } from "@/engine/physics";
import type { Platform, StageDef } from "@/engine/types";
import { stagePaintFor } from "@/render/stageArt";

/** A main body is the sim's solid, as deep as the sim makes it (R13). */
export const MAIN_DEPTH = toFloat(HARD_PLATFORM_DEPTH);
/** How thick a soft platform is drawn. UNVERIFIED (cosmetic): the sim gives a soft platform no body. */
export const SOFT_THICKNESS = 1.2;
/** How far a platform reaches toward and away from the camera, in units. UNVERIFIED: by eye. */
export const MAIN_DEPTH_Z = 36;
export const SOFT_DEPTH_Z = 18;

type Rgb = readonly [number, number, number];

function rgb(hex: string): Rgb {
  const c = new Color(hex);
  return [c.r, c.g, c.b];
}

/**
 * A tapered prism centred on x = 0: top face at y = 0 from −half to +half,
 * bottom face at y = −height from −half·taper to +half·taper, ±depthZ/2 deep.
 * Non-indexed so each face carries its own colour and flat normal.
 */
export function prismGeometry(half: number, height: number, taper: number, depthZ: number, top: Rgb, side: Rgb, bottom: Rgb): BufferGeometry {
  const z0 = -depthZ / 2;
  const z1 = depthZ / 2;
  const b = half * taper;
  const P = {
    tlf: [-half, 0, z1], trf: [half, 0, z1], tlb: [-half, 0, z0], trb: [half, 0, z0],
    blf: [-b, -height, z1], brf: [b, -height, z1], blb: [-b, -height, z0], brb: [b, -height, z0],
  } as const;
  const quads: [readonly number[], readonly number[], readonly number[], readonly number[], Rgb][] = [
    [P.tlb, P.tlf, P.trf, P.trb, top],
    [P.tlf, P.blf, P.brf, P.trf, side],
    [P.trb, P.brb, P.blb, P.tlb, side],
    [P.tlb, P.blb, P.blf, P.tlf, side],
    [P.trf, P.brf, P.brb, P.trb, side],
    [P.blf, P.blb, P.brb, P.brf, bottom],
  ];
  const pos: number[] = [];
  const col: number[] = [];
  for (const [a, b2, c, d, colour] of quads) {
    for (const v of [a, b2, c, a, c, d]) {
      pos.push(v[0], v[1], v[2]);
      col.push(...colour);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  g.computeVertexNormals();
  return g;
}

export interface Stage3D {
  readonly group: Group;
  /** Place moving platforms for sim frame `frame`. */
  update(frame: number): void;
  dispose(): void;
}

export function createStage3D(stage: StageDef): Stage3D {
  const paint = stagePaintFor(stage);
  const material = new MeshLambertMaterial({ vertexColors: true });
  const group = new Group();
  group.name = `stage:${stage.id}`;
  const meshes: Mesh[] = [];
  // Only a moving platform is ever placed again, so the per-frame path walks just those.
  const movers: { mesh: Mesh; platform: Platform }[] = [];
  for (const platform of stage.platforms) {
    const half = toFloat(platform.halfWidth);
    const geometry = platform.soft
      ? prismGeometry(half, SOFT_THICKNESS, 1, SOFT_DEPTH_Z, rgb(paint.softEdge), rgb(paint.soft), rgb(paint.soft))
      : prismGeometry(half, MAIN_DEPTH, 1, MAIN_DEPTH_Z, rgb(paint.top), rgb(paint.face), rgb(paint.deep));
    const mesh = new Mesh(geometry, material);
    mesh.position.set(toFloat(platform.x), toFloat(platform.y), 0);
    mesh.receiveShadow = true;
    group.add(mesh);
    meshes.push(mesh);
    if (platform.motion) movers.push({ mesh, platform });
  }
  return {
    group,
    update(frame) {
      for (let i = 0; i < movers.length; i++) {
        const { mesh, platform } = movers[i];
        mesh.position.x = toFloat(platformCentreX(platform, frame));
      }
    },
    dispose() {
      for (const mesh of meshes) mesh.geometry.dispose();
      material.dispose();
      group.clear();
    },
  };
}
