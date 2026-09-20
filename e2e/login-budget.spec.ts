import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./fixtures";

/**
 * The suite does not exceed the sign-in limit, and it does not do so
 * *deterministically*.
 *
 * `/auth/login` allows ten attempts a minute per IP. That limit is a real
 * control and does not move for the benefit of tests — so the tests pace
 * themselves against it, through `spendLogin()` in `fixtures.ts`.
 *
 * The failure this guards against is the one CLAUDE.md records three times and
 * which has never once looked like what it was: a spec two files away reports
 * `Hauptnavigation not found` over a screenshot of the login page, and reads as
 * a broken shell. It happens because six different code paths reach
 * `/auth/login` and any new one silently opts out of the budget.
 *
 * So this is a **source assertion**, not a behavioural one. There is no way to
 * observe "nobody bypassed the pacer" at runtime — a bypass only shows up as
 * somebody else's flake, minutes later, in whichever spec happened to be
 * eleventh. Reading the files is the only check that fails in the right place.
 */

const E2E = __dirname;

/** Every spec and helper in the suite, with its comments stripped. */
function sources(): { name: string; code: string }[] {
  return readdirSync(E2E)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({
      name,
      code: readFileSync(join(E2E, name), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1"),
    }));
}

test.describe("the sign-in budget", () => {
  test("every path to /auth/login reserves an attempt first", () => {
    /*
      A file may POST to `/auth/login` only if it also calls `spendLogin()`.

      Deliberately coarse — it does not prove the call is *before* the request,
      or that the counts match. A finer check would need a parser, and the
      failure it is worth catching is a whole new sign-in helper that never
      heard of the budget, not an off-by-one.
    */
    const offenders = sources()
      .filter(({ code }) => /auth\/login/.test(code))
      .filter(({ code }) => !/spendLogin\s*\(/.test(code))
      .map(({ name }) => name);

    expect(
      offenders,
      "these POST to /auth/login without calling spendLogin() — see fixtures.ts",
    ).toEqual([]);
  });

  test("every browser sign-in reserves an attempt first", () => {
    // The form path costs the same as the API one and is the easier to forget,
    // because it looks like a click rather than a request.
    const offenders = sources()
      .filter(({ name }) => name !== "login-budget.spec.ts")
      .filter(({ code }) => /name:\s*\/\^Anmelden\$\/\s*\}\s*\)\s*\.click\(\)/.test(code))
      .filter(({ code }) => !/spendLogin\s*\(/.test(code))
      .map(({ name }) => name);

    expect(
      offenders,
      "these click Anmelden without calling spendLogin() — see fixtures.ts",
    ).toEqual([]);
  });

  test("found the sign-in paths, so the assertions above are not vacuous", () => {
    // Guards against a regex that matched nothing, which would make both tests
    // above pass by comparing an empty list with itself.
    const withLogins = sources().filter(({ code }) => /spendLogin\s*\(/.test(code));
    expect(withLogins.length, "no file calls spendLogin() at all").toBeGreaterThan(2);
  });

  /*
    There is deliberately **no test that calls `spendLogin()`**.

    The obvious one — spend nine and assert the ninth waited — would consume
    real attempts from the budget the rest of the run shares, so a test of the
    pacer would be a cause of the thing the pacer prevents. Its arithmetic is
    a handful of lines over an array of timestamps and is visible on the page;
    what is *not* visible, and what costs hours when it is wrong, is a new
    sign-in path that never joined in. That is what the three assertions above
    are for.
  */
});
