import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Recursively collects every `.ts`/`.tsx` file under `root`. */
export function walkTsFiles(root: string): string[] {
  const results: string[] = [];

  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...walkTsFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      results.push(full);
    }
  }

  return results;
}
