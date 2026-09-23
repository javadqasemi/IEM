import { Suspense, useEffect, useMemo, useState } from "react";
import { formatDateTime, relativeTime } from "@/shared/utils/format";
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Skeleton } from "@/shared/ui/primitives";
import { Checkbox, Field, Input, SearchInput, Select, Textarea } from "@/shared/ui/forms";
import { ConfirmDialog, Modal, ReauthenticationDialog } from "@/shared/ui/overlays";
import { type Column, DataView } from "@/shared/ui/data";
import { useToast } from "@/shared/ui/feedback";
import { UserMfaRoute } from "@/features/mfa";
import { UserSessionsRoute } from "@/features/sessions";
import { ApiError, toFailure } from "@/core/api";
import { api, type RoleRow, type UserRow } from "../lib/api";
import { authRepository, useAuth } from "@/core/auth";
import { useDebounced, useMutation } from "@/shared/hooks";
import { useAsync } from "../lib/useAsync";

/* ================================================================== */
/* Privilege changes                                                   */
/* ================================================================== */

/**
 * "Prove it again, then I'll do it" — for the privilege changes on this page.
 *
 * Granting privileged permissions (user administration, settings, restore,
 * publishing …) needs the actor's password again; granting Viewer does not.
 * The rule lives on the server (`privilege.rules.ts`), and this page does not
 * copy it: it submits, and when the answer is `reauth_required` it opens the
 * password dialog and repeats the same call with the window it produced.
 *
 * `intercept` returns true when it has taken the error over, so a caller's
 * `catch` reads `if (reauth.intercept(err, retry)) return;` and handles
 * everything else as before.
 */
function useReauthRetry() {
  const { user: me } = useAuth();
  const [pending, setPending] = useState<{
    message: string;
    retry: (token: string) => Promise<void>;
  } | null>(null);

  function intercept(err: unknown, retry: (token: string) => Promise<void>): boolean {
    if (err instanceof ApiError && err.code === "reauth_required") {
      setPending({ message: err.message, retry });
      return true;
    }
    return false;
  }

  const dialog = (
    <ReauthenticationDialog
      open={Boolean(pending)}
      onClose={() => setPending(null)}
      authenticate={authRepository.reauthenticate}
      // The *caller's* factor, as on the MFA reset — see `UserMfaPanel`.
      requiresCode={Boolean(me?.mfaEnabled)}
      title="Rechtevergabe bestätigen"
      confirmLabel="Bestätigen und speichern"
      description="Diese Änderung vergibt weitreichende Rechte."
      message={pending?.message}
      onConfirmed={async (token) => {
        const job = pending;
        if (job) await job.retry(token);
      }}
    />
  );

  return { intercept, dialog };
}

/** The one sentence for a failure — normalised, so a 5xx is not "Internal server error". */
function messageOf(err: unknown): string {
  return toFailure(err).message;
}

/* ================================================================== */
/* Users                                                               */
/* ================================================================== */

