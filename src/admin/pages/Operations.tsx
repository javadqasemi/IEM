import { Suspense, useId, useMemo, useState } from "react";
import { cn } from "@/shared/utils/cn";
import { formatDate, formatDateTime, relativeTime } from "@/shared/utils/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
} from "@/shared/ui/primitives";
import {
  DateRangePicker,
  EMPTY_RANGE,
  Field,
  Input,
  SearchInput,
  Select,
  type DateRange,
} from "@/shared/ui/forms";
import { Modal } from "@/shared/ui/overlays";
import { buildFilterChips, type Column, DataView, FilterBar, Pair } from "@/shared/ui/data";
import { useToast } from "@/shared/ui/feedback";
import { useDebounced, useMutation } from "@/shared/hooks";
import { usePageActions } from "@/core/router";
import { actionLabel } from "@/entities/audit";
import { ActivityFeed } from "@/widgets/activity";
import { MfaRoute } from "@/features/mfa";
import { SessionsRoute } from "@/features/sessions";
import { api } from "../lib/api";
import { authRepository, useAuth } from "@/core/auth";
import { THEME_CHOICES, useTheme } from "../lib/theme";
import { useAsync } from "../lib/useAsync";

/**
 * Two screens that share a file: Audit and Profile.
 *
 * It was four and 1'009 lines. **Applications left** for
 * `features/applications/`, which is the reference implementation of the five
 * layers (`docs/enterprise-architecture.md` §3.1.1) — and moving it was worth
 * more than the line count suggests, because it is the screen with rules:
 * retention arithmetic and a status transition table, both of which are now
 * pure functions with tests rather than expressions inside JSX.
 *
 * **Settings left next**, for `features/organisation/`, and it did not survive
 * the move unchanged. What was one page of seven cards and a single Save
 * button is now a workspace with a sub-navigation, a section in the URL, an
 * unsaved-changes guard, per-field validation and a confirmation on the
 * settings whose own descriptions say they weaken a control. The key/value
 * store it read is still there and is now a *part* of that workspace rather
 * than the whole of it — the company's name, addresses and legal identity
 * became columns on `Organisation`, which is where a typed, validated,
 * versioned and audited value can live.
 *
 * The remaining two follow. Each becomes its own feature folder; nothing here
 * needs to change for that, a screen simply leaves.
 */

/* ================================================================== */
/* Audit                                                               */
/* ================================================================== */

const OUTCOME_LABELS: Record<string, string> = {
  SUCCESS: "Erfolgreich",
  FAILURE: "Fehlgeschlagen",
  DENIED: "Verweigert",
};

/**
 * A picked day, widened to the instants the server compares against.
 *
 * `AuditQuery` validates `@IsISO8601()` and the service compares
 * `createdAt >= from` and `<= to`. A bare `2026-03-14` parses as **midnight**,
 * so a range of 14 to 14 March would match a two-millisecond window and return
 * nothing — a filter that looks broken and is arithmetic. `to` therefore ends
 * at the last instant of its day, in local time, which is the day the reader
 * picked rather than the day UTC was having.
 */
const isoStart = (day: string) => (day ? new Date(`${day}T00:00:00`).toISOString() : undefined);
const isoEnd = (day: string) => (day ? new Date(`${day}T23:59:59.999`).toISOString() : undefined);

