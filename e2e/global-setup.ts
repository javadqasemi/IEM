import { spawnSync } from "node:child_process";

/**
 * Clears stale test-owned data before the suite runs.
 *
 * ---
 *
 * ## Before, not after — and that is the whole design
 *
 * A cleanup that runs afterwards is exactly the one a crash skips. Running it
 * first means the state a previous run died in is the state this one begins by
 * clearing, and the only thing the previous run had to do was **label** its
 * work — which it does at creation time, not at exit.
 *
 * That matters because the failure it prevents was not hypothetical. One
 * seeded project had accumulated **782 drawings** where the seed makes six,
 * plus 857 tasks, 852 meetings and 595 decisions, from runs that crashed, timed
 * out, or created something the domain then rightly refused to delete. The
 * Planversand dialog asks for a page of 100 plans, so a plan the test had just
 * created was not in the list — and two full suite runs went on diagnosing a
 * module defect that did not exist.
 *
 * ## Why it shells out rather than importing Prisma
 *
 * The root package has no database client and should not grow one for this.
 * `server/` already has Prisma, the adapter and `tsx`, and already runs
 * `seed.ts` exactly this way. Reusing that toolchain costs nothing and means
 * the cleanup is written against the same schema types as the application.
 *
 * ## It never fails the run
 *
 * A database that is briefly unreachable must not read as a broken suite —
 * and the worst case of skipping the cleanup is the state it exists to fix,
 * which is visible and recoverable. So a failure is reported and the suite
 * proceeds; `hygiene.spec.ts` is what fails the build when the *mechanism*
 * goes missing, which is the thing worth being strict about.
 */
export default function globalSetup(): void {
  const started = Date.now();

  const result = spawnSync("npm", ["--prefix", "server", "run", "e2e:cleanup"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    console.warn(
      "\n⚠ E2E-Aufräumen fehlgeschlagen — der Lauf geht weiter.\n" +
        "  Alte Testdaten können Ergebnisse verfälschen: npm --prefix server run e2e:cleanup\n",
    );
    return;
  }

  console.log(`  (Aufräumen in ${Date.now() - started} ms)\n`);
}
