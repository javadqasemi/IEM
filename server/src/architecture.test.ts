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
