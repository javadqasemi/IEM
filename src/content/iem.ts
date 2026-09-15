/**
 * The content module's public entry.
 *
 * What changed, and why every component import had to move: the page's data is
 * no longer a set of module constants. It is a value in `./store`, seeded with
 * `./defaults` and replaced by whatever the dashboard has published. So a
 * component reads `useContent()` instead of importing `projects`, and the
 * *shapes* — types, closed sets, ordering helpers — still come from here,
 * because those are structural and the CMS cannot change them.
 *
 * The rule for anything added later:
 *
 * - **Editable data** → a field on `SiteContent`, read through `useContent()`.
 * - **Structure** (a union, a sort order, a key) → an export from `./schema`,
 *   re-exported here, never in the database.
 *
 * `src/content/` now holds five files:
 *
 * | File | Job |
 * | --- | --- |
 * | `schema.ts` | The contract — types and closed sets. No data. |
 * | `defaults.ts` | One complete value of it: boot snapshot, offline fallback, DB seed. |
 * | `store.ts` | Which value is current, and how a published one arrives. |
 * | `derive.ts` | Figures the page computes, and the `{token}` syntax for copy. |
 * | `iem.ts` | This file — what the rest of `src/` imports. |
 */

/* ---- Shapes ---- */
export type {
  Bauakt,
  BewerbungCopy,
  ButtonVariant,
  ContactCopy,
  CtaCopy,
  Discipline,
  DisciplineKey,
  Facts,
  FooterCopy,
  HeroCopy,
  JobCategory,
  JobDetail,
  KpiCopy,
  KpiTone,
  LeitbildStatement,
  Member,
  NavItem,
  OfficeEntry,
  Opening,
  Phase,
  Project,
  ProjectDetails,
  PublishedSnapshot,
  SectionCopy,
  SeoConfig,
  Service,
  SiteContent,
  Social,
  Sponsorship,
  Tone,
  Trade,
  UseCategory,
} from "./schema";

/* ---- Closed sets and ordering ---- */
export {
  disciplineOrder,
  inHLKSE,
  jobCategories,
  toneValues,
  trades,
  useCategories,
} from "./schema";

/* ---- The live content ---- */
export { getContent, getVersion, hydrate, setContent, useContent, useHydrated } from "./store";

/* ---- Derived figures and copy tokens ---- */
export { companyFactsOf, figuresOf, resolveTokens, tokenHelp, zahlwort } from "./derive";

/* ---- The seed, for the dashboard's "reset to published default" and the
       database seeder. The page itself must not import this: it would pin the
       component to the build-time copy and quietly ignore every publish. ---- */
export { defaultContent } from "./defaults";
