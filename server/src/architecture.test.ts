import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The server's layering, enforced (foundation stage F12).
 *
 * The client has `src/architecture.test.ts` for the same reason: a rule that is
 * only written down is a rule that holds until somebody is in a hurry, and
 * every violation below is invisible from the file being edited.
 */

const SRC = resolve(__dirname);

function sources(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out.push(path);
  }
  return out;
}

const rel = (file: string) => relative(SRC, file).replace(/\\/g, "/");
const read = (file: string) => readFileSync(file, "utf8");

/**
 * The file with its comments removed.
 *
 * Every assertion below scans source text, and this codebase's comments are its
 * main documentation — they quote the very identifiers the rules forbid.
 * `projects.service.ts` opens by explaining that it holds no `PrismaService`,
 * and the first version of these tests failed it for saying so. Scanning the
 * raw text would make the rule "do not discuss the rule", which is the opposite
 * of what this repository wants.
 */
const code = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Folders that are infrastructure rather than features. */
const INFRASTRUCTURE = ["common", "core", "auth", "rbac", "mail", "media", "tasks"];

const featureDirs = readdirSync(SRC)
  .filter((name) => statSync(join(SRC, name)).isDirectory())
  .filter((name) => !INFRASTRUCTURE.includes(name));

describe("app.module.ts lists modules, never controllers", () => {
  const root = read(join(SRC, "app.module.ts"));

  /**
   * Weakness W8, closed. Seven controllers and five services used to be
   * declared on the root module; at twenty-six features that is a file nobody
   * can read and a boundary nowhere.
   */
  it("declares no controllers of its own", () => {
    const controllers = /controllers:\s*\[([^\]]*)\]/.exec(root);
    expect(controllers?.[1]?.trim() ?? "", "app.module.ts declares controllers").toBe("");
  });

  it("declares no feature services", () => {
    /**
     * Bracket-counted rather than regex-sliced. `providers:` is followed by
     * object literals containing their own `]`, and a lazy `[\s\S]*?` to the
     * first `],` at the file's indentation both depends on the indentation
     * being two spaces and stops early the day somebody wraps a line — either
     * way the test would pass by reading nothing at all.
     */
    const start = root.indexOf("providers: [");
    expect(start, "app.module.ts has no providers array").toBeGreaterThan(-1);
    let depth = 0;
    let end = start + "providers: ".length;
    do {
      const char = root[end];
      if (char === "[") depth += 1;
      else if (char === "]") depth -= 1;
      end += 1;
    } while (depth > 0 && end < root.length);
    const providers = root.slice(start, end);

    // Only the cross-cutting `{ provide: … }` registrations belong here; a
    // bare `SomeService,` is a feature provider that owes itself a module.
    const offenders = [...providers.matchAll(/^\s*([A-Z]\w+),/gm)].map((m) => m[1]);
    expect(offenders).toEqual([]);
  });

  it("imports a module for every feature folder", () => {
    const missing = featureDirs.filter((dir) => {
      const module = readdirSync(join(SRC, dir)).find((f) => f.endsWith(".module.ts"));
      if (!module) return true;
      const className = /export class (\w+)/.exec(read(join(SRC, dir, module)))?.[1];
      return !className || !root.includes(className);
    });
    expect(missing, "feature folders with no module, or not imported").toEqual([]);
  });
});

describe("every feature folder is a module", () => {
  it("found the feature folders", () => {
    // Guards the assertions below against an empty list.
    expect(featureDirs.length).toBeGreaterThan(4);
  });

  it.each(featureDirs)("%s declares a Nest module", (dir) => {
    const module = readdirSync(join(SRC, dir)).find((f) => f.endsWith(".module.ts"));
    expect(module, `${dir}/ has no *.module.ts`).toBeTruthy();
  });

  it.each(featureDirs)("%s keeps its controller inside its own module", (dir) => {
    const files = readdirSync(join(SRC, dir));
    const controllers = files.filter((f) => f.endsWith(".controller.ts"));
    if (!controllers.length) return;
    const moduleFile = files.find((f) => f.endsWith(".module.ts"))!;
    const module = read(join(SRC, dir, moduleFile));
    for (const controller of controllers) {
      const className = /export class (\w+Controller)/.exec(read(join(SRC, dir, controller)))?.[1];
      if (!className) continue;
      expect(module, `${dir}/${moduleFile} does not declare ${className}`).toContain(className);
    }
  });
});