export function AuditPage() {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [action, setAction] = useState("");
  const [outcome, setOutcome] = useState("");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [detail, setDetail] = useState<import("../lib/api").AuditRow | null>(null);
  const debounced = useDebounced(search);

  /**
   * The date filter the server always supported and the screen never offered.
   *
   * `AuditQuery` has had `from` and `to` since the controller was written, and
   * nothing sent them — so "what happened last Tuesday", which is the question
   * an audit log exists for, could only be answered by paging. Foundation stage
   * F9's `DateRangePicker` is what makes it one click.
   */
  const [range, setRange] = useState<DateRange>(EMPTY_RANGE);

  const clearFilter = (id: string) => {
    if (id === "search") setSearch("");
    if (id === "action") setAction("");
    if (id === "outcome") setOutcome("");
    if (id === "range") setRange(EMPTY_RANGE);
    setPage(1);
  };

  const clearAll = () => {
    setSearch("");
    setAction("");
    setOutcome("");
    setRange(EMPTY_RANGE);
    setPage(1);
  };

  /**
   * The export, declared to the shell rather than drawn on the page.
   *
   * The first real user of `usePageActions` (foundation stage F4), and it is
   * the right one: the button used to sit at the top of the page, which on a
   * 200-row log means out of reach exactly when somebody wants it. The top bar
   * is sticky, so up there it stays.
   *
   * `useMemo` is not an optimisation here — the hook writes its argument into
   * context, so a fresh array every render is an infinite loop. The
   * dependencies are the filters, which is also what makes the export follow
   * what is on screen.
   */
  const pageActions = useMemo(
    () => [
      {
        id: "audit-export",
        label: "Als CSV exportieren",
        permission: "audit.export",
        busy: exporting,
        run: () => {
          setExporting(true);
          api
            // The export follows what is on screen, date range included —
            // otherwise a filtered view and its CSV disagree, which is the one
            // thing an audit export must never do.
            .downloadAuditExport({
              search: debounced,
              action,
              outcome,
              from: isoStart(range.from),
              to: isoEnd(range.to),
            })
            .catch((err: unknown) =>
              toast.error(err instanceof Error ? err.message : "Der Download ist fehlgeschlagen."),
            )
            .finally(() => setExporting(false));
        },
      },
    ],
    [debounced, action, outcome, range.from, range.to, exporting, toast],
  );
  usePageActions(pageActions);

  const actions = useAsync(() => api.auditActions(), []);
  const list = useAsync(
    () =>
      api.audit({
        search: debounced || undefined,
        action: action || undefined,
        outcome: outcome || undefined,
        from: isoStart(range.from),
        to: isoEnd(range.to),
        page,
        perPage: 50,
      }),
    [debounced, action, outcome, range.from, range.to, page],
  );

  const columns: Column<import("../lib/api").AuditRow>[] = [
    {
      key: "when",
      header: "Zeitpunkt",
      className: "w-44",
      sortValue: (r) => r.createdAt,
      render: (r) => (
        <span className="font-mono text-[12px] tnum" title={relativeTime(r.createdAt)}>
          {formatDateTime(r.createdAt)}
        </span>
      ),
    },
    {
      key: "actor",
      header: "Benutzer",
      sortValue: (r) => r.actorEmail ?? "",
      render: (r) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-ink">{r.actor?.name ?? "System"}</span>
          {r.actorEmail ? <span className="text-[11px] text-muted">{r.actorEmail}</span> : null}
        </div>
      ),
    },
    {
      key: "action",
      header: "Aktion",
      sortValue: (r) => r.action,
      render: (r) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-ink">{actionLabel(r.action)}</span>
          <span className="font-mono text-[11px] text-muted">{r.action}</span>
        </div>
      ),
    },
    {
      key: "resource",
      header: "Objekt",
      secondary: true,
      render: (r) => (
        <span className="font-mono text-[12px] text-muted">
          {r.resource}
          {r.resourceId ? `/${r.resourceId.slice(0, 8)}` : ""}
        </span>
      ),
    },
    {
      key: "outcome",
      header: "Ergebnis",
      className: "w-28",
      render: (r) =>
        r.outcome === "SUCCESS" ? (
          <Badge tone="energy">OK</Badge>
        ) : r.outcome === "DENIED" ? (
          <Badge tone="gold">Verweigert</Badge>
        ) : (
          <Badge tone="bronze">Fehler</Badge>
        ),
    },
  ];

  if (list.error) return <ErrorState message={list.error} onRetry={list.reload} />;

  return (
    <>
      <PageHeader
        eyebrow="System"
        title="Audit-Log"
        description="Jede Anmeldung, Änderung, Freigabe und Löschung. Der Eintrag wird beim Ausführen geschrieben und kann nicht nachträglich verändert werden."
      />

      <Card bodyClassName="p-5">
        <DataView
          rows={list.data?.items ?? []}
          columns={columns}
          rowKey={(r) => r.id}
          onRowClick={(r) => setDetail(r)}
          loading={list.loading}
          caption="Audit-Log"
          page={list.data?.page ?? 1}
          pages={list.data?.pages ?? 1}
          total={list.data?.total ?? 0}
          perPage={list.data?.perPage ?? 50}
          onPageChange={setPage}
          toolbar={
            <FilterBar
              className="w-full"
              total={list.data?.total}
              onClear={clearFilter}
              onClearAll={clearAll}
              chips={buildFilterChips(
                { search: debounced, action, outcome, range },
                {
                  search: "Suche",
                  action: "Aktion",
                  outcome: "Ergebnis",
                  range: "Zeitraum",
                },
                {
                  action: (value) => actionLabel(String(value)),
                  outcome: (value) => OUTCOME_LABELS[String(value)] ?? String(value),
                  // The chip reads back what was chosen, not the ISO the server
                  // gets — `2026-03-14` is not how anyone here writes a date.
                  range: (value) => {
                    const r = value as DateRange;
                    if (!r.from && !r.to) return "";
                    return `${formatDate(r.from) } – ${formatDate(r.to)}`;
                  },
                },
              )}
            >
              <SearchInput
                value={search}
                onChange={(v) => {
                  setSearch(v);
                  setPage(1);
                }}
                label="Audit-Log durchsuchen"
                placeholder="Benutzer, Aktion oder Meldung"
                className="w-full sm:w-72"
              />
              <Select
                aria-label="Nach Aktion filtern"
                value={action}
                onChange={(e) => {
                  setAction(e.target.value);
                  setPage(1);
                }}
                placeholder="Alle Aktionen"
                options={(actions.data ?? []).map((a) => ({
                  value: a.action,
                  label: `${actionLabel(a.action)} (${a.count})`,
                }))}
                className="w-auto"
              />
              <Select
                aria-label="Nach Ergebnis filtern"
                value={outcome}
                onChange={(e) => {
                  setOutcome(e.target.value);
                  setPage(1);
                }}
                placeholder="Alle Ergebnisse"
                options={Object.entries(OUTCOME_LABELS).map(([value, label]) => ({ value, label }))}
                className="w-auto"
              />
              <DateRangePicker
                value={range}
                onChange={(next) => {
                  setRange(next);
                  setPage(1);
                }}
              />
            </FilterBar>
          }
          empty={<EmptyState title="Keine Einträge gefunden" />}
        />
      </Card>

      {detail ? (
        <Modal
          open
          onClose={() => setDetail(null)}
          title={actionLabel(detail.action)}
          description={`${detail.actor?.name ?? "System"} · ${formatDateTime(detail.createdAt)}`}
          size="lg"
        >
          <div className="flex flex-col gap-5">
            <dl className="grid gap-x-6 gap-y-3 text-[14px] sm:grid-cols-2">
              <Pair label="Aktion">
                <span className="font-mono text-[13px]">{detail.action}</span>
              </Pair>
              <Pair label="Objekt">
                <span className="font-mono text-[13px]">
                  {detail.resource}
                  {detail.resourceId ? `/${detail.resourceId}` : ""}
                </span>
              </Pair>
              <Pair label="IP">{detail.ip ?? "—"}</Pair>
              <Pair label="Ergebnis">{detail.outcome}</Pair>
            </dl>

            {detail.message ? (
              <div className="flex flex-col gap-1.5">
                <span className="field-label">Meldung</span>
                <p className="text-[14px] leading-relaxed text-ink">{detail.message}</p>
              </div>
            ) : null}

            {/* Before/after. Secret values were removed when the row was
                written — the log never held them. */}
            {detail.before || detail.after ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <span className="field-label">Vorher</span>
                  <pre className="scroll-thin max-h-72 overflow-auto rounded-md bg-brand-bronze/[0.06] p-3 text-[12px] leading-relaxed text-ink ring-1 ring-brand-bronze/20">
                    {detail.before ? JSON.stringify(detail.before, null, 2) : "—"}
                  </pre>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="field-label">Nachher</span>
                  <pre className="scroll-thin max-h-72 overflow-auto rounded-md bg-disc-energy/[0.06] p-3 text-[12px] leading-relaxed text-ink ring-1 ring-disc-energy/20">
                    {detail.after ? JSON.stringify(detail.after, null, 2) : "—"}
                  </pre>
                </div>
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}

/* ================================================================== */
/* Profile                                                             */
/* ================================================================== */

/**
 * The appearance control.
 *
 * On the **profile** page rather than in Einstellungen, and the split is the
 * point: `/einstellungen` holds settings stored on the server that change the
 * system for everyone, while this is stored in this browser and changes nothing
 * for anyone else. Putting a per-browser preference among the SMTP host and the
 * retention period would invite an operator to expect it to travel with their
 * account, which it does not.
 *
 * Radio buttons rather than a toggle, because there are three states. A toggle
 * would force "system" to be spelled some other way, and "follows the machine"
 * is both the default and the one most people want.
 */
function ThemeCard() {
  const { choice, resolved, setChoice } = useTheme();
  const name = useId();

  return (
    <Card
      title="Darstellung"
      description="Gilt nur in diesem Browser. Die Einstellung wird nicht mit dem Konto gespeichert."
    >
      <fieldset className="flex flex-col gap-1">
        <legend className="sr-only">Farbschema</legend>
        {THEME_CHOICES.map((option) => {
          const id = `${name}-${option.value}`;
          const active = choice === option.value;
          return (
            <label
              key={option.value}
              htmlFor={id}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-md px-3 py-2.5 transition-colors",
                active ? "bg-accent/[0.07]" : "hover:bg-surface-2",
              )}
            >
              <input
                id={id}
                type="radio"
                name={name}
                value={option.value}
                checked={active}
                onChange={() => setChoice(option.value)}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer border-field text-accent focus:ring-2 focus:ring-accent"
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[14px] leading-tight text-ink">
                  {option.label}
                  {option.value === "system" ? (
                    // Which way "automatic" currently resolves is the one thing
                    // the label cannot say by itself, and it is what a reader
                    // checks when the choice does not look like it did anything.
                    <span className="text-muted"> · zurzeit {resolved === "dark" ? "dunkel" : "hell"}</span>
                  ) : null}
                </span>
                <span className="text-[12px] leading-snug text-muted">{option.hint}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
    </Card>
  );
}

export function ProfilePage() {
  const { user, reload } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [mismatch, setMismatch] = useState("");

  const change = useMutation(authRepository.changePassword);
  const activity = useAsync(
    () => (user ? api.audit({ actorId: user.id, perPage: 15 }) : Promise.resolve(null)),
    [user?.id],
  );

  if (!user) return null;

  return (
    <>
      <PageHeader eyebrow="Profil" title={user.name} description={user.email} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Konto">
          <dl className="flex flex-col gap-3 text-[14px]">
            <Pair label="Rollen">
              <div className="flex flex-wrap gap-1 pt-0.5">
                {user.roles.map((r) => (
                  <Badge key={r.key} tone={r.key === "super_admin" ? "navy" : "neutral"}>
                    {r.name}
                  </Badge>
                ))}
              </div>
            </Pair>
            <Pair label="Berechtigungen">
              {user.isSuperAdmin ? "Alle (Super Admin)" : `${user.permissions.length}`}
            </Pair>
            <Pair label="Zuletzt angemeldet">{formatDateTime(user.lastLoginAt)}</Pair>
          </dl>
        </Card>

        <ThemeCard />

        <Card
          title="Passwort ändern"
          description="Beim Ändern werden alle anderen offenen Sitzungen beendet."
        >
          <form
            className="flex flex-col gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (next !== repeat) {
                setMismatch("Die beiden neuen Passwörter stimmen nicht überein.");
                return;
              }
              setMismatch("");
              const ok = await change.run(current, next);
              if (ok !== null && !change.error) {
                toast.success("Passwort geändert", "Andere Sitzungen wurden abgemeldet.");
                setCurrent("");
                setNext("");
                setRepeat("");
                void reload();
              }
            }}
          >
            <Field label="Aktuelles Passwort" htmlFor="pw-current">
              <Input
                id="pw-current"
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password"
                required
              />
            </Field>
            <Field
              label="Neues Passwort"
              htmlFor="pw-new"
              hint="Mindestens 12 Zeichen. Länge zählt mehr als Sonderzeichen."
            >
              <Input
                id="pw-new"
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
                minLength={12}
                required
              />
            </Field>
            <Field label="Wiederholen" htmlFor="pw-repeat" error={mismatch || undefined}>
              <Input
                id="pw-repeat"
                type="password"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
                autoComplete="new-password"
                minLength={12}
                invalid={Boolean(mismatch)}
                required
              />
            </Field>

            {change.error ? (
              <p role="alert" className="text-[13px] font-medium text-brand-bronze">
                {change.error}
              </p>
            ) : null}

            <div>
              <Button type="submit" variant="primary" busy={change.busy}>
                Passwort ändern
              </Button>
            </div>
          </form>
        </Card>
      </div>

      {/*
        Zwei-Faktor-Authentisierung — the feature's own slice, composed here.

        Above Sitzungen on purpose: the two belong to one subject, and the
        order is the order somebody thinks about it. "How is this account
        protected" comes before "where is it signed in", and a reader who has
        just noticed a session they do not recognise should already have met
        the control that stops the next one.

        `admin/pages` is the layer above both `features/` and `widgets/`, so
        it is the only place allowed to import a feature — the same rule that
        puts the project detail's embedded tabs in `ProjectPage.tsx`.
      */}
      <Suspense fallback={<Skeleton className="h-48 rounded-lg" />}>
        <MfaRoute account={user.email} />
      </Suspense>

      {/*
        Sitzungen — the feature's own slice, composed in here.

        `admin/pages` is the layer above both `features/` and `widgets/`, so
        it is the only place allowed to import a feature — the same rule that
        puts the project detail's embedded tabs in `ProjectPage.tsx` rather
        than inside either feature. `Suspense` because the card is behind a
        `lazy()` boundary: it holds a table and two dialogs that every signed
        in user would otherwise download and almost none of them open.

        `onSignedOut` is the one thing the card cannot do for itself. Ending
        your own session leaves this tab holding a refresh token the server
        has already refused, and only the shell knows how to put the reader
        back at the sign-in screen.
      */}
      <Suspense fallback={<Skeleton className="h-64 rounded-lg" />}>
        <SessionsRoute onSignedOut={() => void authRepository.logout().then(reload)} />
      </Suspense>

      <Card title="Ihre letzten Aktionen" bodyClassName="px-5 py-1">
        {activity.loading ? (
          <Skeleton className="h-32" />
        ) : (
          <ActivityFeed
            items={(activity.data?.items ?? []).map((a) => ({
              id: a.id,
              action: a.action,
              actor: "Sie",
              target: a.resource,
              message: a.message,
              outcome: a.outcome,
              at: a.createdAt,
            }))}
          />
        )}
      </Card>
    </>
  );
}
