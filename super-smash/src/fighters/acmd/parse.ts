/**
 * Parser for the decompiled ACMD text in rubendal's SSBU Data Viewer
 * (https://rubendal.github.io/ssbu/data/patch/13.0.1/character/<Name>/data.json).
 *
 * Pure and dependency-free on purpose: `scripts/import-acmd.mjs` imports this
 * file straight from Node (which strips the types), and vitest imports it as
 * ordinary TypeScript. So: no runtime imports, no enums, no path aliases.
 *
 * Numbers stay decimal here. The generated TypeScript turns them into Q12 with
 * `fx()` at module load, exactly as the hand-written fighter files do.
 *
 * Not read: `ATTACK_ABS`, the command a throw's damage and launch are written
 * with. It parses as `unknown`, so no imported throw carries its hit, and
 * every throw sits in the reconcile ratchet as a disagreement (about 51 of
 * `reconcile.allow.json`'s 136 entries) until Plan 5 Task 7 lifts it.
 */

export type RawArgs = Readonly<Record<string, string>>;

export type RawCommand =
  | { readonly op: "frame"; readonly frame: number }
  | { readonly op: "wait"; readonly frames: number }
  | { readonly op: "attack"; readonly args: RawArgs }
  | { readonly op: "catch"; readonly args: RawArgs }
  | { readonly op: "clearAll" }
  | { readonly op: "clear"; readonly id: number }
  | { readonly op: "catchClearAll" }
  | { readonly op: "catchClear"; readonly id: number }
  | { readonly op: "motionRate"; readonly rate: number }
  | { readonly op: "setFlag"; readonly flag: string; readonly on: boolean }
  | { readonly op: "wholeHit"; readonly status: string }
  | { readonly op: "superArmour"; readonly on: boolean }
  | { readonly op: "shieldSetoffMul"; readonly id: number; readonly mul: number }
  | { readonly op: "atkPower"; readonly id: number; readonly damage: number }
  | { readonly op: "generateArticle"; readonly article: string }
  | { readonly op: "reverseLr" }
  | { readonly op: "loop"; readonly count: number; readonly body: readonly RawCommand[] }
  | { readonly op: "unknown"; readonly raw: string };

/** Split `A=1, B=hash40("x"), C=LUA_VOID` into a record, keeping values verbatim. */
export function parseArgs(inner: string): RawArgs {
  const out: Record<string, string> = {};
  for (const part of inner.split(/, (?=[A-Za-z_][A-Za-z_0-9]*=)/)) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

/** `hash40("top")` → `top`; anything else verbatim. */
export function unhash(v: string): string {
  const m = /^hash40\("([^"]*)"\)$/.exec(v);
  return m ? m[1] : v;
}

/** The last comma-separated argument as a number: the bare `frame(0, 12)` spelling. */
function lastNumber(inner: string): number {
  return Number(inner.split(",").pop());
}

export function parseLine(line: string): RawCommand {
  const call = /^([A-Za-z_][A-Za-z_0-9:]*)\((.*)\)$/.exec(line);
  if (!call) return { op: "unknown", raw: line };
  const [, name, inner] = call;
  switch (name) {
    case "frame": {
      // Two spellings in the dump: `frame(Frame=12)` and the bare `frame(0, 12)`.
      const named = parseArgs(inner).Frame;
      const n = named !== undefined ? Number(named) : lastNumber(inner);
      return Number.isFinite(n) ? { op: "frame", frame: n } : { op: "unknown", raw: line };
    }
    case "wait":
      return { op: "wait", frames: Number(parseArgs(inner).Frames) };
    case "ATTACK":
    case "ATTACK_IGNORE_THROW":
      return { op: "attack", args: parseArgs(inner) };
    case "CATCH":
      return { op: "catch", args: parseArgs(inner) };
    case "AttackModule::clear_all":
      return { op: "clearAll" };
    case "AttackModule::clear":
      return { op: "clear", id: Number(parseArgs(inner).ID) };
    case "grab": {
      const [cmd, id] = inner.split(",").map((t) => t.trim());
      if (cmd === "MA_MSC_CMD_GRAB_CLEAR_ALL") return { op: "catchClearAll" };
      if (cmd === "MA_MSC_CMD_GRAB_CLEAR") return { op: "catchClear", id: Number(id) };
      return { op: "unknown", raw: line };
    }
    case "FT_MOTION_RATE": {
      // `FT_MOTION_RATE(FSM=0.9)`, or the bare `FT_MOTION_RATE(0, 0.77)`.
      const named = parseArgs(inner).FSM;
      const r = named !== undefined ? Number(named) : lastNumber(inner);
      return Number.isFinite(r) && r > 0 ? { op: "motionRate", rate: r } : { op: "unknown", raw: line };
    }
    case "WorkModule::on_flag":
      return { op: "setFlag", flag: parseArgs(inner).Flag, on: true };
    case "WorkModule::off_flag":
      return { op: "setFlag", flag: parseArgs(inner).Flag, on: false };
    case "WHOLE_HIT":
      return { op: "wholeHit", status: inner.trim() };
    case "damage": {
      const a = parseArgs(inner);
      if (a.MSC !== "MA_MSC_DAMAGE_DAMAGE_NO_REACTION") return { op: "unknown", raw: line };
      return { op: "superArmour", on: a.Type === "DAMAGE_NO_REACTION_MODE_ALWAYS" };
    }
    case "ATK_SET_SHIELD_SETOFF_MUL": {
      const a = parseArgs(inner);
      return { op: "shieldSetoffMul", id: Number(a.ID), mul: Number(a.ShieldstunMul) };
    }
    case "ATK_POWER": {
      const [id, dmg] = inner.split(",").map((s) => Number(s.trim()));
      return { op: "atkPower", id, damage: dmg };
    }
    case "ArticleModule::generate_article":
      return { op: "generateArticle", article: inner.split(",")[0].trim() };
    case "REVERSE_LR":
      return { op: "reverseLr" };
    default:
      return { op: "unknown", raw: line };
  }
}

