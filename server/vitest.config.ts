import { defineConfig } from "vitest/config";

/**
 * The API's test run.
 *
 * Separate from the root config because this half compiles differently: it is
 * CommonJS with decorators, and the DTO tests only mean anything if the
 * decorators actually run — the bug they exist to catch was a *missing*
 * decorator being silently stripped by the validation pipe.
 *
 * esbuild, which Vitest uses, honours `experimentalDecorators` but does not
 * emit `design:type` metadata the way `tsc` does with `emitDecoratorMetadata`.
 * That is fine for what is tested here: class-validator registers its rules
 * from the decorator calls themselves, and the one place this project relies on
 * emitted metadata — `@Type(() => X)` — always passes the type explicitly.
 * A test that needs real metadata would need the Nest compiler, and belongs in
 * an end-to-end run against a booted app instead.
 */
export default defineConfig({
  esbuild: {
    target: "es2022",
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: false,
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**"],
  },
});
