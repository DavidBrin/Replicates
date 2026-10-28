/**
 * Import the eight fighters' published `game_` scripts as TypeScript.
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/import-acmd.mjs
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/import-acmd.mjs --offline
 *
 * Sources (published numbers only, DECISIONS D17):
 *   - rubendal's SSBU Data Viewer, patch 13.0.1 — the decompiled `game_` script
 *     text and the `Motions` table:
 *     https://rubendal.github.io/ssbu/data/patch/13.0.1/character/<Name>/data.json
 *   - rubendal's SSBU-Calculator data — that project's own reading of each
 *     script's hitbox windows, used only to self-check our parser:
 *     https://raw.githubusercontent.com/rubendal/SSBU-Calculator/gh-pages/Data/<fighter>/data.json
 *
 * Downloads are cached in $ACMD_CACHE (default node_modules/.cache/import-acmd,
 * never committed). The output, src/fighters/acmd/generated/*.ts, is committed;
 * rerun only to refresh it. Plain Node, no build step: the parser is imported as
 * TypeScript straight from src/ (Node strips the types), which is why
 * `parse.ts` has no runtime imports.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseScript, unhash } from "../src/fighters/acmd/parse.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = process.env.ACMD_CACHE ?? join(ROOT, "node_modules", ".cache", "import-acmd");
const OUT = join(ROOT, "src", "fighters", "acmd", "generated");
const OFFLINE = process.argv.includes("--offline");

const ROSTER = [
  { id: "mario", viewer: "Mario", calc: "mario", constant: "MARIO" },
  { id: "donkeyKong", viewer: "Donkey Kong", calc: "donkey", constant: "DONKEY_KONG" },
  { id: "link", viewer: "Link", calc: "link", constant: "LINK" },
  { id: "samus", viewer: "Samus", calc: "samus", constant: "SAMUS" },
  { id: "kirby", viewer: "Kirby", calc: "kirby", constant: "KIRBY" },
  { id: "fox", viewer: "Fox", calc: "fox", constant: "FOX" },
  { id: "pikachu", viewer: "Pikachu", calc: "pikachu", constant: "PIKACHU" },
  { id: "marth", viewer: "Marth", calc: "marth", constant: "MARTH" },
];

const viewerUrl = (name) =>
  `https://rubendal.github.io/ssbu/data/patch/13.0.1/character/${encodeURIComponent(name)}/data.json`;
const calcUrl = (name) => `https://raw.githubusercontent.com/rubendal/SSBU-Calculator/gh-pages/Data/${name}/data.json`;

/** Script names each slot may use, in preference order. The first one present wins. */
const SLOT_CANDIDATES = {
  jab1: ["Attack11"],
  jab2: ["Attack12"],
  jab3: ["Attack13"],
  rapidJab: ["Attack100"],
  ftilt: ["AttackS3", "AttackS3S"],
  utilt: ["AttackHi3"],
  dtilt: ["AttackLw3"],
  dashAttack: ["AttackDash"],
  fsmash: ["AttackS4", "AttackS4S"],
  usmash: ["AttackHi4"],
  dsmash: ["AttackLw4"],
  nair: ["AttackAirN"],
  fair: ["AttackAirF"],
  bair: ["AttackAirB"],
  uair: ["AttackAirHi"],
  dair: ["AttackAirLw"],
  neutralB: ["SpecialN", "SpecialNStart"],
  sideB: ["SpecialS", "SpecialS1", "SpecialSStart"],
  upB: ["SpecialHi", "SpecialHi1"],
  downB: ["SpecialLw", "SpecialLwStart"],
  grab: ["Catch"],
  dashGrab: ["CatchDash"],
  pummel: ["CatchAttack"],
  fthrow: ["ThrowF"],
  bthrow: ["ThrowB"],
  uthrow: ["ThrowHi"],
  dthrow: ["ThrowLw"],
  ledgeAttack: ["CliffAttack"],
  getUpAttack: ["DownAttackU"],
  finalSmash: ["Final", "FinalStart"],
};

const HIT_STATUS = new Set(["HIT_STATUS_NORMAL", "HIT_STATUS_XLU", "HIT_STATUS_INVINCIBLE", "HIT_STATUS_OFF"]);