describe("a feature does not reach into another feature's service", () => {
  /**
   * The server half of the rule `features/README.md` states for the client.
   *
   * A cross-feature reaction goes through `core/events`; a cross-feature
   * *command* — a timer telling content to publish — is legitimate and lives in
   * `tasks/`, which is why that folder is infrastructure here rather than a
   * feature.
   */
  it.each(featureDirs)("%s imports no sibling's service", (dir) => {
    const offenders: string[] = [];
    for (const file of sources(join(SRC, dir))) {
      for (const match of read(file).matchAll(/from "\.\.\/([\w-]+)\/([\w.-]+)"/g)) {
        const [, folder, target] = match;
        if (folder === dir || INFRASTRUCTURE.includes(folder)) continue;
        if (target.includes(".service")) offenders.push(`${rel(file)} → ${folder}/${target}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("the layers, on the server", () => {
  /**
   * The rule `projects.service.ts` opens with, enforced rather than asserted in
   * a comment.
   *
   * A service with a `PrismaService` in scope grows one convenient `findFirst`,
   * then a second, and within a release its rules cannot be reasoned about — or
   * tested — without a database. Nothing fails when that happens, which is why
   * it needs a test rather than a review.
   *
   * **It applies only to a feature that has chosen the split.** Six services
   * predate the repository layer and query Prisma directly; failing them here
   * would make the gate a wall and the usual response to a wall is to delete
   * it. The rule is therefore conditional: *if* a feature has a
   * `*.repository.ts`, its service goes through it. Migrating a service is what
   * adds it to the list, and the list can only grow.
   */
  const withRepository = featureDirs.filter((dir) =>
    readdirSync(join(SRC, dir)).some((f) => f.endsWith(".repository.ts")),
  );

  it("found at least one feature with a repository", () => {
    // Guards the assertions below against silently covering nothing.
    expect(withRepository.length).toBeGreaterThan(0);
  });

  it.each(withRepository)("%s: the service holds no Prisma", (dir) => {
    const services = readdirSync(join(SRC, dir)).filter((f) => f.endsWith(".service.ts"));
    for (const file of services) {
      const source = code(join(SRC, dir, file));
      expect(source, `${dir}/${file} imports PrismaService`).not.toMatch(/PrismaService/);
      // A *type-only* enum import is the domain's vocabulary and is fine; the
      // `Prisma` namespace is the persistence layer's and is not.
      expect(source, `${dir}/${file} imports the Prisma namespace`).not.toMatch(
        /^import \{[^}]*\bPrisma\b[^}]*\} from "@prisma\/client"/m,
      );
    }
  });

  it.each(withRepository)("%s: a repository comes with a mapper", (dir) => {
    // §3.0.1: a feature may omit `service.ts` when it has no rules, but never
    // `mapper.ts` — a seam that exists only when convenient is not a seam.
    const files = readdirSync(join(SRC, dir));
    expect(
      files.some((f) => f.endsWith(".mapper.ts")),
      `${dir}/ has a repository and no mapper`,
    ).toBe(true);
  });

  it.each(withRepository)("%s: only the repository and mapper name Prisma types", (dir) => {
    /**
     * The server half of the client's DTO-boundary rule.
     *
     * `Prisma.ProjectWhereInput` in a controller means the HTTP layer is
     * building queries, and `Prisma.Decimal` in one means a `Decimal` is about
     * to reach `JSON.stringify` — where it serialises as
     * `{"s":1,"e":6,"d":[…]}`, which reads in a network tab like a server bug
     * rather than a missing conversion.
     */
    /*
      `scope.ts` joins the two, and it is not an exception grudgingly made.

      Row-level visibility *is* a query shape — `scopeFor` returns a
      `ProjectWhereInput` and nothing else — so it belongs on the persistence
      side of the boundary by the same argument the repository does. It is a
      separate file rather than a repository method because the rule has to be
      unit-testable without a database, which `projects.scope.test.ts` is.
    */
    const allowed = /\.(repository|mapper|scope)\.ts$/;
    const offenders: string[] = [];
    for (const file of sources(join(SRC, dir))) {
      if (allowed.test(file)) continue;
      if (/\bPrisma\.\w/.test(code(file))) offenders.push(rel(file));
    }
    expect(offenders, "Prisma types outside repository.ts / mapper.ts / scope.ts").toEqual([]);
  });

  /**
   * Controllers that query Prisma directly, and the reason each is still here.
   *
   * A named list rather than a skipped test, for the reason
   * `permissions.agreement.test.ts` gives for `KNOWN_UNENFORCED`: debt that is
   * counted gets paid and debt that is invisible does not. **The list may only
   * shrink** — the test below fails if a name in it is no longer an offender,
   * so fixing one forces the entry out rather than leaving a stale exemption
   * behind.
   */
  const KNOWN_CONTROLLER_PRISMA: Record<string, string> = {
    "audit/audit.controller.ts":
      "Reads the audit log and streams the CSV export inline. Owed a repository " +
      "when the audit module is migrated; nothing else depends on it.",
    "dashboard/dashboard.controller.ts":
      "Counts rows across eight tables for the health panel. It is the one place " +
      "a cross-feature read is the whole feature, so it needs a shape the others do not.",
  };

  it.each(featureDirs)("%s: the controller decides nothing", (dir) => {
    /**
     * A controller that reaches Prisma has skipped both other layers at once,
     * and it is the commonest shortcut under time pressure because it works.
     */
    const controllers = readdirSync(join(SRC, dir)).filter((f) => f.endsWith(".controller.ts"));
    for (const file of controllers) {
      const path = `${dir}/${file}`;
      const offends = /PrismaService/.test(code(join(SRC, dir, file)));
      if (path in KNOWN_CONTROLLER_PRISMA) {
        expect(offends, `${path} is fixed — remove it from KNOWN_CONTROLLER_PRISMA`).toBe(true);
        continue;
      }
      expect(offends, `${path} injects PrismaService`).toBe(false);
    }
  });

  it("names no controller that does not exist", () => {
    for (const path of Object.keys(KNOWN_CONTROLLER_PRISMA)) {
      expect(existsSync(join(SRC, path)), `${path} is listed but gone`).toBe(true);
    }
  });
});

describe("every route is behind a permission", () => {
  /**
   * `JwtAuthGuard` is global and denies by default, so a route without
   * `@Public()` needs a session. That is authentication; this is
   * **authorisation**, and the two are different questions. A route with a
   * session and no `@RequirePermissions` is open to every signed-in user,
   * including one whose role grants nothing — which is not a 403 anybody would
   * see, because it does not happen.
   *
   * The count-based form rather than a per-route parse: matching handler
   * decorators exactly means writing a TypeScript parser, and the failure this
   * guards against is a whole controller with none rather than one route in
   * twenty.
   */
  const handlers = /@(Get|Post|Patch|Put|Delete)\(/g;

  it.each(featureDirs)("%s", (dir) => {
    for (const file of readdirSync(join(SRC, dir)).filter((f) => f.endsWith(".controller.ts"))) {
      const source = code(join(SRC, dir, file));
      const routes = source.match(handlers)?.length ?? 0;
      if (!routes) continue;
      const guarded =
        (source.match(/@RequirePermissions\(/g)?.length ?? 0) +
        (source.match(/@Public\(\)/g)?.length ?? 0);
      expect(
        guarded,
        `${dir}/${file}: ${routes} route(s), ${guarded} carrying @RequirePermissions or @Public`,
      ).toBeGreaterThanOrEqual(routes);
    }
  });
});

describe("the audit trail cannot be edited", () => {
  /**
   * Not a layering rule, but it belongs with them: `audit.controller.ts` is
   * read-only *by construction*, and the comment saying so is the only thing
   * that has ever guarded it. Rows are written by the listener from domain
   * events; a route that could change one would make the log evidence of
   * nothing.
   */
  it("exposes no write route on the audit log", () => {
    const controller = read(join(SRC, "audit", "audit.controller.ts"));
    expect(controller).not.toMatch(/@(Post|Patch|Put|Delete)\(/);
  });
});
