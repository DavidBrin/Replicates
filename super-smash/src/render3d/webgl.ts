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
 * A page's WebGL check: whether a scratch canvas gives a WebGL 2 context, the
 * kind three.js's renderer asks for (it dropped WebGL 1 in r163). A browser
 * that refuses, or throws for asking, cannot draw the 3D world.
 *
 * It asks the browser once and remembers the answer, yes or no, for the page's
 * life: a browser caps the live WebGL contexts a page may hold, and without
 * `WEBGL_lose_context` a probe's context cannot be given back, so asking on
 * every Create or Join used one up each time (codex confirm pass, P3: with a
 * cap of two, the third check said no). One check makes one canvas and one
 * context, given back when the extension is there. An answer that changes
 * needs a new page anyway: turning hardware acceleration on restarts the
 * browser.
 */
export function webglCheck(doc?: Document): () => boolean {
  let answer: boolean | undefined;
  return () => {
    if (answer !== undefined) return answer;
    try {
      const gl = (doc ?? document).createElement("canvas").getContext("webgl2");
      answer = gl !== null;
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      answer = false;
    }
    return answer;
  };
}

/** This page's WebGL check (`webglCheck`): the online lobby asks it before every Create and Join. */
export const canDrawWebGL: () => boolean = webglCheck();
