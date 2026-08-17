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
    // Generated from `src/adapters/db/schema.sql` by `scripts/build-schema.mjs`.
    "src/adapters/db/schema.generated.ts",
  ]),

  {
    rules: {
      /**
       * A leading underscore means "deliberately unused".
       *
       * The case that forced this: `FilesystemBlobStore.signedUrl()` has
       * nothing to sign, but declaring it zero-arity would have satisfied the
       * `BlobStore` interface structurally while making the concrete class a
       * different API from the port — a caller holding the class could not
       * pass the arguments the interface promises. Naming and ignoring the
       * parameters is the correct shape, and the linter should not argue with
       * it.
       *
       * `caughtErrors: "all"` is kept from the default: an ignored `catch`
       * binding is usually a swallowed error, which is worth hearing about.
       */
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
]);

export default eslintConfig;
