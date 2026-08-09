import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Vite resolves the `@/*` alias from tsconfig natively; no path plugin needed.
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    // jsdom refuses localStorage on an opaque origin (the default
    // "about:blank"), which would make the storage adapters untestable.
    environmentOptions: { jsdom: { url: "http://localhost:3000" } },
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
