import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Playwright artifacts
    "playwright-report/**",
    "test-results/**",
    ".wrangler/**",
    // Plan 4's git-ignored model pipeline: the fetched cache (with its tool
    // installs) and the exported models are not our code.
    ".model-cache/**",
    "public/models/**",
  ]),
]);

export default eslintConfig;
