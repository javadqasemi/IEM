import { Badge, Card } from "@/shared/ui/primitives";

/**
 * What a tab shows when its module does not exist yet.
 *
 * **Set by the firm, and it replaced a worse plan.** The architecture said the
 * unbuilt tabs of the project view would "stay empty until their module
 * exists"; the review's answer was that an empty tab is indistinguishable from
 * a broken one. Somebody clicks *Pläne*, sees nothing, and reasonably concludes
 * the page failed to load or that this project has no drawings — which is a
 * statement about the data, and it is false.
 *
 * So a placeholder says three things instead:
 *
 * 1. **what the module will do**, in one sentence, so the tab explains itself
 *    rather than merely promising something;
 * 2. **that it is not implemented**, in those words, so nobody reads the empty
 *    state as data;
 * 3. **its status** — `Geplant` or `In Entwicklung` — so the reader knows
 *    whether to expect it soon.
 *
 * And it does so **inside the same `Card` and layout the real screen will
 * use**. That is the part worth defending: a placeholder with a different shape
 * means the tab jumps when the module lands, and the navigation is never seen
 * at its real proportions until the last module ships. The outline rows below
 * are not decoration — they are the shape of the list that will replace them.
 */

export type ModuleStatus = "planned" | "in-progress";

const STATUS_META: Record<ModuleStatus, { label: string; tone: "neutral" | "gold" }> = {
  planned: { label: "Geplant", tone: "neutral" },
  "in-progress": { label: "In Entwicklung", tone: "gold" },
};

export function ModulePlaceholder({
  title,
  description,
  status = "planned",
  rows = 3,
  wave,
}: {
  /** What the module is called — the same word as the tab. */
  title: string;
  /** One sentence on what it will do. Written for the reader, not the backlog. */
  description: string;
  status?: ModuleStatus;
  /** How many outline rows to draw. Match the real screen's density. */
  rows?: number;
  /** e.g. `"Wave 2"`. Shown only when known; a vague date is worse than none. */
  wave?: string;
}) {
  const meta = STATUS_META[status];

  return (
    <Card
      title={title}
      description={description}
      action={
        <div className="flex items-center gap-2">
          <Badge tone={meta.tone}>{meta.label}</Badge>
          {wave ? <Badge tone="neutral">{wave}</Badge> : null}
        </div>
      }
    >
      <p className="text-[14px] font-medium text-ink">Dieses Modul ist noch nicht implementiert.</p>

      {/*
        The outline of the screen that will stand here.

        `aria-hidden`, because it says nothing: a screen reader announcing three
        empty rows would be describing furniture. The sentence above is the
        accessible content and is complete on its own, which is the test for
        whether a decorative element is safe to hide.
      */}
      <div aria-hidden className="mt-4 space-y-2">
        {Array.from({ length: rows }, (_, index) => (
          <div
            key={index}
            className="flex items-center gap-3 rounded-lg border border-dashed border-line px-3 py-2.5"
          >
            <span className="h-2 w-2 shrink-0 rounded-full bg-line" />
            <span
              className="h-2 flex-1 rounded-full bg-line"
              style={{ maxWidth: `${70 - index * 12}%` }}
            />
          </div>
        ))}
      </div>
    </Card>
  );
}
