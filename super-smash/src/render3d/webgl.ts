/**
 * Whether this browser can draw the 3D world, and what the player reads when it
 * cannot (Plan 4: a match is drawn only in 3D, D57). Three-free, so a page can
 * ask before it loads three.js: the online lobby asks before it opens or joins
 * a room, so the other player is not left waiting on a match this browser could
 * never draw (part 1 re-review).
 */

/**
 * What the player reads when the page cannot draw the 3D world at all: WebGL
 * switched off, blocked, or missing (final review M1). three's own message
 * ("THREE.WebGLRenderer: Error creating WebGL context.") names nothing a
 * player can do about it.
 */
export const NO_WEBGL = "This browser can't draw the 3D world (WebGL is off or unavailable): turn on hardware acceleration or try another browser.";

/**
 * Whether a scratch canvas gives a WebGL 2 context: the kind three.js's
 * renderer asks for (it dropped WebGL 1 in r163). The context is given back at
 * once (`WEBGL_lose_context`), since a browser caps the live contexts a page
 * may hold. A browser that refuses, or throws for asking, cannot draw it.
 */
export function canDrawWebGL(doc: Document = document): boolean {
  try {
    const gl = doc.createElement("canvas").getContext("webgl2");
    if (gl === null) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}