async function fetchJson(url, file) {
  const path = join(CACHE, file);
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  if (OFFLINE) throw new Error(`--offline and no cache for ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  const text = await res.text();
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(path, text);
  return JSON.parse(text);
}

const num = (v) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : null;
};
const lit = (v) => JSON.stringify(v);

/*
 * `FT_MOTION_RATE`. The DSL's `motionRate` (src/engine/acmd/dsl.ts) takes a
 * plain decimal of at most six digits after the point, or an exact `[p, q]` of
 * whole numbers up to 10^6, and throws on anything else. A published rate it
 * cannot spell — a float32 print such as 0.3333333 — is written as the best
 * rational approximation with denominator ≤ 1000, marked UNVERIFIED in the
 * generated file, and listed when the import finishes.
 */
const MAX_RATE_DIGITS = 6;
const MAX_RATE_TERM = 1_000_000;
const MAX_APPROX_DEN = BigInt(1000);
const ZERO = BigInt(0);
const TEN = BigInt(10);

/** Every rate the importer had to approximate: `{ fighter, script, published, rate }`. */
const unverified = [];

/** The decimal text of `v` as an exact fraction of BigInts. */
function exactFraction(v) {
  const m = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(v));
  if (!m) throw new Error(`FT_MOTION_RATE ${v} is not a positive decimal`);
  const frac = m[2] ?? "";
  const exp = Number(m[3] ?? 0);
  let n = BigInt(m[1] + frac);
  let d = TEN ** BigInt(frac.length);
  if (exp > 0) n *= TEN ** BigInt(exp);
  else d *= TEN ** BigInt(-exp);
  return [n, d];
}

function gcd(a, b) {
  while (b !== ZERO) [a, b] = [b, a % b];
  return a;
}

/** Whether the DSL's `decimalRatio` takes `v` as it is (mirrors its rule: no exponent, ≤ 6 decimals, terms ≤ 10^6). */
function isShortDecimal(v) {
  const text = String(v);
  const dot = text.indexOf(".");
  const digits = dot < 0 ? 0 : text.length - dot - 1;
  if (/e/i.test(text) || digits > MAX_RATE_DIGITS) return false;
  const [n, d] = exactFraction(v);
  const g = gcd(n, d);
  const limit = BigInt(MAX_RATE_TERM);
  return n / g <= limit && d / g <= limit;
}

/**
 * The fraction p/q closest to `v` with q ≤ `MAX_APPROX_DEN`: continued-fraction
 * convergents, then the one semiconvergent that can beat the last of them
 * (the method of Python's `Fraction.limit_denominator`), in exact arithmetic.
 */
function bestRational(v) {
  const [n0, d0] = exactFraction(v);
  let [p0, q0, p1, q1] = [ZERO, BigInt(1), BigInt(1), ZERO];
  let [n, d] = [n0, d0];
  while (d !== ZERO) {
    const a = n / d;
    const q2 = q0 + a * q1;
    if (q2 > MAX_APPROX_DEN) break;
    [p0, q0, p1, q1] = [p1, q1, p0 + a * p1, q2];
    [n, d] = [d, n - a * d];
  }
  if (d === ZERO) return [p1, q1];
  const k = (MAX_APPROX_DEN - q0) / q1;
  const [ps, qs] = [p0 + k * p1, q0 + k * q1];
  // |p/q − n0/d0| compared as |p·d0 − n0·q| / (q·d0), cross-multiplied.
  const err = (p, q) => {
    const e = p * d0 - n0 * q;
    return e < ZERO ? -e : e;
  };
  return err(p1, q1) * qs <= err(ps, qs) * q1 ? [p1, q1] : [ps, qs];
}

/** A `motionRate(...)` call for a published FSM, recording any approximation against `where`. */
function motionRateCall(rate, where) {
  if (isShortDecimal(rate)) return `motionRate(${rate})`;
  const [p, q] = bestRational(rate).map(Number);
  if (p < 1 || p > MAX_RATE_TERM) {
    throw new Error(`FT_MOTION_RATE ${rate} in ${where.fighter} ${where.script} has no [p, q] the DSL takes with q ≤ 1000`);
  }
  unverified.push({ ...where, published: String(rate), rate: `[${p}, ${q}]` });
  return `/* UNVERIFIED: published FSM=${rate}, nearest fraction with denominator ≤ 1000 */ motionRate([${p}, ${q}])`;
}

/** An `ATTACK(...)` argument list as an `AttackSpec` literal, defaults omitted. */
function attackSpec(a) {
  const parts = [`id: ${num(a.ID)}`];
  if (num(a.Part)) parts.push(`part: ${num(a.Part)}`);
  parts.push(`bone: ${lit(unhash(a.Bone))}`);
  for (const [key, field] of [
    ["damage", "Damage"],
    ["angle", "Angle"],
    ["kbg", "KBG"],
  ]) {
    parts.push(`${key}: ${num(a[field]) ?? 0}`);
  }
  if (num(a.FKB)) parts.push(`fkb: ${num(a.FKB)}`);
  parts.push(`bkb: ${num(a.BKB) ?? 0}`, `size: ${num(a.Size) ?? 0}`);
  for (const k of ["X", "Y", "Z"]) parts.push(`${k.toLowerCase()}: ${num(a[k]) ?? 0}`);
  for (const k of ["X2", "Y2", "Z2"]) if (num(a[k]) !== null) parts.push(`${k.toLowerCase()}: ${num(a[k])}`);
  if (num(a.Hitlag) !== null && num(a.Hitlag) !== 1) parts.push(`hitlag: ${num(a.Hitlag)}`);
  if (num(a.SDI) !== null && num(a.SDI) !== 1) parts.push(`sdi: ${num(a.SDI)}`);
  if (a.Clang_Rebound && a.Clang_Rebound !== "ATTACK_SETOFF_KIND_ON") parts.push(`clang: ${lit(a.Clang_Rebound)}`);
  if (a.FacingRestrict && a.FacingRestrict !== "ATTACK_LR_CHECK_F") parts.push(`facing: ${lit(a.FacingRestrict)}`);
  if (a.SetWeight === "true") parts.push("setWeight: true");
  if (num(a.ShieldDamage)) parts.push(`shieldDamage: ${num(a.ShieldDamage)}`);
  if (num(a.Trip)) parts.push(`trip: ${num(a.Trip)}`);
  if (num(a.Rehit)) parts.push(`rehit: ${num(a.Rehit)}`);
  for (const [key, field] of [
    ["reflectable", "Reflectable"],
    ["absorbable", "Absorbable"],
    ["flinchless", "Flinchless"],
    ["noHitlag", "DisableHitlag"],
  ]) {
    if (a[field] === "true") parts.push(`${key}: true`);
  }
  if (a.Direct_Hitbox === "false") parts.push("direct: false");
  if (a.Ground_or_Air && a.Ground_or_Air !== "COLLISION_SITUATION_MASK_GA") parts.push(`situation: ${lit(a.Ground_or_Air)}`);
  const attr = a.Effect ? unhash(a.Effect) : "collision_attr_normal";
  if (attr !== "collision_attr_normal") parts.push(`collisionAttr: ${lit(attr)}`);
  if (a.Type) parts.push(`region: ${lit(a.Type)}`);
  return `{ ${parts.join(", ")} }`;
}

function catchSpec(a) {
  const parts = [`id: ${num(a.ID)}`, `bone: ${lit(unhash(a.Bone))}`, `size: ${num(a.Size) ?? 0}`];
  for (const k of ["X", "Y", "Z"]) parts.push(`${k.toLowerCase()}: ${num(a[k]) ?? 0}`);
  for (const k of ["X2", "Y2", "Z2"]) if (num(a[k]) !== null) parts.push(`${k.toLowerCase()}: ${num(a[k])}`);
  if (a.Status) parts.push(`status: ${lit(a.Status)}`);
  if (a.Ground_or_Air) parts.push(`situation: ${lit(a.Ground_or_Air)}`);
  return `{ ${parts.join(", ")} }`;
}

/** One parsed command as DSL source, recording which builders it used. `where` names the script, for UNVERIFIED notes. */
function emit(c, used, indent, where) {
  const u = (name) => (used.add(name), name);
  switch (c.op) {
    case "frame":
      return `${u("frame")}(${c.frame})`;
    case "wait":
      return `${u("wait")}(${c.frames})`;
    case "attack":
      return `${u("ATTACK")}(${attackSpec(c.args)})`;
    case "catch":
      return `${u("CATCH")}(${catchSpec(c.args)})`;
    case "clearAll":
      return `${u("clearAll")}()`;
    case "clear":
      return `${u("clear")}(${c.id})`;
    case "catchClearAll":
      return `${u("catchClearAll")}()`;
    case "catchClear":
      return `${u("catchClear")}(${c.id})`;
    case "motionRate":
      used.add("motionRate");
      return motionRateCall(c.rate, where);
    case "setFlag":
      return `${u("setFlag")}(${lit(c.flag)}${c.on ? "" : ", false"})`;
    case "wholeHit":
      return HIT_STATUS.has(c.status)
        ? `${u("wholeHit")}(${lit(c.status)})`
        : `${u("unknown")}(${lit(`WHOLE_HIT(${c.status})`)})`;
    case "superArmour":
      return `${u("superArmour")}(${c.on})`;
    case "shieldSetoffMul":
      return `${u("shieldSetoffMul")}(${c.id}, ${c.mul})`;
    case "atkPower":
      return `${u("atkPower")}(${c.id}, ${c.damage})`;
    case "reverseLr":
      return `${u("reverseLr")}()`;
    case "generateArticle":
      return `${u("unknown")}(${lit(`ArticleModule::generate_article(${c.article})`)})`;
    case "loop": {
      const pad = " ".repeat(indent + 2);
      const body = c.body.map((b) => `${pad}${emit(b, used, indent + 2, where)},`).join("\n");
      return `${u("loop")}(${c.count}, [\n${body}\n${" ".repeat(indent)}])`;
    }
    default:
      return `${u("unknown")}(${lit(c.raw)})`;
  }
}

/** Motion kind and first actionable frame for a script, from the viewer's `Motions` tables. */
function motionOf(viewer, scriptName) {
  const hash = `game_${scriptName.toLowerCase()}`;
  for (const group of Object.values(viewer.Motions)) {
    for (const m of Object.values(group)) {
      if (m.GameHash === hash) return { kind: m.MotionKind, faf: m.CancelFrame };
    }
  }
  return { kind: scriptName.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase(), faf: 0 };
}

async function importFighter(f) {
  const viewer = await fetchJson(viewerUrl(f.viewer), `viewer-${f.id}.json`);
  const calc = await fetchJson(calcUrl(f.calc), `calc-${f.id}.json`);
  const texts = new Map(viewer.Scripts[viewer.GameName].map((s) => [s.Name, s.Data]));

  const slots = {};
  const scripts = [];
  const faf = {};
  const used = new Set(["script"]);
  for (const [slot, candidates] of Object.entries(SLOT_CANDIDATES)) {
    const name = candidates.find((c) => texts.has(c));
    if (name === undefined) continue;
    const key = `game_${name.toLowerCase()}`;
    slots[slot] = key;
    if (scripts.some((s) => s.key === key)) continue;
    const { kind, faf: cancel } = motionOf(viewer, name);
    if (cancel > 0) faf[key] = cancel;
    const where = { fighter: f.id, script: key };
    const body = parseScript(texts.get(name))
      .map((c) => `      ${emit(c, used, 6, where)},`)
      .join("\n");
    scripts.push({ key, source: `    ${key}: script(${lit(key)}, ${lit(kind)}, [\n${body}\n    ]),` });
  }

  const windows = {};
  const wanted = new Set(Object.values(slots));
  for (const t of calc.MoveTypes) {
    for (const m of t.Moves) {
      for (const h of m.Hitboxes) {
        const key = h.Script.toLowerCase();
        if (h.Article !== viewer.GameName || !wanted.has(key)) continue;
        (windows[key] ??= []).push(`[${Number(h.Id)}, ${h.StartFrame}, ${h.EndFrame === 0 ? -1 : h.EndFrame - 1}]`);
      }
    }
  }

  const lines = [
    "// GENERATED by scripts/import-acmd.mjs — do not edit by hand.",
    `// Scripts and motions: ${viewerUrl(f.viewer)}`,
    `// Calculator windows: ${calcUrl(f.calc)}`,
    "",
    "import {",
    ...[...used].sort().map((name) => `  ${name},`),
    '} from "@/engine/acmd/dsl";',
    'import type { ReferenceFighter } from "../reference";',
    "",
    `export const ${f.constant}: ReferenceFighter = {`,
    `  fighter: ${lit(f.id)},`,
    "  slots: {",
    ...Object.entries(slots).map(([slot, key]) => `    ${slot}: ${lit(key)},`),
    "  },",
    "  scripts: {",
    ...scripts.map((s) => s.source),
    "  },",
    "  faf: {",
    ...Object.entries(faf).map(([key, frame]) => `    ${key}: ${frame},`),
    "  },",
    "  calculatorWindows: {",
    ...Object.entries(windows).map(([k, w]) => `    ${k}: [${w.join(", ")}],`),
    "  },",
    "};",
    "",
  ];
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${f.id}.ts`), lines.join("\n"));
  return { id: f.id, scripts: scripts.length };
}

for (const f of ROSTER) {
  const r = await importFighter(f);
  console.log(`${r.id}: ${r.scripts} scripts`);
}
for (const v of unverified) {
  console.log(`UNVERIFIED: ${v.fighter} ${v.script} FT_MOTION_RATE ${v.published} written as ${v.rate}`);
}
if (unverified.length > 0) console.log(`${unverified.length} FT_MOTION_RATE value(s) approximated (UNVERIFIED)`);
