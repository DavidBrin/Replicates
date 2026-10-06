/**
 * Reading the TotalRisk SVGs (Tier 1, D37).
 *
 * `sonesson89/TotalRisk` is Unlicense, and its three boards are the only
 * permissively licensed hand-drawn Risk geometry that exists
 * (`research/02-maps-and-fan-code.md` §B.6 approach 1) — the tempting Wikimedia
 * board family is a trap (D38). Each file is one `<path>` per territory, with
 * the territory's display name as its `id`, grouped by continent.
 *
 * Three gotchas, all carried from the research and all handled here:
 *
 *  1. **Attribute order is `d=` before `id=`** in `napoleonMap.svg` and
 *     `worldMapExtended.svg`, and `id=` before `d=` in `worldMap.svg`. So the
 *     parser matches the **element** and then pulls each attribute out
 *     independently, never relying on their order.
 *  2. **`&` arrives HTML-escaped**: `id="Aragon &amp; Castile"`. Eight of
 *     Napoleonic Europe's 59 territories fail to bind without decoding, silently.
 *  3. The files carry decorative `<g id="Seas">` / `<g id="seaPaths">` groups and
 *     label elements, so a path only counts when its decoded id names a
 *     territory the caller is looking for.
 *
 * `<g>` transforms matter too: `worldMap.svg` hangs everything off
 * `<g id="map" transform="matrix(1, 0, 0, 1, 1.76, -4.24)">`, and ignoring it
 * shifts every outline by a couple of units against the declared `viewBox`.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** `[a, b, c, d, e, f]` — the SVG matrix, applied as `x' = a·x + c·y + e`. */
export type Matrix = readonly [number, number, number, number, number, number];
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export interface SvgPath {
  /** The decoded `id`, i.e. the territory's display name. */
  readonly id: string;
  readonly d: string;
  /** The nearest enclosing `<g id="…">`, i.e. the continent in these files. */
  readonly group: string;
  /** The composed transform of every enclosing `<g>`. */
  readonly transform: Matrix;
}

export interface SvgFile {
  readonly viewBox: string;
  readonly paths: readonly SvgPath[];
}

/** The five entities these files actually contain, plus numeric references. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** One attribute off an element's start tag, decoded. Order-independent by construction. */
export function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(tag)
    ?? new RegExp(`\\s${name}\\s*=\\s*'([^']*)'`).exec(tag);
  return match === null ? null : decodeEntities(match[1] as string);
}

export function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/** `matrix(...)`, `translate(...)` and `scale(...)` — the only forms these files use. */
export function parseTransform(value: string | null): Matrix {
  if (value === null) return IDENTITY;
  let out: Matrix = IDENTITY;
  const re = /(matrix|translate|scale)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) {
    const args = (match[2] as string).trim().split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
    if (match[1] === "matrix" && args.length >= 6) {
      out = multiply(out, args.slice(0, 6) as unknown as Matrix);
    } else if (match[1] === "translate" && args.length >= 1) {
      out = multiply(out, [1, 0, 0, 1, args[0] as number, args[1] ?? 0]);
    } else if (match[1] === "scale" && args.length >= 1) {
      out = multiply(out, [args[0] as number, 0, 0, args[1] ?? (args[0] as number), 0, 0]);
    }
  }
  return out;
}

export function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/**
 * Every `<path>` in one SVG, with its decoded id, its nearest `<g id>` and the
 * composed transform of its ancestors.
 *
 * A hand-rolled scan rather than a DOM: the files carry megabytes of embedded
 * base64 fonts and `<style>` blocks, and the only structure that matters is
 * which `<g>` a `<path>` sits in.
 */
export function readSvg(relative: string): SvgFile {
  const text = readFileSync(join(ROOT, relative), "utf8");
  const viewBox = attribute(/<svg\b[^>]*>/.exec(text)?.[0] ?? "", "viewBox") ?? "0 0 1024 643";

  const paths: SvgPath[] = [];
  const stack: { id: string; transform: Matrix }[] = [];
  const tags = /<(\/?)(g|path|svg)\b([^>]*?)(\/?)>/g;
  let match: RegExpExecArray | null;

  while ((match = tags.exec(text)) !== null) {
    const closing = match[1] === "/";
    const tagName = match[2] as string;
    const body = match[3] as string;
    const selfClosing = match[4] === "/";
    const tag = `<${tagName} ${body}>`;

    if (tagName === "g") {
      if (closing) {
        stack.pop();
      } else if (!selfClosing) {
        const parent = stack[stack.length - 1];
        stack.push({
          id: attribute(tag, "id") ?? parent?.id ?? "",
          transform: multiply(parent?.transform ?? IDENTITY, parseTransform(attribute(tag, "transform"))),
        });
      }
      continue;
    }
    if (tagName !== "path" || closing) continue;

    const id = attribute(tag, "id");
    const d = attribute(tag, "d");
    if (id === null || d === null || d.trim() === "") continue;
    const parent = stack[stack.length - 1];
    paths.push({
      id,
      d,
      group: parent?.id ?? "",
      transform: multiply(parent?.transform ?? IDENTITY, parseTransform(attribute(tag, "transform"))),
    });
  }
  return { viewBox, paths };
}

/**
 * Index an SVG's paths by a normalised form of their id, so a graph's territory
 * **name** can find its outline whatever the file's capitalisation,
 * punctuation or accents.
 */
export function indexByName(file: SvgFile): Map<string, SvgPath> {
  const out = new Map<string, SvgPath>();
  for (const path of file.paths) {
    const key = normaliseName(path.id);
    if (key !== "" && !out.has(key)) out.set(key, path);
  }
  return out;
}

/** `"Aragon & Castile"` and `"aragon and castile"` both reduce to `"aragonandcastile"`. */
export function normaliseName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "");
}