/** Where the decompiler starts printing the alternative branch's copy of a script. */
const DUPLICATE_MARKER = "methodlib::L2CValue::operatorbool()const(is_excute)";

/**
 * What the decompiler's duplicate holds beyond the first copy: the commands
 * both copies run after their branch, printed once, at the duplicate's end
 * (Plan 3, Task 18). Mario's up special is the case: both copies end
 * `wait(Frames=2)`, and the `clear_all` after it is printed only in the
 * duplicate, so stopping at the marker left the move's last boxes live forever.
 *
 * The duplicate mirrors the first copy command for command — by op; arguments
 * may differ, as Mario's runs `frame(1)` where the first copy runs `frame(3)` —
 * after whatever the first copy ran before its branch, which may only be engine
 * queries (`unknown`, e.g. `WorkModule::is_flag`). The longest such mirror is
 * taken and the rest of the duplicate is the tail. A duplicate that mirrors no
 * such run is refused: a tail guessed from copies that do not line up would
 * invent commands or lose them.
 *
 * Only some of the corpus's duplicates line up (Plan 3 Task 18's review parsed
 * all 1,429 scripts in the eight cached dumps): Mario's `SpecialHi` and
 * `SpecialAirHi` do, and Donkey Kong's `FinalEnd`, `FinalAirEnd` and
 * `FinalEnd_Com` carry the marker too and are refused below. None of the three
 * is imported (`finalSmash` takes `Final` and `FinalStart`), so nothing breaks
 * today; a plan that imports a final smash's end meets the refusal.
 */
function sharedTail(first: readonly RawCommand[], duplicate: readonly RawCommand[]): RawCommand[] {
  for (let m = Math.min(first.length, duplicate.length); m >= 0; m--) {
    const before = first.slice(0, first.length - m);
    // A shorter mirror only lengthens what comes before it.
    if (!before.every((c) => c.op === "unknown")) break;
    if (first.slice(first.length - m).every((c, k) => c.op === duplicate[k].op)) return duplicate.slice(m);
  }
  throw new Error("the decompiler's duplicate does not mirror the first copy, so its shared tail cannot be told apart");
}

interface Block {
  /** What closes with the next `}`. */
  readonly kind: "excute" | "loop" | "taken" | "skipped";
  readonly count: number;
  readonly body: RawCommand[];
  /** For a conditional: whether its `else{` should be taken. */
  readonly elseTaken: boolean;
}

/**
 * Turn one script's text into commands.
 *
 * Control flow in the decompiled text is resolved here, once, by rule:
 * - `if(is_excute){ … }` is transparent.
 * - `for(N Iterations){ … }` becomes a `loop`.
 * - Any other `if(cond){ … }` is a branch on runtime state the replica does not
 *   model. Its body is taken unless the condition names `FIGHTER_KIND_KIRBY`
 *   (a copy-ability branch), and a following `else{ … }` takes the other side.
 * - A top-level `methodlib::L2CValue::operatorbool()const(is_excute)` marks the
 *   decompiler's duplicate of the alternative branch. The first copy is the
 *   move; of the duplicate, only the tail both copies share is kept
 *   (`sharedTail`).
 */
export function parseScript(text: string): RawCommand[] {
  const root: RawCommand[] = [];
  const stack: Block[] = [];
  let lastClosed: { elseTaken: boolean } | null = null;
  const target = (): RawCommand[] | null => {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i].kind === "skipped") return null;
    return stack.length === 0 ? root : stack[stack.length - 1].body;
  };
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;
    if (line === "}") {
      const b = stack.pop();
      if (b === undefined) continue;
      lastClosed = b.kind === "taken" || b.kind === "skipped" ? { elseTaken: b.elseTaken } : null;
      const out = target();
      if (b.kind === "loop" && out !== null && b.body.length > 0) out.push({ op: "loop", count: b.count, body: b.body });
      else if ((b.kind === "excute" || b.kind === "taken") && out !== null) out.push(...b.body);
      continue;
    }
    if (line === "else{") {
      const taken = lastClosed !== null && lastClosed.elseTaken;
      stack.push({ kind: taken ? "taken" : "skipped", count: 0, body: [], elseTaken: false });
      lastClosed = null;
      continue;
    }
    lastClosed = null;
    if (line === "if(is_excute){") {
      stack.push({ kind: "excute", count: 0, body: [], elseTaken: false });
      continue;
    }
    const loop = /^for\((\d+) Iterations\)\{$/.exec(line);
    if (loop) {
      stack.push({ kind: "loop", count: Number(loop[1]), body: [], elseTaken: false });
      continue;
    }
    if (line.startsWith("if(") && line.endsWith("{")) {
      const kirbyOnly = line.includes("FIGHTER_KIND_KIRBY");
      stack.push({ kind: kirbyOnly ? "skipped" : "taken", count: 0, body: [], elseTaken: kirbyOnly });
      continue;
    }
    if (line.startsWith(DUPLICATE_MARKER) && stack.length === 0) {
      root.push(...sharedTail(root, parseScript(lines.slice(i + 1).join("\n"))));
      break;
    }
    const out = target();
    if (out === null) continue;
    out.push(parseLine(line));
  }
  return root;
}
