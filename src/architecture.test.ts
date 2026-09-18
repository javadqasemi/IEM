import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The layering, enforced.
 *
 * Every rule below is written down in a README or in
 * `docs/enterprise-architecture.md`, and a rule that is only written down is a
 * rule that holds until someone is in a hurry. These are the four that cost
 * the most to repair later, so they are checked rather than reviewed:
 *
 *   1. A DTO type stops at the mapper.
 *   2. A feature does not import another feature.
 *   3. Nothing reaches past a feature's `index.ts`.
 *   4. An arrow never points upwards: `shared` and `core` know nothing above them.
 *
 * The firm's review set the reference-implementation gate — five layers, one
 * feature, fully tested, before a second copies the shape — and rule 1 is the
 * half of it that cannot be verified by reading the reference. The mapper is
 * only a seam if nothing routes around it.
 */

const SRC = resolve(__dirname);

function sources(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

const rel = (file: string) => `src/${relative(SRC, file).replace(/\\/g, "/")}`;
const read = (file: string) => readFileSync(file, "utf8");

/**
 * Every module specifier in a file.
 *
 * Three forms, and the third is the one a narrower regex misses: `from "…"`
 * covers static imports and re-exports, `import("…")` covers the lazy route
 * table, and a bare `import "…";` covers a side-effect import — which is
 * exactly how a stylesheet or a polyfill would reach across a boundary without
 * naming anything. A first draft of this checked only the first two, and a
 * deliberately planted violation passed.
 */
function importsOf(file: string): string[] {
  const text = read(file);
  return [
    ...text.matchAll(/from\s+"([^"]+)"|import\(\s*"([^"]+)"\s*\)|^\s*import\s+"([^"]+)"/gm),
  ].map((m) => m[1] ?? m[2] ?? m[3]);
}

const FEATURES = existsSync(join(SRC, "features"))
  ? readdirSync(join(SRC, "features")).filter((name) =>
      statSync(join(SRC, "features", name)).isDirectory(),
    )
  : [];

describe("the feature folders", () => {
  it("has at least one, so the rules below are checking something", () => {
    expect(FEATURES.length).toBeGreaterThan(0);
  });

  it.each(FEATURES)("%s exposes an index.ts", (feature) => {
    expect(existsSync(join(SRC, "features", feature, "index.ts"))).toBe(true);
  });
});

/* ================================================================== */
/* 1. The DTO boundary                                                 */
/* ================================================================== */

