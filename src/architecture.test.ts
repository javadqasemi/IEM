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

/* ================================================================== */
/* P1A — defects that must not come back                               */
/* ================================================================== */

/**
 * Source with its comments removed, so a guard matches code and not the
 * sentence that explains why the code is gone. Approximate — a `//` inside a
 * string would be cut — and good enough for the patterns below, none of which
 * occurs inside a string literal.
 */
const withoutComments = (text: string) =>
  text
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/* ================================================================== */
/* ================================================================== */

/**
 * Four shapes the UX defect sweep removed, each of which is one keystroke
 * from returning — so each is counted here rather than remembered.
 */
describe("P1A: a write's result is read before anything is said about it", () => {
  /**
   * UX-02. `useMutation().run` resolves to a `MutationResult`, never `null`,
   * so the type forbids reading `data` from a failure. What the type cannot
   * see is a result that is **thrown away** — `await remove.run(id);` followed
   * by a success toast is exactly the shape fourteen call sites had — or one
   * tested for truthiness, which an object always passes. So this walks the
   * syntax tree: every `x.run(…)` where `x` came from `useMutation(…)` must be
   * assigned, and the name it is assigned to must be read as `.ok`.
   */
  it("every useMutation().run result is assigned and narrowed on .ok", async () => {
    const ts = (await import("typescript")).default;
    const offenders: string[] = [];
    const files = [...sources(join(SRC, "admin")), ...sources(join(SRC, "features"))].filter(
      (f) => !/\.test\.tsx?$/.test(f),
    );

    for (const file of files) {
      const text = read(file);
      if (!text.includes("useMutation(")) continue;
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

      const mutations = new Set<string>();
      const visitDecl = (node: import("typescript").Node) => {
        if (
          ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          node.initializer &&
          ts.isCallExpression(node.initializer) &&
          ts.isIdentifier(node.initializer.expression) &&
          node.initializer.expression.text === "useMutation"
        ) {
          mutations.add(node.name.text);
        }
        ts.forEachChild(node, visitDecl);
      };
      visitDecl(source);
      if (!mutations.size) continue;

      const where = (node: import("typescript").Node) =>
        `${rel(file)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

      const visit = (node: import("typescript").Node) => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "run" &&
          ts.isIdentifier(node.expression.expression) &&
          mutations.has(node.expression.expression.text)
        ) {
          let parent = node.parent;
          if (ts.isAwaitExpression(parent)) parent = parent.parent;
          if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
            const name = parent.name.text;
            // The enclosing function body is where the check has to happen.
            let scope: import("typescript").Node = parent;
            while (scope && !ts.isFunctionLike(scope)) scope = scope.parent;
            const body = scope ? scope.getText() : text;
            if (!new RegExp(`\\b${name}\\.ok\\b`).test(body)) {
              offenders.push(`${where(node)} — "${name}" is never checked with .ok`);
            }
          } else {
            offenders.push(`${where(node)} — the result of .run() is discarded`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }

    expect(offenders).toEqual([]);
  });
});

describe("P1A: a list opens through a real link, not a clickable row", () => {
  /**
   * UX-19. `onRowClick` put the only way into a record on a `<tr>`, which a
   * keyboard cannot reach. `DataTable` now takes `open` and renders a link or
   * a button in the identity cell; the row's own click goes through that
   * element. `DataTable.tsx` is the one file allowed a handler on a row.
   */
  it("no onRowClick prop and no <tr onClick> outside DataTable", () => {
    const offenders = sources(SRC)
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .filter((f) => !f.endsWith(join("shared", "ui", "data", "DataTable.tsx")))
      .filter((f) => /\bonRowClick\b|<tr\b[^>]*\bonClick=/.test(withoutComments(read(f))))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});

describe("P1A: a conflict is not answered by reloading the application", () => {
  /**
   * UX-15. Five edit dialogs answered a 409 with `window.location.reload()`,
   * which threw the reader's input away and restarted the SPA. The answer is
   * `ConflictNotice`. The error boundary keeps its reload: a render that threw
   * has no state worth keeping and no smaller unit to restart.
   */
  const ALLOWED = [join("shared", "ui", "feedback", "ErrorBoundary.tsx")];

  it("window.location.reload appears only in the error boundary", () => {
    const offenders = [
      ...sources(join(SRC, "admin")),
      ...sources(join(SRC, "features")),
      ...sources(join(SRC, "shared")),
      ...sources(join(SRC, "widgets")),
    ]
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .filter((f) => !ALLOWED.some((allowed) => f.endsWith(allowed)))
      .filter((f) => /location\.reload\(/.test(withoutComments(read(f))))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});
describe("P1B: navigation has one source and one rule", () => {
  /**
   * The registry in `src/admin/lib/navigation.ts` is the only place a menu is
   * declared, and `AUDIENCES` plus each destination's `visibleWhen` the only
   * place visibility is decided. The components that draw it — rail, strip,
   * palette — receive the derived result and must not ask the auth context
   * themselves: a `can(...)` in a component is a second rule that the palette
   * would not share, which is exactly how search leaks a hidden destination.
   */
  const DRAWERS = [
    join(SRC, "admin", "ui", "Sidebar.tsx"),
    join(SRC, "admin", "ui", "WorkspaceStrip.tsx"),
    join(SRC, "admin", "ui", "CommandPalette.tsx"),
  ];

  it("the rail, the strip and the palette decide no visibility themselves", () => {
    const offenders = DRAWERS.filter((file) =>
      /\buseAuth\b|\bcan\(|\bcanAny\(|permissions\.(has|includes)\(/.test(withoutComments(read(file))),
    ).map(rel);
    expect(offenders).toEqual([]);
  });

  it("there is one navigation definition, not a v2 beside a legacy", () => {
    // The dashboard only: the public site's header (`components/Nav.tsx`) is a
    // different application with its own menu.
    const definitions = sources(join(SRC, "admin"))
      .filter((f) => !/\.test\.tsx?$|\.testing\.ts$/.test(f))
      .filter((f) => /(^|[\\/])(legacy)?[nN]av(igation)?(-?v\d+)?\.tsx?$/.test(f))
      .map(rel);
    expect(definitions).toEqual(["src/admin/lib/navigation.ts"]);
  });

  it("no screen builds its own workspace sub-navigation beside the rail", () => {
    /*
      The settings page carried a `SideNav` of eleven sections and the System
      page a tab strip of three; both were workspace navigation in a second
      shape. Record-level navigation (a project's tabs) is a different thing
      and is not what this checks.
    */
    const offenders = [
      join(SRC, "features", "organisation", "screens", "SettingsWorkspace.tsx"),
      join(SRC, "features", "system", "screens", "SystemWorkspace.tsx"),
    ].filter((f) => /<SideNav\b|<nav\b/.test(withoutComments(read(f)))).map(rel);
    expect(offenders).toEqual([]);
  });
});

/* ================================================================== */
/* P1C — one interaction standard                                      */
/* ================================================================== */

/**
 * The forms-and-actions standard (P1C), as rules a new screen cannot quietly
 * break. Each walks the syntax tree rather than grepping, because the thing
 * being checked is a *relationship* — a button's text and its variant, a
 * dialog's body and whether it holds a form — and a regex over JSX gets that
 * wrong in both directions. Every allowlist is shrink-only: an entry that no
 * longer needs to be there fails the test until it is removed.
 */
describe("P1C: one interaction standard", async () => {
  const ts = (await import("typescript")).default;
  type Node = import("typescript").Node;

  const screens = [
    ...sources(join(SRC, "admin")),
    ...sources(join(SRC, "features")),
    ...sources(join(SRC, "shared")),
    ...sources(join(SRC, "widgets")),
  ].filter((f) => f.endsWith(".tsx") && !/\.test\.tsx$/.test(f));

  const parsed = screens.map((file) => ({
    file,
    source: ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
  }));

  const tagOf = (n: Node) =>
    ts.isJsxElement(n) ? n.openingElement.tagName : ts.isJsxSelfClosingElement(n) ? n.tagName : null;
  const openingOf = (n: Node) =>
    ts.isJsxElement(n) ? n.openingElement : ts.isJsxSelfClosingElement(n) ? n : null;
  const attr = (n: Node, name: string) =>
    openingOf(n)?.attributes.properties.find(
      (a): a is import("typescript").JsxAttribute => ts.isJsxAttribute(a) && a.name.getText() === name,
    );
  const variantOf = (n: Node) => {
    const v = attr(n, "variant");
    return v?.initializer ? v.initializer.getText().replace(/[{}"]/g, "") : "secondary";
  };
  const textOf = (n: Node) =>
    ts.isJsxElement(n)
      ? n.children
          .filter((c) => ts.isJsxText(c))
          .map((c) => c.getText())
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()
      : "";
  const where = (file: string, source: import("typescript").SourceFile, n: Node) =>
    `${rel(file)}:${source.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  const walk = (n: Node, visit: (n: Node) => void) => {
    visit(n);
    ts.forEachChild(n, (c) => walk(c, visit));
  };

  /**
   * `useAsync` — the pre-cache loader — is retired screen by screen. P1C moved
   * the home page, the shell's badges, the audit log and the profile to
   * `useQuery`; these five remain, and each says why.
   */
  const USE_ASYNC_ALLOWED: Record<string, string> = {
    "src/admin/pages/Content.tsx": "content lists — rebuilt by the page editor (P2, Edit Website)",
    "src/admin/pages/ContentEditor.tsx": "the entry editor — rebuilt by the page editor (P2)",
    "src/admin/pages/Media.tsx": "the media library — moves with the page editor's picker (P2)",
    "src/admin/pages/Workflow.tsx": "Freigaben / Veröffentlichen — become the editor's workflow bar (P2)",
    "src/admin/pages/People.tsx":
      "users and roles — the P0 privilege-ceiling and re-authentication flows, not reworked in P1C",
  };

  it("useAsync is used only where it is still allowed, and the list only shrinks", () => {
    const using = sources(SRC)
      .filter((f) => !/\.test\.tsx?$/.test(f) && !f.endsWith(join("lib", "useAsync.ts")))
      .filter((f) => /\buseAsync\(/.test(withoutComments(read(f))))
      .map(rel)
      .sort();
    expect(using).toEqual(Object.keys(USE_ASYNC_ALLOWED).sort());
  });

  /**
   * UX-16. A destructive trigger is `danger-quiet` and its confirmation
   * `danger`; every "Löschen" used to be a grey `ghost`, the same as the
   * "Abbrechen" beside it. Judged by the button's own text.
   */
  const DESTRUCTIVE = /\b(l[öo]schen|entfernen|archivieren|zur[üu]ckziehen|deaktivieren|widerrufen|beenden|stoppen|zur[üu]cksetzen)\b/i;
  const NOT_DESTRUCTIVE = new Set([
    // Resets a *filter*, not a record.
    "Suche zurücksetzen",
    "Alle zurücksetzen",
  ]);
  const DESTRUCTIVE_EXCEPTIONS: Record<string, string> = {
    "src/features/drawings/screens/TransmittalDialog.tsx":
      "removes a recipient row from an unsent draft — nothing persisted is touched",
  };

  it("a destructive button is danger or danger-quiet", () => {
    const offenders: string[] = [];
    const excused = new Set<string>();
    for (const { file, source } of parsed) {
      walk(source, (n) => {
        if (tagOf(n)?.getText() !== "Button") return;
        const text = textOf(n);
        if (!DESTRUCTIVE.test(text) || NOT_DESTRUCTIVE.has(text)) return;
        if (variantOf(n).startsWith("danger")) return;
        if (DESTRUCTIVE_EXCEPTIONS[rel(file)]) {
          excused.add(rel(file));
          return;
        }
        offenders.push(`${where(file, source, n)} «${text}» is ${variantOf(n)}`);
      });
    }
    expect(offenders).toEqual([]);
    expect([...excused].sort(), "an exception that is no longer needed").toEqual(
      Object.keys(DESTRUCTIVE_EXCEPTIONS).sort(),
    );
  });

  /**
   * A dialog with fields is a `<Form>`: Enter, the error `Callout`, focus on
   * the first invalid field and required semantics all hang off it. The two
   * exceptions are HIGH-level confirmations, where the typed word must never
   * be submittable by Enter.
   */
  const MODAL_WITHOUT_FORM: Record<string, string> = {
    "src/shared/ui/overlays/Modal.tsx": "ConfirmDialog's typed confirmation — a deliberate click",
    "src/features/backup/screens/RestoreDialog.tsx": "restore: typed word + re-authentication (HIGH)",
  };

  it("a dialog with fields wraps them in a Form", () => {
    const found = new Set<string>();
    const offenders: string[] = [];
    for (const { file, source } of parsed) {
      walk(source, (n) => {
        if (tagOf(n)?.getText() !== "Modal" || !ts.isJsxElement(n)) return;
        let field = false;
        let form = false;
        n.children.forEach((c) =>
          walk(c, (d) => {
            const name = tagOf(d)?.getText();
            if (name === "Field") field = true;
            if (name === "Form" || name === "form") form = true;
          }),
        );
        if (!field || form) return;
        if (MODAL_WITHOUT_FORM[rel(file)]) found.add(rel(file));
        else offenders.push(where(file, source, n));
      });
    }
    expect(offenders).toEqual([]);
    expect([...found].sort()).toEqual(Object.keys(MODAL_WITHOUT_FORM).sort());
  });

  /**
   * One primary per decision context. The rightmost footer button that is not
   * a dismissal (`ghost`) or a destructive trigger (`danger-quiet`) is what the
   * dialog exists for, and it looks like it: `primary`, or `danger` when the
   * act removes something. The Wave-2 dialogs left it on the default
   * `secondary`, so a project's "Speichern" weighed the same as everything else.
   */
  it("a dialog's main action is primary (or danger)", () => {
    const offenders: string[] = [];
    for (const { file, source } of parsed) {
      walk(source, (n) => {
        if (tagOf(n)?.getText() !== "Modal") return;
        const footer = attr(n, "footer");
        if (!footer?.initializer) return;
        const buttons: Node[] = [];
        walk(footer.initializer, (d) => {
          if (tagOf(d)?.getText() === "Button") buttons.push(d);
        });
        const main = buttons.filter((b) => {
          const v = variantOf(b);
          return v !== "ghost" && v !== "danger-quiet";
        });
        const last = main[main.length - 1];
        if (!last) return;
        const v = variantOf(last);
        // A conditional (`destructive ? "danger" : "primary"`) names both.
        if (/\b(primary|danger)\b/.test(v) && !/secondary/.test(v)) return;
        offenders.push(`${where(file, source, n)} main action is ${v}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  /**
   * No permission key in what a person reads (Part 23). Checked against the
   * real catalogue, over JSX text and the attributes that are shown —
   * `permission=` and `permissions=` are configuration, not copy. The role
   * editor lists keys as hints on purpose: it is the one technical context.
   */
  it("no permission key appears in user-visible copy", () => {
    const catalogue = read(resolve(SRC, "..", "server", "src", "rbac", "permissions.catalog.ts"));
    const keys = new Set([...catalogue.matchAll(/"([a-z]+\.[a-z][a-zA-Z]*)"/g)].map((m) => m[1]));
    expect(keys.size, "the catalogue parsed").toBeGreaterThan(50);

    const SHOWN = new Set([
      "title",
      "description",
      "label",
      "hint",
      "message",
      "disabledReason",
      "placeholder",
      "confirmLabel",
      "aria-label",
      "emptyLabel",
      "caption",
      "eyebrow",
    ]);
    const offenders: string[] = [];
    for (const { file, source } of parsed) {
      const check = (text: string, n: Node) => {
        const hit = text
          .split(/[\s,;:()„“"'`]+/)
          .map((w) => w.replace(/[.!?]$/, ""))
          .find((w) => keys.has(w));
        if (hit) offenders.push(`${where(file, source, n)} shows "${hit}"`);
      };
      walk(source, (n) => {
        if (ts.isJsxText(n)) check(n.getText(), n);
        if (ts.isJsxAttribute(n) && SHOWN.has(n.name.getText()) && n.initializer) {
          const init = n.initializer;
          if (ts.isStringLiteral(init)) check(init.text, n);
          else if (
            ts.isJsxExpression(init) &&
            init.expression &&
            (ts.isStringLiteral(init.expression) || ts.isNoSubstitutionTemplateLiteral(init.expression))
          )
            check(init.expression.text, n);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});