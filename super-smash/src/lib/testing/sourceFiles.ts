import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * `src/`, from the working directory, for the reason layering.test.ts gives:
 * vitest serves files over http: under jsdom and `fileURLToPath` refuses it.
 * Vitest always runs from the project root.
 */
export const SRC_DIR = join(process.cwd(), "src");

/**
 * Every non-test `.ts`/`.tsx` file under `dir`, for tests that scan the source
 * for a string. Test files are left out because they quote what they forbid.
 */
export function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}
