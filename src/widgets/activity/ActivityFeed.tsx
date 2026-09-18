import { cn } from "@/shared/utils/cn";
import { relativeTime } from "@/shared/utils/format";
import { actionLabel, type ActivityItem } from "@/entities/audit";

/**
 * The audit feed.
 *
 * A widget rather than a shared component, because it is the one block that
 * reads the audit domain and is rendered from several places — the dashboard,
 * the audit screen and, later, a project's own activity tab. That is the
 * definition `widgets/` carries: composed, cross-feature, and allowed to know
 * what it is showing.
 */
export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (!items.length) {
    return <p className="py-6 text-center text-[13px] text-muted">Noch keine Aktivität.</p>;
  }
  return (
    <ol className="flex flex-col">
      {items.map((item) => (
        <li key={item.id} className="flex gap-3 border-b border-line py-3 last:border-0">
          <span
            aria-hidden
            className={cn(
              "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
              item.outcome === "FAILURE" || item.outcome === "DENIED"
                ? "bg-brand-bronze"
                : "bg-brand-blue/50",
            )}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="text-[13px] leading-snug text-ink">
              <span className="font-medium">{item.actor}</span> {actionLabel(item.action)}
              {item.target ? <span className="text-muted"> · {item.target}</span> : null}
            </p>
            {item.message ? (
              <p className="truncate text-[12px] text-muted" title={item.message}>
                {item.message}
              </p>
            ) : null}
          </div>
          <time
            dateTime={item.at}
            className="shrink-0 font-mono text-[11px] tnum text-muted"
            title={new Date(item.at).toLocaleString("de-CH")}
          >
            {relativeTime(item.at)}
          </time>
        </li>
      ))}
    </ol>
  );
}
