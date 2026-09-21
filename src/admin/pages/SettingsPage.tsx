import { SettingsRoute } from "@/features/organisation";
import { NotificationRulesRoute } from "@/features/notifications";
import { MailSection } from "@/features/mail";

/**
 * Einstellungen, with the sections other features own composed into it.
 *
 * **The same arrangement — and the same reason — as `ProjectPage.tsx`.**
 * `features/organisation` owns the workspace and may not import
 * `features/notifications`; `widgets/` may not import a feature at all.
 * `src/architecture.test.ts` enforces both arrows, so the shell is the one
 * layer where the composition is legal.
 *
 * It is not bureaucracy. It is what keeps the settings workspace from
 * accumulating a piece of every module that ever needs a screen in it: the
 * organisation feature cannot grow a notification dependency, because it
 * cannot name one. What it declares instead is a *slot* —
 * `{ kind: "embedded" }` in `SETTINGS_SECTIONS` — and a slug nobody supplies
 * renders a placeholder rather than breaking.
 *
 * **This map is the roadmap, in code**, exactly as `ProjectPage`'s is. Backup
 * and Integrations are the next two sections that will want one; each is an
 * import and a line, with nothing in `features/organisation` changing.
 */
const EMBEDDED = {
  benachrichtigungen: <NotificationRulesRoute />,
  /**
   * E-Mail is the first section to use the map **additively** (P2-4).
   *
   * Its declaration is `{ kind: "settings", groups: ["E-Mail"], panel: true }`,
   * so the workspace renders the configuration form from the settings
   * declarations and puts this panel underneath it. The form keeps the save
   * bar, the dirty guard and the validation every other settings group has;
   * the panel adds the status verdict, the two diagnostics and the template
   * catalogue, none of which a setting declaration can express.
   */
  email: <MailSection />,
};

export function SettingsPage({ section }: { section?: string }) {
  return <SettingsRoute section={section} embedded={EMBEDDED} />;
}
