import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  resolve: {
    alias: {
      // `server-only`'s default export is a bare `throw`; only a `react-server`
      // export condition resolves it to an empty module. Vitest uses neither,
      // so every module that guards itself with it — the container, the auth
      // adapter, the Stripe adapter — would be untestable. Aliasing it to a
      // no-op keeps the guard real in the build and inert in tests.
      // `fileURLToPath`, not `URL.pathname` — this repo lives under a
      // directory with a space in its name, which `pathname` percent-encodes
      // into a path that does not exist.
      "server-only": fileURLToPath(
        new URL("./test-support/server-only-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
