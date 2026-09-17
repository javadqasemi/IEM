import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * The site and dashboard test run.
 *
 * `server/` has its own, because the two halves compile differently — the API
 * is CommonJS with decorators and needs `experimentalDecorators`, which this
 * side neither has nor wants.
 *
 * `environment: "node"` rather than jsdom, deliberately. There is no jsdom in
 * this project and adding one would be a large dependency in service of
 * rendering tests that `renderToStaticMarkup` already covers — see *Verifying a
 * change* in docs/ARCHITECTURE.md, which this complements rather than replaces.
 * A test that genuinely needs a DOM should say so by adding
 * `@vitest-environment` at the top of its own file.
 */
export default defineConfig({
  resolve: {
    // The same `@/*` alias `tsconfig.json` and `vite.config.ts` declare. All
    // three have to agree or a test resolves an import the build does not.
    alias: { "@": resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // `server/` is excluded explicitly: it has its own config and its own
    // node_modules, and picking its tests up here compiles them without
    // decorator support and fails in a way that looks like a broken test.
    exclude: ["node_modules/**", "server/**", "dist/**", "cad/**"],
  },
});
