import { Suspense, useEffect, useMemo, useState } from "react";
import { formatDateTime, relativeTime } from "@/shared/utils/format";
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Skeleton } from "@/shared/ui/primitives";
import { Checkbox, Field, Input, SearchInput, Select, Textarea } from "@/shared/ui/forms";
import { ConfirmDialog, Modal } from "@/shared/ui/overlays";
import { type Column, DataView } from "@/shared/ui/data";
import { useToast } from "@/shared/ui/feedback";
import { UserSessionsRoute } from "@/features/sessions";
import { api, type RoleRow, type UserRow } from "../lib/api";
import { authRepository, useAuth } from "@/core/auth";
import { useDebounced, useMutation } from "@/shared/hooks";
import { useAsync } from "../lib/useAsync";

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
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {can("user.update") ? (
            <Button
              size="sm"
              variant="ghost"
              busy={sendReset.busy}
              onClick={async () => {
                await sendReset.run(r.id);
                toast.success("Link verschickt", `${r.email} kann ein neues Passwort setzen.`);
              }}
            >
              Passwortlink
            </Button>
          ) : null}
          {can("user.delete") && r.id !== me?.id ? (
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(r)}>
              Löschen
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  if (list.error) return <ErrorState message={list.error} onRetry={list.reload} />;

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
          onRowClick={can("user.assign") ? (r) => setEditing(r) : undefined}
          loading={list.loading}
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
        onClose={() => setConfirmDelete(null)}
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
          </>
        }
        onConfirm={async () => {
          if (!confirmDelete) return;
          await remove.run(confirmDelete.id);
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
  const invite = useMutation(api.inviteUser);

  useEffect(() => {
    if (open) {
      setEmail("");
      setName("");
      setRoleIds([]);
      invite.reset();
    }
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Benutzer einladen"
      description="Die Person erhält einen Link und setzt ihr Passwort selbst."
      busy={invite.busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={invite.busy}>
            Abbrechen
          </Button>
          <Button
            variant="primary"
            busy={invite.busy}
            disabled={!email || !name || !roleIds.length}
            onClick={async () => {
              const created = await invite.run(email, name, roleIds);
              if (created) {
                onDone();
                onClose();
              }
            }}
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
  const { can, reload: reloadSession } = useAuth();
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [status, setStatus] = useState<UserRow["status"]>("ACTIVE");
  const setRolesM = useMutation(api.setUserRoles);
  const updateM = useMutation(api.updateUser);

  useEffect(() => {
    if (user) {
      setRoleIds(user.roles.map((r) => r.role.id));
      setStatus(user.status);
    }
  }, [user?.id]);

  if (!user) return null;
  const busy = setRolesM.busy || updateM.busy;
  const error = setRolesM.error ?? updateM.error;

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
            onClick={async () => {
              if (status !== user.status) {
                const ok = await updateM.run(user.id, { status });
                if (!ok) return;
              }
              const changed =
                roleIds.slice().sort().join() !==
                user.roles.map((r) => r.role.id).sort().join();
              if (changed) {
                const ok = await setRolesM.run(user.id, roleIds);
                if (!ok) return;
              }
              onDone();
              onClose();
            }}
          >
            Speichern
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {can("user.update") ? (
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

        {can("user.assign") ? (
          <RolePicker roles={roles} selected={roleIds} onChange={setRoleIds} />
        ) : null}

        <p className="text-[12px] leading-relaxed text-muted">
          Beim Ändern von Rollen werden die offenen Sitzungen dieser Person beendet, damit die
          neuen Rechte sofort und vollständig greifen.
        </p>

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
                canRevoke={can("user.revokeSessions")}
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
  return (
    <fieldset className="flex flex-col gap-2.5">
      <legend className="field-label">Rollen</legend>
      <div className="flex flex-col gap-2.5 rounded-md bg-surface-2/50 p-4 ring-1 ring-line">
        {roles.map((role) => (
          <Checkbox
            key={role.id}
            label={role.name}
            hint={role.description ?? undefined}
            checked={selected.includes(role.id)}
            onChange={(on) =>
              onChange(on ? [...selected, role.id] : selected.filter((id) => id !== role.id))
            }
          />
        ))}
      </div>
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

  if (roles.error) return <ErrorState message={roles.error} onRetry={roles.reload} />;

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

      {roles.loading ? (
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
                    {can("role.update") && role.key !== "super_admin" ? (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(role)}>
                        Bearbeiten
                      </Button>
                    ) : null}
                    {can("role.delete") && !role.isSystem ? (
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
        onClose={() => setConfirmDelete(null)}
        busy={remove.busy}
        destructive
        title="Rolle löschen?"
        confirmLabel="Löschen"
        message={`„${confirmDelete?.name}“ wird entfernt. Das geht nur, wenn ihr niemand mehr zugewiesen ist.`}
        onConfirm={async () => {
          if (!confirmDelete) return;
          const ok = await remove.run(confirmDelete.id);
          if (ok !== null) {
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

  const create = useMutation(api.createRole);
  const update = useMutation(api.updateRole);

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
  }, [role?.id, creating]);

  const open = Boolean(role) || creating;
  const busy = create.busy || update.busy;
  const error = create.error ?? update.error;

  const total = useMemo(() => groups.reduce((n, g) => n + g.permissions.length, 0), [groups]);

  if (!open) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={creating ? "Eigene Rolle" : role!.name}
      description={`${selected.length} von ${total} Berechtigungen`}
      size="lg"
      busy={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!name || (creating && !key)}
            onClick={async () => {
              const ok = creating
                ? await create.run({ key, name, description, permissionIds: selected })
                : await update.run(role!.id, { name, description, permissionIds: selected });
              if (ok) {
                onDone();
                onClose();
              }
            }}
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
            const ids = group.permissions.map((p) => p.id);
            const all = ids.every((id) => selected.includes(id));
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
    </Modal>
  );
}