describe("a DTO type stops at the mapper", () => {
  /**
   * The rule the mapper layer exists for.
   *
   * Without it the repository returns wire shapes straight into the hooks, the
   * DTO reaches the components anyway, and the split exists on paper but not in
   * the import graph. `dto.ts`, `repository.ts` and `mapper.ts` may name them —
   * plus the tests for those three, which have to construct one.
   */
  const ALLOWED = ["dto.ts", "repository.ts", "mapper.ts"];
  const ALLOWED_TESTS = ["mapper.test.ts", "repository.test.ts", "dto.test.ts"];

  const withDtoFiles = FEATURES.filter((f) => existsSync(join(SRC, "features", f, "dto.ts")));

  it("at least one feature declares DTOs, so this is not vacuous", () => {
    expect(withDtoFiles.length).toBeGreaterThan(0);
  });

  it.each(withDtoFiles)("%s keeps its DTO names out of the layers above", (feature) => {
    const root = join(SRC, "features", feature);
    const dtoNames = [...read(join(root, "dto.ts")).matchAll(/export type (\w+)/g)].map(
      (m) => m[1],
    );
    expect(dtoNames.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of sources(root)) {
      const name = file.split(/[\\/]/).pop()!;
      if (ALLOWED.includes(name) || ALLOWED_TESTS.includes(name)) continue;
      const text = read(file);
      for (const dtoName of dtoNames) {
        if (new RegExp(`\\b${dtoName}\\b`).test(text)) {
          offenders.push(`${rel(file)} names ${dtoName}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it.each(withDtoFiles)("%s does not let its dto.ts escape the folder", (feature) => {
    const offenders = sources(SRC)
      .filter((file) => !file.includes(join("features", feature)))
      .filter((file) => importsOf(file).some((i) => i.includes(`features/${feature}/dto`)))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

/* ================================================================== */
/* 2 and 3. Feature isolation                                          */
/* ================================================================== */

describe("a feature does not import another feature", () => {
  /**
   * "Nineteen modules that import each other is not an architecture, it is a
   * mesh with folders" — `src/features/README.md`. A cross-feature need goes
   * through `entities/`, `widgets/`, or the same endpoint called from the
   * feature's own slice.
   */
  it.each(FEATURES)("%s imports no sibling", (feature) => {
    const offenders: string[] = [];
    for (const file of sources(join(SRC, "features", feature))) {
      for (const specifier of importsOf(file)) {
        const match = /^@\/features\/([\w-]+)/.exec(specifier);
        if (match && match[1] !== feature) offenders.push(`${rel(file)} → ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("nothing reaches past a feature's index.ts", () => {
  it.each(FEATURES)("%s is imported only by its public surface", (feature) => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      if (file.includes(join("features", feature))) continue;
      for (const specifier of importsOf(file)) {
        if (!specifier.startsWith(`@/features/${feature}`)) continue;
        // `@/features/x` is the index. `@/features/x/anything` is not.
        if (specifier !== `@/features/${feature}`) {
          offenders.push(`${rel(file)} → ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

/* ================================================================== */
/* 4. Arrows point down                                                */
/* ================================================================== */

/**
 * What each layer is allowed to reach for.
 *
 * `shared` may use `core` — the query cache and `ApiError` are below it — and
 * that is the one pair the README understated. Everything else is a downward
 * arrow or nothing.
 */
const MAY_NOT_IMPORT: Record<string, string[]> = {
  core: ["features", "widgets", "entities", "shared", "admin", "components", "content"],
  shared: ["features", "widgets", "entities", "admin"],
  entities: ["features", "widgets", "admin"],
  widgets: ["features", "admin"],
};

describe("an arrow never points upwards", () => {
  it.each(Object.keys(MAY_NOT_IMPORT).filter((layer) => existsSync(join(SRC, layer))))(
    "%s imports nothing above it",
    (layer) => {
      const forbidden = MAY_NOT_IMPORT[layer];
      const offenders: string[] = [];
      for (const file of sources(join(SRC, layer))) {
        for (const specifier of importsOf(file)) {
          const match = /^@\/([\w-]+)/.exec(specifier);
          if (match && forbidden.includes(match[1])) {
            offenders.push(`${rel(file)} → ${specifier}`);
          }
          // A relative escape out of the layer is the same violation wearing
          // a different spelling, and the one a search for "@/" would miss.
          if (specifier.startsWith("../../")) {
            const resolved = resolve(file, "..", specifier);
            const from = relative(SRC, resolved).split(/[\\/]/)[0];
            if (forbidden.includes(from)) offenders.push(`${rel(file)} → ${specifier}`);
          }
        }
      }
      expect(offenders).toEqual([]);
    },
  );
});

/* ================================================================== */
/* The public site stays a separate application                        */
/* ================================================================== */

describe("the public site and the dashboard do not mix", () => {
  const PUBLIC_DIRS = ["components", "content", "lib"];

  /**
   * The oldest rule in the repository (`docs/ARCHITECTURE.md`) and the one with
   * the most expensive failure: the public stylesheet is what every visitor
   * downloads, and its hash — `globals-B1c5Zfq1.css` — is the check that it has
   * not moved. A single import from the dashboard into `src/components` would
   * pull the admin tree into that bundle.
   */
  it("the public site imports nothing from the dashboard", () => {
    const dashboard = ["admin", "app", "core", "entities", "features", "shared", "widgets"];
    const offenders: string[] = [];
    for (const dir of PUBLIC_DIRS) {
      for (const file of sources(join(SRC, dir))) {
        for (const specifier of importsOf(file)) {
          const match = /^@\/([\w-]+)/.exec(specifier);
          if (match && dashboard.includes(match[1])) offenders.push(`${rel(file)} → ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
