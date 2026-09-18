import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The three places a colour token has to exist, checked against each other.
 *
 * A Tailwind class that does not resolve is **not an error**. It is absent from
 * the output and styles nothing — no warning, no failed build, just an element
 * with no background. That is the one failure mode a token migration has, and
 * nothing else in this repository detects it: the typecheck does not read class
 * strings, and the render smoke test asserts that markup exists, not that it is
 * styled.
 *
 * A token lives in three files and all three must agree:
 *
 *   1. `src/admin/admin.css`          declares `--c-<token>` for both themes
 *   2. `tailwind.admin.config.ts`     maps a class name onto that variable
 *   3. the dashboard's source roots   write `bg-<token>`, `text-<token>`, …
 *
 * Break any link and the class silently stops working. Renaming a token in one
 * place — which is exactly what `text-surface` → `text-inverse` and
 * `brand-navy` → `accent` were — is how that happens.
 *
 * This deliberately does **not** read the compiled stylesheet. Doing so would
 * make the test depend on `npm run build` having run, and a test that needs a
 * prior step is a test that gets skipped. The agreement below is checkable from
 * source and catches the same mistake.
 */

const ADMIN = resolve(__dirname);
const SRC = resolve(ADMIN, "..");
const css = readFileSync(join(ADMIN, "admin.css"), "utf8");
const config = readFileSync(resolve(SRC, "../tailwind.admin.config.ts"), "utf8");

/**
 * Every folder the dashboard renders from.
 *
 * This used to be `src/admin` alone, and when the UI moved into `src/shared`,
 * `src/entities` and `src/widgets` the scan below would have kept passing
 * while covering a third of what it used to — the worst kind of regression in
 * a test, because the green tells you nothing changed.
 *
 * It is checked against `tailwind.admin.config.ts` rather than just written
 * down: that file's `content` is what Tailwind scans to decide which classes
 * to emit, so a folder present in one list and missing from the other is a
 * hole in either the stylesheet or this test. Folders that do not exist yet
 * are dropped — the enterprise feature folders are created as their modules
 * are built.
 */
const DASHBOARD_ROOTS = ["admin", "app", "core", "entities", "features", "shared", "widgets"];
const ROOTS = DASHBOARD_ROOTS.map((d) => join(SRC, d)).filter((d) => existsSync(d));

/** A path as it is written in this repository, for a failure message. */
const rel = (file: string) => `src/${relative(SRC, file).replace(/\\/g, "/")}`;

/** Tokens declared in the light `:root` block. */
const declared = new Set(
  [...css.matchAll(/--c-([a-z0-9-]+):\s*\d+\s+\d+\s+\d+\s*;/g)].map((m) => m[1]),
);

/** Tokens the Tailwind config maps, via the `token("…")` helper. */
const mapped = new Set([...config.matchAll(/token\("([a-z0-9-]+)"\)/g)].map((m) => m[1]));

/**
 * Class prefixes that take a colour. `shadow` is excluded: the project's
 * shadows are their own named scale, not colour tokens.
 */
const PREFIXES = [
  "bg", "text", "border", "ring", "fill", "stroke", "from", "to", "via",
  "divide", "placeholder", "caret", "outline", "decoration",
];

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * Every `<prefix>-<token>` the dashboard writes, with the file that writes it.
 *
 * Searched token by token rather than by a general `(\w+)-(\w+)` pattern,
 * because the tokens contain hyphens themselves — `surface-2`, `line-strong`,
 * `brand-navy`, `admin-rail`. A generic pattern stops at the first hyphen and
 * silently finds only the single-word ones, which is a check that passes by
 * looking at almost nothing.
 *
 * The trailing lookahead is what keeps `bg-surface` from matching inside
 * `bg-surface-2`.
 */
