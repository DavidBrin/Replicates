import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Build-check, not a unit test: it inspects the compiled output of
 * `pnpm run build`, so it's a no-op unless BUILD_CHECK is set, and it will
 * fail (missing `.next/`) if that build hasn't run first. Usage:
 *
 *   pnpm run build && BUILD_CHECK=1 pnpm run test -- src/lib/__tests__/bundle.build.test.ts
 *
 * Guards finding 3 (client bundle carrying every article's JSX): SearchBox
 * is a client component that imports `searchTitles` from `@/lib/registry`.
 * Before the fix, that pulled in `@/content/articles` — the full article
 * body map — via `getArticle`'s static import living in the same module,
 * inflating SearchBox's client chunk by every article's JSX (~82KB). After
 * the fix, `searchTitles`/`articleExists`/`allArticles`/`randomSlug` read
 * only `src/content/articles/meta.ts` (metadata, no bodies), so a distinctive
 * phrase that appears *only* inside an article body — never in metadata or
 * any client component — should never reach a client chunk.
 *
 * One sentinel per article, not just linear.tsx: the earlier version of
 * this test checked a single article's prose, which only proves *that*
 * article's body stays server-only — a regression that leaked, say,
 * dollar-pixels.tsx's body into a client chunk while leaving linear.tsx
 * alone would have passed silently. Each sentinel below is a short, verbatim
 * substring pulled from that article's body prose (never from its meta,
 * never from any chrome component — see the companion "sentinels are
 * present in their own article" describe block, which double-checks that
 * claim against the source so a reworded article fails loudly here rather
 * than quietly stops proving anything).
 */
const ARTICLE_SENTINELS: Record<string, string> = {
  "bet.tsx": "property-based tests written with fast-check that check pricing",
  "davids-internet.tsx": "14-task plan with an implementer, an independent reviewer, and a",
  "dollar-pixels.tsx": "hit-testing when a visitor clicks a block",
  "fake-phone.tsx": "capping usable ring time at 60 seconds",
  "linear.tsx": "hand-transcribed 416-case test matrix",
  "notion.tsx": "seven-day eviction policy",
  "super-smash.tsx": "The game simulation runs in Q12",
  "youtube.tsx": "3,086 leave-one-out fingerprint pairs",
  "verilog.tsx": "eight add-compare-select units race down the trellis",
  "nocturnal.tsx": "four-layer Ganglion rework with 140 footprints",
  "signals.tsx": "echo poles walk toward the unit circle",
  "quantum.tsx": "Grover reflects every amplitude about the mean",
  "hardhack.tsx": "three consecutive readings under twelve centimetres",
  "esp32.tsx": "model whose kernels match TensorFlow Lite integer arithmetic",
  "organoids.tsx": "FOOOF draws the aperiodic fit then the peaks",
  "spikes.tsx": "two skewed Gaussians reach r-squared of 0.999",
  "vision.tsx": "a draggable light relights the recovered face",
  "arxiv.tsx": "modularity peaked at tau 0.19 and the team shipped 0.27",
  "crossteach.tsx": "pseudo-labels cross the resolution gap",
  "p300.tsx": "100 milliseconds on and 75 milliseconds off",
  "sql.tsx": "sql.js runs SQLite compiled to WebAssembly",
  "modeling.tsx": "VEXcode VR programs execute against a ported drivetrain",
  "earlycode.tsx": "Aho-Corasick automaton grows its trie",
  "fl-studio.tsx": "Channel Rack step is a Note of length zero",
  "art-wall.tsx": "hostname stopped resolving",
};

describe("sentinels are present in their own article", () => {
  const articlesDir = path.join(process.cwd(), "src", "content", "articles");

  it.each(Object.entries(ARTICLE_SENTINELS))(
    "%s contains its own sentinel verbatim",
    (file, sentinel) => {
      const source = readFileSync(path.join(articlesDir, file), "utf-8");
      expect(
        source.includes(sentinel),
        `expected ${file} to contain the sentinel "${sentinel}" verbatim — ` +
          "if the prose was reworded, update ARTICLE_SENTINELS in this file " +
          "to a new verbatim phrase from the article body, so the bundle " +
          "guard below keeps checking real content instead of silently " +
          "checking nothing",
      ).toBe(true);
    },
  );
});

it.skipIf(!process.env.BUILD_CHECK)(
  "no client chunk contains any article's body-only prose sentinel",
  () => {
    const chunkDir = path.join(process.cwd(), ".next", "static", "chunks");
    expect(
      existsSync(chunkDir),
      "run `pnpm run build` before `BUILD_CHECK=1 pnpm run test`",
    ).toBe(true);

    const jsFiles = readdirSync(chunkDir, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith(".js"));
    expect(jsFiles.length).toBeGreaterThan(0);

    const chunkContents = jsFiles.map((file) => ({
      file,
      contents: readFileSync(path.join(chunkDir, file), "utf-8"),
    }));

    const offendersBySentinel = Object.entries(ARTICLE_SENTINELS).flatMap(
      ([articleFile, sentinel]) => {
        const offenders = chunkContents
          .filter(({ contents }) => contents.includes(sentinel))
          .map(({ file }) => file);
        return offenders.length > 0 ? [`${articleFile} ("${sentinel}") in: ${offenders.join(", ")}`] : [];
      },
    );

    expect(offendersBySentinel, `article-body prose leaked into client chunk(s): ${offendersBySentinel.join(" | ")}`).toEqual(
      [],
    );
  },
);
