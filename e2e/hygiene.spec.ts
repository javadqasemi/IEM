import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { E2E_MARKER } from "./fixtures";

/**
 * Test-data hygiene, asserted against the spec files themselves.
 *
 * ---
 *
 * ## Why this exists
 *
 * `afterAll` cannot be made sufficient, and trusting it cost two full suite
 * runs. A killed Playwright process never reaches it; a timed-out test
 * abandons what it made; and a refusal the domain is *right* to make —
 * `DELETE /drawings/:id` will not take an issued plan — leaves a row behind by
 * design.
 *
 * By the time it was noticed, one seeded project carried **782 drawings**
 * where the seed makes six, plus 857 tasks, 852 meetings and 595 decisions.
 * That broke a real test rather than merely being untidy: the Planversand
 * dialog asks for a page of 100 plans — a documented design decision — so a
 * plan the test had just created was not in the list, and the failure read as
 * a defect in the module.
 *
 * The repair inverts the rule: instead of every spec promising to clean up,
 * **every spec marks what it makes**, and `server/prisma/e2e-cleanup.ts`
 * removes everything marked *before* the next run. This file is what keeps the
 * marking honest, in the same shape as `login-budget.spec.ts` — a source
 * assertion, not a behaviour one, because the failure it guards is a spec
 * somebody writes next month.
 *
 * ## It is coarse on purpose
 *
 * It does not prove the marker ends up in the right *column*, or that the
 * cleanup would match it. A finer check would need to parse TypeScript and
 * know the schema. The failure worth catching is a whole new spec that creates
 * persistent rows and labels none of them, and that is what this catches.
 */

const DIR = join(process.cwd(), "e2e");

function specs(): { name: string; code: string }[] {
  return readdirSync(DIR)
    .filter((name) => name.endsWith(".spec.ts"))
    .map((name) => ({ name, code: readFileSync(join(DIR, name), "utf8") }));
}

/**
 * Routes whose `POST` leaves a row behind that a later run can still see.
 *
 * Deliberately **not** every `POST`. Signing in, refreshing, probing mail and
 * requesting a re-authentication window all write rows, and all of them are
 * either short-lived or pruned by the scheduler — marking them would be
 * ceremony. What is listed here is the business data that accumulates in a
 * list somebody else's test then measures.
 */
const PERSISTENT = [
  "/projects",
  "/tasks",
  "/meetings",
  "/decisions",
  "/drawings",
  "/transmittals",
  "/content/entries",
];

test.describe("test-data hygiene", () => {
  test("every spec that creates persistent data marks it as test-owned", () => {
    const offenders: string[] = [];

    for (const { name, code } of specs()) {
      if (name === "hygiene.spec.ts") continue;

      const creates = PERSISTENT.some((route) =>
        // `.post(`${API}/projects`…` — the shape every spec uses.
        new RegExp(String.raw`\.post\(\s*\`\$\{API\}${route}\``).test(code),
      );
      if (!creates) continue;

      /*
        The marker may arrive three ways: written into a literal, produced by
        `e2eName`/`e2eNumber`, or inherited from a fixture the spec imports.
        All three are legitimate; what is not is a spec that creates rows and
        mentions none of them.
      */
      const marks =
        code.includes(E2E_MARKER) || /e2eName\s*\(|e2eNumber\s*\(/.test(code);

      if (!marks) offenders.push(name);
    }

    expect(
      offenders,
      "these create persistent rows without marking them — use e2eName()/e2eNumber() from fixtures.ts, " +
        "or server/prisma/e2e-cleanup.ts will never find them",
    ).toEqual([]);
  });

  test("found the creating specs, so the assertion above is not vacuous", () => {
    /*
      Guards against a regex that matched nothing, which would make the test
      above pass by comparing an empty list with itself. The same protection
      `login-budget.spec.ts` gives its own assertions, and for the same reason:
      a source check that silently stops matching is worse than no check, because
      it reports success.
    */
    const creating = specs().filter(({ name, code }) =>
      name !== "hygiene.spec.ts" &&
      PERSISTENT.some((route) =>
        new RegExp(String.raw`\.post\(\s*\`\$\{API\}${route}\``).test(code),
      ),
    );
    expect(creating.length, "no spec appears to create persistent data — the regex has drifted")
      .toBeGreaterThan(3);
  });

  /**
   * The cleanup has to exist and has to be wired, or the marking is decoration.
   *
   * Asserted from the repository rather than by running it: this file's job is
   * to fail when somebody removes the mechanism, and a test that invoked the
   * cleanup would be a test that deletes data.
   */
  test("the cleanup script exists and the suite runs it before the tests", () => {
    const cleanup = join(process.cwd(), "server", "prisma", "e2e-cleanup.ts");
    expect(readFileSync(cleanup, "utf8")).toContain(E2E_MARKER);

    const config = readFileSync(join(process.cwd(), "playwright.config.ts"), "utf8");
    expect(config, "playwright.config.ts must declare a globalSetup that clears stale test data")
      .toMatch(/globalSetup/);
  });
});
