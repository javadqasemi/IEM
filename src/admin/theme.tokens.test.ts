import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
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
 *   3. `src/admin/**`                 writes `bg-<token>`, `text-<token>`, …
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
const css = readFileSync(join(ADMIN, "admin.css"), "utf8");
const config = readFileSync(resolve(ADMIN, "../../tailwind.admin.config.ts"), "utf8");

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
const used = new Map<string, Set<string>>();
for (const file of sources(ADMIN)) {
  const src = readFileSync(file, "utf8");
  const where = file.replace(ADMIN, "src/admin").replace(/\\/g, "/");
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
    const offenders = sources(ADMIN).filter((f) =>
      /\btext-surface\b/.test(readFileSync(f, "utf8")),
    );
    expect(offenders.map((f) => f.replace(ADMIN, "src/admin"))).toEqual([]);
  });

  it("nothing uses brand-navy as a foreground", () => {
    // `brand-navy` is a background only; `accent` is its foreground
    // counterpart. As text on a dark card the background value measures
    // 2.93:1 and fails AA — see theme.contrast.test.ts.
    const offenders = sources(ADMIN).filter((f) =>
      /\b(?:text|ring|border|fill|stroke)-brand-navy\b/.test(readFileSync(f, "utf8")),
    );
    expect(offenders.map((f) => f.replace(ADMIN, "src/admin"))).toEqual([]);
  });
});