const knownTokens = [...new Set([...declared, ...mapped])];
const scanned = ROOTS.flatMap((root) => sources(root));
const used = new Map<string, Set<string>>();
for (const file of scanned) {
  const src = readFileSync(file, "utf8");
  const where = rel(file);
  for (const token of knownTokens) {
    for (const prefix of PREFIXES) {
      if (!new RegExp(`\\b${prefix}-${token}(?![\\w-])`).test(src)) continue;
      if (!used.has(token)) used.set(token, new Set());
      used.get(token)!.add(where);
    }
  }
}

describe("the palette is declared where it is needed", () => {
  it("found the token block", () => {
    // Guards every assertion below: a regex that stopped matching would make
    // all of them pass against an empty set.
    expect(declared.size).toBeGreaterThan(15);
    expect(declared.has("surface")).toBe(true);
    expect(declared.has("inverse")).toBe(true);
    expect(declared.has("accent")).toBe(true);
  });

  it("found the config mapping", () => {
    expect(mapped.size).toBeGreaterThan(15);
  });

  it("maps every declared token, so none is unreachable as a class", () => {
    // A token declared in CSS but not mapped can only be used as
    // `var(--c-x)` in hand-written CSS — writing `bg-x` would silently do
    // nothing.
    const unmapped = [...declared].filter((t) => !mapped.has(t)).sort();
    expect(unmapped).toEqual([]);
  });

  it("declares every token the config maps, so none resolves to nothing", () => {
    // The reverse: `rgb(var(--c-ghost) / 1)` with no `--c-ghost` is an invalid
    // colour, which the browser drops.
    const undeclaredButMapped = [...mapped].filter((t) => !declared.has(t)).sort();
    expect(undeclaredButMapped).toEqual([]);
  });
});

describe("every token class the dashboard writes can resolve", () => {
  it("uses a meaningful number of tokens", () => {
    expect(used.size).toBeGreaterThan(8);
  });

  it.each([...used.keys()].sort())("%s is declared and mapped", (token) => {
    const where = [...(used.get(token) ?? [])].join(", ");
    expect(declared.has(token), `--c-${token} is not declared in admin.css (used in ${where})`).toBe(
      true,
    );
    expect(
      mapped.has(token),
      `"${token}" is not mapped in tailwind.admin.config.ts (used in ${where})`,
    ).toBe(true);
  });
});

describe("the tokens that were renamed are gone for good", () => {
  it("nothing writes text-surface any more", () => {
    /**
     * `text-surface` meant "text on a dark ground" at all twenty call sites and
     * became `text-inverse`. It still *resolves* — `surface` is a real token —
     * so reintroducing it would produce dark text on the dark rail with no
     * error anywhere. This is the only check that would catch that.
     */
    const offenders = scanned.filter((f) => /\btext-surface\b/.test(readFileSync(f, "utf8")));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("nothing uses brand-navy as a foreground", () => {
    // `brand-navy` is a background only; `accent` is its foreground
    // counterpart. As text on a dark card the background value measures
    // 2.93:1 and fails AA — see theme.contrast.test.ts.
    const offenders = scanned.filter((f) =>
      /\b(?:text|ring|border|fill|stroke)-brand-navy\b/.test(readFileSync(f, "utf8")),
    );
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe("the scan covers what Tailwind covers", () => {
  /**
   * The check that keeps the three above honest.
   *
   * Every assertion in this file is of the form "nothing in the scanned files
   * does X". Shrink the scan and they all still pass, which is how a folder
   * move turns a real check into a decorative one. Both halves are asserted:
   * a root this test reads must be one Tailwind emits classes for, and a root
   * Tailwind emits classes for must be one this test reads.
   */
  const globs = [...config.matchAll(/"\.\/src\/([a-z-]+)\/\*\*/g)].map((m) => m[1]);

  it("reads a meaningful number of files", () => {
    expect(scanned.length).toBeGreaterThan(20);
  });

  it("scans exactly the roots the Tailwind config scans", () => {
    expect([...globs].sort()).toEqual([...DASHBOARD_ROOTS].sort());
  });
});