export function UsersPage() {
  const { can, user: me } = useAuth();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [invite, setInvite] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<UserRow | null>(null);
  const debounced = useDebounced(search);

  const roles = useAsync(() => api.roles(), []);
  const list = useAsync(
    () => api.users({ search: debounced || undefined, status: status || undefined, page, perPage: 50 }),
    [debounced, status, page],
  );

  const remove = useMutation(api.deleteUser);
  const sendReset = useMutation(api.sendUserReset);

  /*
    Whether a row's account holds more than the reader does — the server's
    `refuseAdminister`, read off its `grantable` flags rather than copied.
    Such an account gets no reset-link or delete button: both would 403.
  */
  const notGrantable = new Set((roles.data ?? []).filter((r) => r.grantable === false).map((r) => r.id));
  const above = (r: UserRow) => r.id !== me?.id && r.roles.some((x) => notGrantable.has(x.role.id));

  const columns: Column<UserRow>[] = [
    {
      key: "name",
      header: "Name",
      sortValue: (r) => r.name,
      render: (r) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-ink">
            {r.name}
            {r.id === me?.id ? <span className="ml-2 text-[11px] text-muted">(Sie)</span> : null}
          </span>
          <span className="text-[12px] text-muted">{r.email}</span>
        </div>
      ),
    },
    {
      key: "roles",
      header: "Rollen",
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.roles.length ? (
            r.roles.map((x) => (
              <Badge key={x.role.id} tone={x.role.key === "super_admin" ? "navy" : "neutral"}>
                {x.role.name}
              </Badge>
            ))
          ) : (
            // Not cosmetic: a user with no role can sign in and see nothing,
            // which reads as a broken dashboard rather than as missing setup.
            <span className="text-[12px] text-brand-bronze">Keine Rolle</span>
          )}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      className: "w-32",
      sortValue: (r) => r.status,
      render: (r) => <UserStatusBadge user={r} />,
    },
    {
      /*
        Whether the account has a second factor, on the list rather than only
        in the dialog.

        It is the column somebody scans when they want to know how far the
        firm has got with it, and that question is asked of the *whole list*
        — one row at a time through a dialog is how it stops being asked.
        The value is already on the row, so it costs no request.

        Off is `—` rather than a badge: most accounts will be off for a
        while, and a column of warning chips would make the list read as a
        list of problems. The absence is visible without being loud.
      */
      key: "mfa",
      header: "2FA",
      className: "w-20",
      secondary: true,
      sortValue: (r) => (r.mfaEnabled ? "1" : "0"),
      render: (r) =>
        r.mfaEnabled ? (
          <Badge tone="energy">Aktiv</Badge>
        ) : (
          <span className="text-muted" title="Keine Zwei-Faktor-Authentisierung">
            —
          </span>
        ),
    },
    {
      key: "lastLogin",
      header: "Zuletzt aktiv",
      secondary: true,
      className: "w-36",
      sortValue: (r) => r.lastLoginAt ?? "",
      render: (r) =>
        r.lastLoginAt ? (
          <span title={formatDateTime(r.lastLoginAt)}>{relativeTime(r.lastLoginAt)}</span>
        ) : (
          <span className="text-muted">nie</span>
        ),
    },
    {
      key: "actions",
      header: "",
      className: "w-px",
      render: (r) => (
        <div className="flex justify-end gap-1">
          {can("user.update") && !above(r) ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={sendReset.busy}
              onClick={async () => {
                const result = await sendReset.run(r.id);
                if (!result.ok) {
                  toast.error("Link nicht verschickt", result.failure.message);
                  return;
                }
                toast.success("Link verschickt", `${r.email} kann ein neues Passwort setzen.`);
              }}
            >
              Passwortlink
            </Button>
          ) : null}
          {can("user.delete") && r.id !== me?.id && !above(r) ? (
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(r)}>
              Löschen
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Benutzer"
        title="Zugänge zum Dashboard"
        description="Wer sich anmelden darf und was er oder sie tun kann. Eingeladene Personen setzen ihr Passwort selbst — es wird keines verschickt."
        actions={
          can("user.create") ? (
            <Button variant="primary" onClick={() => setInvite(true)}>
              + Einladen
            </Button>
          ) : null
        }
      />

      <Card bodyClassName="p-5">
        <DataView
          rows={list.data?.items ?? []}
          columns={columns}
          rowKey={(r) => r.id}
          open={can("user.assign") ? { onOpen: (r) => setEditing(r) } : undefined}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          caption="Benutzerkonten"
          page={list.data?.page ?? 1}
          pages={list.data?.pages ?? 1}
          total={list.data?.total ?? 0}
          perPage={list.data?.perPage ?? 50}
          onPageChange={setPage}
          toolbar={
            <>
              <SearchInput
                value={search}
                onChange={(v) => {
                  setSearch(v);
                  setPage(1);
                }}
                label="Benutzer durchsuchen"
                placeholder="Name oder E-Mail"
                className="w-full sm:w-72"
              />
              <Select
                aria-label="Nach Status filtern"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
                placeholder="Alle"
                options={[
                  { value: "ACTIVE", label: "Aktiv" },
                  { value: "INVITED", label: "Eingeladen" },
                  { value: "SUSPENDED", label: "Gesperrt" },
                ]}
                className="w-auto"
              />
            </>
          }
          empty={<EmptyState title="Keine Benutzer gefunden" />}
        />
      </Card>

      <InviteDialog
        open={invite}
        onClose={() => setInvite(false)}
        roles={roles.data ?? []}
        onDone={() => {
          list.reload();
          toast.success("Eingeladen", "Eine E-Mail mit einem Link zum Passwortsetzen ist unterwegs.");
        }}
      />

      <EditUserDialog
        user={editing}
        onClose={() => setEditing(null)}
        roles={roles.data ?? []}
        onDone={() => {
          list.reload();
          toast.success("Gespeichert");
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onClose={() => {
          setConfirmDelete(null);
          remove.reset();
        }}
        busy={remove.busy}
        destructive
        confirmText="LÖSCHEN"
        title="Benutzer löschen?"
        confirmLabel="Löschen"
        message={
          <>
            <p>
              „{confirmDelete?.name}“ verliert sofort jeden Zugang und alle offenen Sitzungen werden
              beendet.
            </p>
            <p className="mt-2">
              Der Name bleibt im Audit-Log erhalten, damit vergangene Änderungen zuordenbar bleiben.
            </p>
            {remove.error ? (
              <p role="alert" className="mt-3 font-medium text-brand-bronze">
                {remove.error}
              </p>
            ) : null}
          </>
        }
        onConfirm={async () => {
          if (!confirmDelete) return;
          const result = await remove.run(confirmDelete.id);
          // A refusal — the privilege ceiling, the last Super Admin — stays in
          // the dialog, beside the account it is about.
          if (!result.ok) return;
          toast.success("Gelöscht", confirmDelete.name);
          setConfirmDelete(null);
          list.reload();
        }}
      />
    </>
  );
}

function UserStatusBadge({ user }: { user: UserRow }) {
  if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    return <Badge tone="bronze">Gesperrt bis {relativeTime(user.lockedUntil)}</Badge>;
  }
  if (user.status === "ACTIVE") return <Badge tone="energy">Aktiv</Badge>;
  if (user.status === "INVITED") return <Badge tone="gold">Eingeladen</Badge>;
  return <Badge tone="bronze">Deaktiviert</Badge>;
}

function InviteDialog({
  open,
  onClose,
  roles,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  roles: RoleRow[];
  onDone: () => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const reauth = useReauthRetry();

  useEffect(() => {
    if (open) {
      setEmail("");
      setName("");
      setRoleIds([]);
      setError(null);
      setFields({});
    }
  }, [open]);

  /*
    Direct rather than through `useMutation`: that hook turns an error into a
    string, and the one error this needs to recognise — `reauth_required` —
    is identified by its code. A retry with a window throws into the password
    dialog, which shows the message itself.
  */
  async function submit(token?: string) {
    if (token) {
      await api.inviteUser(email, name, roleIds, token);
      onDone();
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await api.inviteUser(email, name, roleIds);
      onDone();
      onClose();
    } catch (err) {
      if (reauth.intercept(err, submit)) return;
      setError(messageOf(err));
      if (err instanceof ApiError) setFields(err.fields ?? {});
    } finally {
      setBusy(false);
    }
  }
  const invite = { busy, error, fields };
  /** Why "Einladen" cannot be pressed yet, in the order the form asks. */
  const inviteBlocked = !name.trim()
    ? "Name fehlt."
    : !email.trim()
      ? "E-Mail fehlt."
      : !roleIds.length
        ? "Mindestens eine Rolle wählen."
        : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Benutzer einladen"
      description="Die Person erhält einen Link und setzt ihr Passwort selbst."
      busy={invite.busy}
      hint={inviteBlocked}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={invite.busy}>
            Abbrechen
          </Button>
          <Button
            variant="primary"
            busy={invite.busy}
            disabled={Boolean(inviteBlocked)}
            disabledReason={inviteBlocked}
            onClick={() => void submit()}
          >
            Einladen
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <Field label="Name" htmlFor="invite-name" error={invite.fields.name?.[0]}>
          <Input
            id="invite-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            invalid={Boolean(invite.fields.name)}
            autoFocus
          />
        </Field>

        <Field label="E-Mail" htmlFor="invite-email" error={invite.fields.email?.[0]}>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            invalid={Boolean(invite.fields.email)}
          />
        </Field>

        <RolePicker roles={roles} selected={roleIds} onChange={setRoleIds} />

        {invite.error ? (
          <p role="alert" className="text-[13px] font-medium text-brand-bronze">
            {invite.error}
          </p>
        ) : null}
      </div>
      {reauth.dialog}
    </Modal>
  );
}

function EditUserDialog({
  user,
  onClose,
  roles,
  onDone,
}: {
  user: UserRow | null;
  onClose: () => void;
  roles: RoleRow[];
  onDone: () => void;
}) {
  // `reload` re-reads the session. Renamed at the destructure because the
  // sessions panel below signs the administrator out of their *own* account
  // when they end the session they are using, and `reload()` on its own reads
  // like reloading the dialog.
  const { can, user: me, reload: reloadSession } = useAuth();
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [status, setStatus] = useState<UserRow["status"]>("ACTIVE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reauth = useReauthRetry();

  useEffect(() => {
    if (user) {
      setRoleIds(user.roles.map((r) => r.role.id));
      setStatus(user.status);
      setError(null);
    }
  }, [user?.id]);

  if (!user) return null;

  /*
    An account holding a role the reader may not hand out holds more than the
    reader does, and the server refuses every administrative act on it —
    status, roles, reset link, sessions (`refuseAdminister`). Saying so here
    beats a form that fills in and then 403s. Derived from the server's own
    `grantable` flag, so the page carries no copy of the rule. One's own
    account is exempt, as it is on the server.
  */
  const grantable = new Map(roles.map((r) => [r.id, r.grantable !== false]));
  const above =
    user.id !== me?.id && user.roles.some((r) => grantable.get(r.role.id) === false);

  const rolesChanged =
    roleIds.slice().sort().join() !== user.roles.map((r) => r.role.id).sort().join();

  async function saveRoles(token?: string) {
    await api.setUserRoles(user!.id, roleIds, token);
    onDone();
    onClose();
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (status !== user!.status) await api.updateUser(user!.id, { status });
      if (rolesChanged) {
        try {
          await saveRoles();
        } catch (err) {
          if (reauth.intercept(err, saveRoles)) return;
          throw err;
        }
        return;
      }
      onDone();
      onClose();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={user.name}
      description={user.email}
      busy={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={above}
            disabledReason="Dieses Konto hat mehr Rechte als Sie — nur jemand mit mindestens diesen Rechten kann es ändern."
            onClick={() => void save()}
          >
            Speichern
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {above ? (
          <p className="rounded-md bg-surface-2 px-4 py-3 text-[13px] leading-relaxed text-muted">
            Dieses Konto hat Rechte, die Sie selbst nicht besitzen. Status und Rollen kann nur
            ändern, wer mindestens dieselben Rechte hat.
          </p>
        ) : null}

        {can("user.update") && !above ? (
          <Field
            label="Status"
            htmlFor="user-status"
            hint="Ein gesperrtes Konto verliert sofort alle offenen Sitzungen."
          >
            <Select
              id="user-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as UserRow["status"])}
              options={[
                { value: "ACTIVE", label: "Aktiv" },
                { value: "SUSPENDED", label: "Gesperrt" },
              ]}
            />
          </Field>
        ) : null}

        {can("user.assign") && !above ? (
          <RolePicker roles={roles} selected={roleIds} onChange={setRoleIds} />
        ) : null}

        <p className="text-[12px] leading-relaxed text-muted">
          Beim Ändern von Rollen werden die offenen Sitzungen dieser Person beendet, damit die
          neuen Rechte sofort und vollständig greifen.
        </p>

        {/*
          Zwei-Faktor-Authentisierung — the feature's administrative slice.

          Gated on `user.read` only for the *status*, which is already on the
          row this dialog was opened from; the reset button inside is gated
          on `user.resetMfa`, which is the key that actually withholds
          something. The panel is rendered for everybody who can open this
          dialog because "is this account protected" is part of reading a
          user record, and hiding it would leave an administrator unable to
          answer the question they came here to ask.
        */}
        <div className="border-t border-line pt-5">
          <Suspense fallback={<Skeleton className="h-16 rounded-lg" />}>
            <UserMfaRoute
              userId={user.id}
              userName={user.name}
              enabled={user.mfaEnabled}
              canReset={can("user.resetMfa") && !above}
              onReset={onDone}
            />
          </Suspense>
        </div>

        {/*
          Sitzungen — the feature's administrative slice, composed in here.

          `admin/pages` is the layer above both `features/` and `widgets/`, so
          it is the only place allowed to import a feature — the same rule
          that puts the project detail's embedded tabs in `ProjectPage.tsx`.

          Gated on `user.readSessions` rather than on `user.read`: seeing
          where a colleague is signed in means seeing their devices, their
          addresses and their hours, which is more than the user list shows.
          The server refuses it either way; this stops the screen asking a
          question it will be told off for.
        */}
        {can("user.readSessions") ? (
          <div className="border-t border-line pt-5">
            <Suspense fallback={<Skeleton className="h-32 rounded-lg" />}>
              <UserSessionsRoute
                userId={user.id}
                userName={user.name}
                canRevoke={can("user.revokeSessions") && !above}
                onSelfSignedOut={() => void authRepository.logout().then(reloadSession)}
              />
            </Suspense>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-[13px] font-medium text-brand-bronze">
            {error}
          </p>
        ) : null}
      </div>
      {reauth.dialog}
    </Modal>
  );
}

function RolePicker({
  roles,
  selected,
  onChange,
}: {
  roles: RoleRow[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  /*
    Only roles the reader may hand out — the server's `grantable`, computed by
    the rule it enforces. A role already held that the reader could not grant
    stays visible but locked, so the list does not misreport what the account
    has. Hiding is the courtesy; `PUT /users/:id/roles` refuses regardless.
  */
  const offered = roles.filter((r) => r.grantable !== false || selected.includes(r.id));
  return (
    <fieldset className="flex flex-col gap-2.5">
      <legend className="field-label">Rollen</legend>
      <div className="flex flex-col gap-2.5 rounded-md bg-surface-2/50 p-4 ring-1 ring-line">
        {offered.map((role) => (
          <Checkbox
            key={role.id}
            label={role.name}
            hint={role.description ?? undefined}
            checked={selected.includes(role.id)}
            disabled={role.grantable === false}
            onChange={(on) =>
              onChange(on ? [...selected, role.id] : selected.filter((id) => id !== role.id))
            }
          />
        ))}
      </div>
      {offered.length < roles.length ? (
        <p className="text-[12px] leading-relaxed text-muted">
          Rollen mit Rechten, die Sie selbst nicht besitzen, sind nicht aufgeführt.
        </p>
      ) : null}
    </fieldset>
  );
}

/* ================================================================== */
/* Roles                                                               */
/* ================================================================== */

/**
 * The role editor.
 *
 * Permissions are grouped by the category the server assigns them, which is
 * the only way a list of fifty checkboxes stays navigable. Super Admin is
 * shown but not editable: its authority comes from the role key, not from the
 * list, so a checkbox grid for it would be a control that does nothing.
 */
export function RolesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [editing, setEditing] = useState<RoleRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<RoleRow | null>(null);

  const roles = useAsync(() => api.roles(), []);
  const permissions = useAsync(() => api.permissions(), []);
  const remove = useMutation(api.deleteRole);

  return (
    <>
      <PageHeader
        eyebrow="Rollen"
        title="Rollen und Berechtigungen"
        description="Rechte werden einzeln vergeben, nicht pro Seite. Eine Berechtigung wie „Veröffentlichen“ gilt überall dort, wo die Aktion erreichbar ist."
        actions={
          can("role.create") ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              + Eigene Rolle
            </Button>
          ) : null
        }
      />

      {roles.error ? (
        <ErrorState
          title="Die Rollen konnten nicht geladen werden."
          message={roles.error}
          onRetry={roles.reload}
        />
      ) : roles.loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-lg" />
          ))}
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(roles.data ?? []).map((role) => (
            <li key={role.id}>
              <div className="flex h-full flex-col gap-3 rounded-lg bg-surface p-5 ring-1 ring-line">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-display text-[15px] font-semibold leading-tight text-ink">
                    {role.name}
                  </h3>
                  {role.isSystem ? <Badge tone="neutral">System</Badge> : <Badge tone="gold">Eigen</Badge>}
                </div>
                <p className="flex-1 text-[13px] leading-snug text-muted">{role.description}</p>
                <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
                  <span className="font-mono text-[11px] tnum text-muted">
                    {role.key === "super_admin" ? "alle" : role.permissions.length} Rechte ·{" "}
                    {role._count?.users ?? 0} Person(en)
                  </span>
                  <div className="flex gap-1">
                    {/*
                      A role holding more than the reader is above them — the
                      server's `refuseRoleEdit`, which is the same containment
                      `grantable` reports.
                    */}
                    {can("role.update") && role.key !== "super_admin" && role.grantable !== false ? (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(role)}>
                        Bearbeiten
                      </Button>
                    ) : null}
                    {can("role.delete") && !role.isSystem && role.grantable !== false ? (
                      <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(role)}>
                        Löschen
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <RoleDialog
        role={editing}
        creating={creating}
        onClose={() => {
          setEditing(null);
          setCreating(false);
        }}
        groups={permissions.data ?? []}
        onDone={() => {
          roles.reload();
          toast.success("Gespeichert");
        }}
      />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onClose={() => {
          setConfirmDelete(null);
          remove.reset();
        }}
        busy={remove.busy}
        destructive
        title="Rolle löschen?"
        confirmLabel="Löschen"
        message={
          <>
            <p>
              „{confirmDelete?.name}“ wird entfernt. Das geht nur, wenn ihr niemand mehr zugewiesen
              ist.
            </p>
            {/* It used to fail silently: the refusal ("noch 3 Personen
                zugewiesen") was captured and never rendered. */}
            {remove.error ? (
              <p role="alert" className="mt-3 font-medium text-brand-bronze">
                {remove.error}
              </p>
            ) : null}
          </>
        }
        onConfirm={async () => {
          if (!confirmDelete) return;
          const result = await remove.run(confirmDelete.id);
          if (result.ok) {
            toast.success("Gelöscht", confirmDelete.name);
            setConfirmDelete(null);
            roles.reload();
          }
        }}
      />
      {remove.error ? <ErrorState title="Löschen nicht möglich" message={remove.error} /> : null}
    </>
  );
}

function RoleDialog({
  role,
  creating,
  onClose,
  groups,
  onDone,
}: {
  role: RoleRow | null;
  creating: boolean;
  onClose: () => void;
  groups: { category: string; permissions: { id: string; key: string; description: string | null }[] }[];
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const reauth = useReauthRetry();
  const { can } = useAuth();

  useEffect(() => {
    if (role) {
      setName(role.name);
      setKey(role.key);
      setDescription(role.description ?? "");
      setSelected(role.permissions.map((p) => p.permission.id));
    } else if (creating) {
      setName("");
      setKey("");
      setDescription("");
      setSelected([]);
    }
    setError(null);
    setFields({});
  }, [role?.id, creating]);

  const open = Boolean(role) || creating;
  const create = { fields };

  const total = useMemo(() => groups.reduce((n, g) => n + g.permissions.length, 0), [groups]);

  if (!open) return null;

  async function persist(token?: string) {
    if (creating) {
      await api.createRole({ key, name, description, permissionIds: selected, reauthToken: token });
    } else {
      await api.updateRole(role!.id, {
        name,
        description,
        permissionIds: selected,
        reauthToken: token,
      });
    }
    onDone();
    onClose();
  }

  async function save() {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await persist();
    } catch (err) {
      if (reauth.intercept(err, persist)) return;
      setError(messageOf(err));
      if (err instanceof ApiError) setFields(err.fields ?? {});
    } finally {
      setBusy(false);
    }
  }

  const roleBlocked = !name ? "Name fehlt." : creating && !key ? "Kennung fehlt." : null;

  return (
    <Modal
      open
      onClose={onClose}
      title={creating ? "Eigene Rolle" : role!.name}
      description={`${selected.length} von ${total} Berechtigungen`}
      size="lg"
      busy={busy}
      hint={roleBlocked}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={Boolean(roleBlocked)}
            disabledReason={roleBlocked}
            onClick={() => void save()}
          >
            Speichern
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="role-name" error={create.fields.name?.[0]}>
            <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          {creating ? (
            <Field
              label="Schlüssel"
              htmlFor="role-key"
              hint="Kleinbuchstaben und _. Kann später nicht geändert werden."
              error={create.fields.key?.[0]}
            >
              <Input
                id="role-key"
                value={key}
                onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
                className="font-mono text-[13px]"
                invalid={Boolean(create.fields.key)}
              />
            </Field>
          ) : null}
        </div>

        <Field label="Beschreibung" htmlFor="role-description" optional>
          <Textarea
            id="role-description"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        <div className="flex flex-col gap-4">
          {groups.map((group) => {
            /*
              Only keys the reader holds are toggleable — a role cannot be
              given what its editor lacks (`refusePermissionGrant`). The rest
              stay visible, so the list still says what the role contains.
            */
            const ids = group.permissions.filter((p) => can(p.key)).map((p) => p.id);
            const all = ids.length > 0 && ids.every((id) => selected.includes(id));
            return (
              <fieldset key={group.category} className="rounded-md bg-surface-2/50 p-4 ring-1 ring-line">
                <legend className="field-label px-1">{group.category}</legend>
                <div className="mb-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() =>
                      setSelected(
                        all
                          ? selected.filter((id) => !ids.includes(id))
                          : [...new Set([...selected, ...ids])],
                      )
                    }
                    className="text-[12px] text-brand-blue hover:text-brand-bronze"
                  >
                    {all ? "Keine" : "Alle"}
                  </button>
                </div>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {group.permissions.map((p) => (
                    <Checkbox
                      key={p.id}
                      label={p.description ?? p.key}
                      hint={p.key}
                      checked={selected.includes(p.id)}
                      disabled={!can(p.key)}
                      onChange={(on) =>
                        setSelected(on ? [...selected, p.id] : selected.filter((id) => id !== p.id))
                      }
                    />
                  ))}
                </div>
              </fieldset>
            );
          })}
        </div>

        {error ? (
          <p role="alert" className="text-[13px] font-medium text-brand-bronze">
            {error}
          </p>
        ) : null}
      </div>
      {reauth.dialog}
    </Modal>
  );
}
