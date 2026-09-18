import { useId, useMemo, useState } from "react";
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
  Toggle,
  type DateRange,
} from "@/shared/ui/forms";
import { Modal } from "@/shared/ui/overlays";
import { buildFilterChips, type Column, DataView, FilterBar, Pair } from "@/shared/ui/data";
import { useToast } from "@/shared/ui/feedback";
import { useDebounced, useMutation } from "@/shared/hooks";
import { usePageActions } from "@/core/router";
import { actionLabel } from "@/entities/audit";
import { ActivityFeed } from "@/widgets/activity";
import { api, type SettingRow } from "../lib/api";
import { authRepository, useAuth } from "@/core/auth";
import { THEME_CHOICES, useTheme } from "../lib/theme";
import { useAsync } from "../lib/useAsync";

/**
 * Three screens that share a file: Settings, Audit and Profile.
 *
 * It was four and 1'009 lines. **Applications left** for
 * `features/applications/`, which is the reference implementation of the five
 * layers (`docs/enterprise-architecture.md` §3.1.1) — and moving it was worth
 * more than the line count suggests, because it is the screen with rules:
 * retention arithmetic and a status transition table, both of which are now
 * pure functions with tests rather than expressions inside JSX.
 *
 * The remaining three follow in Stage D. Each becomes its own feature folder;
 * nothing here needs to change for that, a screen simply leaves.
 */

/* ================================================================== */
/* Settings                                                            */
/* ================================================================== */

export function SettingsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const settings = useAsync(() => api.settings(), []);
  const [changes, setChanges] = useState<Record<string, unknown>>({});
  const save = useMutation(api.updateSettings);

  if (settings.error) return <ErrorState message={settings.error} onRetry={settings.reload} />;

  const dirty = Object.keys(changes).length > 0;

  return (
    <>
      <PageHeader
        eyebrow="Einstellungen"
        title="System und Betrieb"
        description="Unternehmensangaben, E-Mail-Versand, Aufbewahrungsfristen und Sicherheitsvorgaben."
        actions={
          can("settings.update") ? (
            <Button
              variant="primary"
              disabled={!dirty}
              busy={save.busy}
              onClick={async () => {
                const updates = Object.entries(changes).map(([key, value]) => ({ key, value }));
                const ok = await save.run(updates);
                if (ok) {
                  setChanges({});
                  toast.success("Gespeichert", `${updates.length} Einstellung(en) übernommen.`);
                  settings.reload();
                }
              }}
            >
              Speichern
            </Button>
          ) : null
        }
      />

      {save.error ? <ErrorState title="Speichern fehlgeschlagen" message={save.error} /> : null}

      {settings.loading ? (
        <div className="flex flex-col gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-56 rounded-lg" />
          ))}
        </div>
      ) : (
        (settings.data ?? []).map((group) => (
          <Card key={group.group} title={group.group}>
            <div className="flex flex-col gap-5">
              {group.settings.map((setting) => (
                <SettingField
                  key={setting.key}
                  setting={setting}
                  value={changes[setting.key] ?? setting.value}
                  disabled={
                    !can("settings.update") ||
                    (setting.secret && !can("settings.secrets"))
                  }
                  onChange={(next) => setChanges({ ...changes, [setting.key]: next })}
                />
              ))}
            </div>
          </Card>
        ))
      )}
    </>
  );
}

/**
 * One setting, rendered from the shape of its stored value.
 *
 * The type is inferred rather than declared, which is the honest reflection of
 * a JSON column: a boolean gets a toggle, a number a numeric input, an array a
 * comma list, everything else a text box. A secret shows its mask and writing
 * the mask back is a no-op on the server, so saving the SMTP form without
 * retyping the password does not blank it.
 *
 * **`pending` marks a setting nothing reads yet**, and it is drawn differently
 * rather than hidden. An audit of this screen found that 23 of the 25 settings
 * were stored, editable, and consumed by no code — the SMTP block configured
 * nothing because mail came from the environment, and `workflow.requireApproval`
 * described lifting the four-eyes principle while doing nothing at all, so an
 * operator could as easily have believed they were switching it *on*. Most are
 * now wired; the rest say so.
 *
 * Saying so beats hiding them: they are the shape of half-built features —
 * `security.requireMfaForAdmins` has its columns and its dependency but no
 * enrolment flow — and an operator looking for the MFA switch should find it
 * with an explanation rather than not find it. It is the same choice the
 * executive dashboard makes with `KpiUnavailable`: a figure with no source shown
 * as a gap rather than as a zero.
 */
function SettingField({
  setting,
  value,
  onChange,
  disabled,
}: {
  setting: SettingRow;
  value: unknown;
  onChange: (next: unknown) => void;
  disabled?: boolean;
}) {
  const id = `setting-${setting.key}`;

  /** The key line, plus a plain statement when nothing reads the value. */
  const hint = setting.pending
    ? `${setting.key} · der Wert wird gespeichert, aber noch von nichts gelesen`
    : setting.secret
      ? `${setting.key} · ${setting.hasValue ? "gesetzt" : "nicht gesetzt"} — leer lassen, um den Wert zu behalten`
      : setting.key;

  /**
   * A badge, not a dimmed block.
   *
   * `opacity-60` on the wrapper was the first attempt, and an axe pass measured
   * what it did: it multiplies through to the text inside, dropping the hint
   * from `muted` to **2.54:1** in the light theme and 3.43:1 in the dark. The
   * information — "nothing reads this yet" — was being carried by the one
   * property that also makes it hard to read.
   *
   * A label says it outright, at full contrast, and says it more precisely than
   * a shade could.
   */
  const pendingMark = setting.pending ? (
    <Badge tone="neutral">noch nicht angebunden</Badge>
  ) : null;

  if (typeof setting.value === "boolean") {
    return (
      <div className="flex flex-col gap-1.5">
        {pendingMark}
        <Toggle
          label={setting.description ?? setting.key}
          hint={hint}
          checked={Boolean(value)}
          onChange={onChange}
          disabled={disabled}
        />
      </div>
    );
  }

  return (
    <Field
      label={setting.description ?? setting.key}
      htmlFor={id}
      hint={hint}
      action={pendingMark}
    >
      {Array.isArray(setting.value) ? (
        <Input
          id={id}
          disabled={disabled}
          value={(value as string[])?.join(", ") ?? ""}
          onChange={(e) =>
            onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))
          }
        />
      ) : typeof setting.value === "number" ? (
        <Input
          id={id}
          type="number"
          disabled={disabled}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
        />
      ) : (
        <Input
          id={id}
          disabled={disabled}
          type={setting.secret ? "password" : "text"}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={setting.secret ? "new-password" : undefined}
        />
      )}
    </Field>
  );
}

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
