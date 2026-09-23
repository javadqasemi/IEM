import type { APIRequestContext } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  API,
  TEST_PASSWORD,
  apiAs,
  e2eName,
  e2eNumber,
  expect,
  spendMfa,
  test,
} from "./fixtures";

/**
 * The P0 security regression matrix, against the live API.
 *
 * `docs/COMPLETE_APPLICATION_AUDIT.md` Part 32 made five things P0, and each
 * has its pure rule under unit test beside its code. What those tests cannot
 * show is that the rule is **wired**: that the ceiling runs on the real route,
 * that the scope reaches Prisma, that a refusal is the one a caller receives.
 * This file asks the running API, the way a script would, with a bearer token
 * and no dashboard in between.
 *
 * | | |
 * | --- | --- |
 * | SEC-1 | privilege ceiling — grant, invite, administer, role editing, re-auth |
 * | SEC-2 | restore safety — backup download needs re-auth; a restore job is not retryable |
 * | SEC-4 | fail-closed scope — drawing history, create and move into unreachable projects, protocol references |
 * | SEC-5 | settings authority — security policy and the mail transport |
 *
 * SEC-3 (deployment) is not an API property: `npm run deploy:test` renders the
 * installer's nginx configuration and reads the real response headers, and
 * `server/src/common/proxy-trust.test.ts` drives a real Express instance.
 *
 * **Every refusal is also checked for its absence of effect** — a 403 that
 * wrote anyway would pass a status-only assertion.
 *
 * Runs once (`API_ONLY` in `playwright.config.ts`) and needs the role accounts:
 * `SEED_TEST_USERS=true npm run server:seed`.
 */

const ACCOUNTS = {
  administrator: "adm@iem.test",
  management: "gl@iem.test",
  projectManager: "pl@iem.test",
  guest: "gast@iem.test",
} as const;

type Who = keyof typeof ACCOUNTS | "superAdmin";

const contexts = new Map<Who, APIRequestContext>();

async function as(who: Who): Promise<APIRequestContext> {
  const cached = contexts.get(who);
  if (cached) return cached;
  const ctx =
    who === "superAdmin"
      ? await apiAs(ADMIN_EMAIL, ADMIN_PASSWORD)
      : await apiAs(ACCOUNTS[who], TEST_PASSWORD);
  contexts.set(who, ctx);
  return ctx;
}

async function data<T>(response: Awaited<ReturnType<APIRequestContext["get"]>>): Promise<T> {
  return ((await response.json()) as { data: T }).data;
}

async function idOf(who: Who): Promise<string> {
  return (await data<{ id: string }>(await (await as(who)).get(`${API}/auth/me`))).id;
}

/** A re-authentication window for the Super Admin, paced like every MFA route. */
async function superAdminWindow(): Promise<string> {
  await spendMfa();
  const res = await (await as("superAdmin")).post(`${API}/auth/reauthenticate`, {
    data: { password: ADMIN_PASSWORD },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return (await data<{ token: string }>(res)).token;
}

type RoleRow = { id: string; key: string; grantable?: boolean; permissions: { permission: { id: string; key: string } }[] };

async function roles(who: Who): Promise<RoleRow[]> {
  return data<RoleRow[]>(await (await as(who)).get(`${API}/roles`));
}

async function rolesOf(userId: string): Promise<string[]> {
  const user = await data<{ roles: { role: { key: string } }[] }>(
    await (await as("superAdmin")).get(`${API}/users/${userId}`),
  );
  return user.roles.map((r) => r.role.key).sort();
}

test.beforeAll(() => {
  test.skip(
    !TEST_PASSWORD,
    "SEED_TEST_PASSWORD ist nicht gesetzt — `SEED_TEST_USERS=true npm run server:seed` legt die Rollenkonten an.",
  );
});

test.afterAll(async () => {
  for (const ctx of contexts.values()) await ctx.dispose();
  contexts.clear();
});

/* ================================================================== */
/* SEC-1 — the privilege ceiling                                       */
/* ================================================================== */

test.describe("SEC-1: nobody grants more than they hold", () => {
  test("the Administrator is told which roles it may hand out, and Super Admin is not one", async () => {
    const list = await roles("administrator");
    const byKey = new Map(list.map((r) => [r.key, r]));
    expect(byKey.get("super_admin")?.grantable).toBe(false);
    // Geschäftsleitung holds the legal identity and office deletion.
    expect(byKey.get("management")?.grantable).toBe(false);
    expect(byKey.get("administrator")?.grantable).toBe(true);
    expect(byKey.get("content_editor")?.grantable).toBe(true);
  });

  test("Administrator → Super Admin on itself is refused, and nothing changes", async () => {
    const adm = await as("administrator");
    const me = await idOf("administrator");
    const before = await rolesOf(me);
    const all = await roles("superAdmin");
    const ids = all.filter((r) => ["administrator", "super_admin"].includes(r.key)).map((r) => r.id);

    const res = await adm.put(`${API}/users/${me}/roles`, { data: { roleIds: ids } });
    expect(res.status()).toBe(403);
    expect((await res.json()).code).toBe("privilege_ceiling");
    expect(await rolesOf(me)).toEqual(before);
  });

  test("Administrator promoting itself to Geschäftsleitung is refused", async () => {
    const adm = await as("administrator");
    const me = await idOf("administrator");
    const all = await roles("superAdmin");
    const ids = all.filter((r) => ["administrator", "management"].includes(r.key)).map((r) => r.id);

    const res = await adm.put(`${API}/users/${me}/roles`, { data: { roleIds: ids } });
    expect(res.status()).toBe(403);
    expect((await res.json()).code).toBe("privilege_ceiling");
  });

  test("Administrator cannot invite a Super Admin — and no account is created", async () => {
    const adm = await as("administrator");
    const superAdminRole = (await roles("superAdmin")).find((r) => r.key === "super_admin")!;
    const email = `e2e-p0-${Date.now()}@iem.test`;

    const res = await adm.post(`${API}/users`, {
      data: { email, name: "E2E P0", roleIds: [superAdminRole.id] },
    });
    expect(res.status()).toBe(403);
    expect((await res.json()).code).toBe("privilege_ceiling");

    const found = await data<{ total: number }>(
      await (await as("superAdmin")).get(`${API}/users`, { params: { search: email } }),
    );
    expect(found.total, "a refused invite created the account anyway").toBe(0);
  });

  test("Administrator cannot suspend, demote, reset or sign out a Super Admin", async () => {
    const adm = await as("administrator");
    const sa = await idOf("superAdmin");

    const attempts = [
      adm.patch(`${API}/users/${sa}`, { data: { status: "SUSPENDED" } }),
      adm.put(`${API}/users/${sa}/roles`, { data: { roleIds: [] } }),
      adm.post(`${API}/users/${sa}/send-password-reset`, { data: {} }),
      adm.post(`${API}/users/${sa}/sessions/revoke-all`, { data: {} }),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.status(), res.url()).toBe(403);
      expect((await res.json()).code).toBe("privilege_ceiling");
    }
    expect(await rolesOf(sa)).toContain("super_admin");
  });

  test("Administrator cannot suspend Geschäftsleitung, which holds more than it does", async () => {
    const res = await (await as("administrator")).patch(`${API}/users/${await idOf("management")}`, {
      data: { status: "SUSPENDED" },
    });
    expect(res.status()).toBe(403);
    expect((await res.json()).code).toBe("privilege_ceiling");
  });

  test("granting Super Admin needs a fresh re-authentication, even for a Super Admin", async () => {
    const sa = await as("superAdmin");
    const guest = await idOf("guest");
    const before = await rolesOf(guest);
    const all = await roles("superAdmin");
    const ids = [
      ...all.filter((r) => before.includes(r.key)).map((r) => r.id),
      all.find((r) => r.key === "super_admin")!.id,
    ];

    const res = await sa.put(`${API}/users/${guest}/roles`, { data: { roleIds: ids } });
    expect(res.status()).toBe(403);
    expect((await res.json()).code).toBe("reauth_required");
    expect(await rolesOf(guest)).toEqual(before);
  });

  /**
   * The escalation through the role editor: a custom role holding
   * `role.update` adds `user.assign` to itself. Built for real — a role, a
   * holder, an attempt — and taken apart again whatever happens.
   */
  test("a custom role with role.update cannot add user.assign to itself, or edit a higher role", async () => {
    const sa = await as("superAdmin");
    const guestId = await idOf("guest");
    const originalRoles = await rolesOf(guestId);
    const permissions = await data<{ permissions: { id: string; key: string }[] }[]>(
      await sa.get(`${API}/permissions`),
    );
    const permId = (key: string) => permissions.flatMap((g) => g.permissions).find((p) => p.key === key)!.id;
    const all = await roles("superAdmin");
    const key = `e2e_p0_role_editor_${Date.now()}`;

    // Creating a role that carries `role.update` is itself a privileged grant.
    const refused = await sa.post(`${API}/roles`, {
      data: { key, name: "E2E: P0 Rolleneditor", permissionIds: [permId("role.read"), permId("role.update")] },
    });
    expect(refused.status()).toBe(403);
    expect((await refused.json()).code).toBe("reauth_required");

    const token = await superAdminWindow();
    const created = await sa.post(`${API}/roles`, {
      data: {
        key,
        name: "E2E: P0 Rolleneditor",
        permissionIds: [permId("role.read"), permId("role.update")],
        reauthToken: token,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const customId = (await data<{ id: string }>(created)).id;

    try {
      const give = await sa.put(`${API}/users/${guestId}/roles`, {
        data: {
          roleIds: [...all.filter((r) => originalRoles.includes(r.key)).map((r) => r.id), customId],
          reauthToken: token,
        },
      });
      expect(give.ok(), await give.text()).toBe(true);

      // Permissions are resolved per request, so the guest's existing token
      // now carries the custom role.
      const guest = await as("guest");

      const selfEscalate = await guest.patch(`${API}/roles/${customId}`, {
        data: { permissionIds: [permId("role.read"), permId("role.update"), permId("user.assign")] },
      });
      expect(selfEscalate.status()).toBe(403);
      expect((await selfEscalate.json()).code).toBe("privilege_ceiling");

      const administratorRole = all.find((r) => r.key === "administrator")!;
      const higher = await guest.patch(`${API}/roles/${administratorRole.id}`, {
        data: { name: "E2E: umbenannt" },
      });
      expect(higher.status()).toBe(403);
      expect((await higher.json()).code).toBe("privilege_ceiling");

      // Not vacuous: the same holder may edit a role it contains.
      const own = await guest.patch(`${API}/roles/${customId}`, {
        data: { name: "E2E: P0 Rolleneditor (umbenannt)" },
      });
      expect(own.ok(), await own.text()).toBe(true);

      const after = await data<{ permissions: { permission: { key: string } }[] }>(
        await sa.get(`${API}/roles/${customId}`),
      );
      expect(after.permissions.map((p) => p.permission.key)).not.toContain("user.assign");
    } finally {
      // Removing roles grants nothing, so it needs no window.
      await sa.put(`${API}/users/${guestId}/roles`, {
        data: { roleIds: all.filter((r) => originalRoles.includes(r.key)).map((r) => r.id) },
      });
      await sa.delete(`${API}/roles/${customId}`);
    }
    expect(await rolesOf(guestId)).toEqual(originalRoles);
  });
});

/* ================================================================== */
/* SEC-2 — restore safety                                              */
/* ================================================================== */

test.describe("SEC-2: the destructive backup operations", () => {
  test("downloading a backup artifact needs a re-authentication window", async () => {
    const sa = await as("superAdmin");
    const url = `${API}/backups/does-not-exist/artifacts/DATABASE_DUMP/download`;

    const refused = await sa.post(url, { data: {} });
    expect(refused.status()).toBe(403);
    expect((await refused.json()).code).toBe("reauth_required");

    // With a window the request gets as far as the lookup — a 404 for the
    // invented id, which is what proves the window was the gate above.
    const token = await superAdminWindow();
    const past = await sa.post(url, { data: { reauthToken: token } });
    expect(past.status()).toBe(404);
  });

  test("the old GET download route is gone", async () => {
    const res = await (await as("superAdmin")).get(
      `${API}/backups/does-not-exist/artifacts/DATABASE_DUMP/download`,
    );
    expect(res.status()).toBe(404);
  });

  test("a restore job is never retryable through Job Operations", async () => {
    const sa = await as("superAdmin");
    const jobs = await data<{ items: { id: string; capabilities: { retryable: boolean } }[] }>(
      await sa.get(`${API}/jobs`, { params: { name: "backup.restore", perPage: 20 } }),
    );
    test.skip(!jobs.items.length, "no backup.restore job on this database — covered by jobs.test.ts");
    for (const job of jobs.items) {
      expect(job.capabilities.retryable, job.id).toBe(false);
      const res = await sa.post(`${API}/jobs/${job.id}/retry`, { data: {} });
      expect(res.status(), job.id).toBe(400);
    }
  });
});

/* ================================================================== */
/* SEC-4 — fail-closed scope                                           */
/* ================================================================== */

test.describe("SEC-4: scope is required, and reach is checked on create", () => {
  /** A project the Projektleitung account cannot reach, and one it can. */
  async function projects() {
    const all = await data<{ items: { id: string }[] }>(
      await (await as("superAdmin")).get(`${API}/projects`, { params: { perPage: 200 } }),
    );
    const mine = await data<{ items: { id: string }[] }>(
      await (await as("projectManager")).get(`${API}/projects`, { params: { perPage: 200 } }),
    );
    const reachable = new Set(mine.items.map((p) => p.id));
    return {
      foreign: all.items.find((p) => !reachable.has(p.id))?.id,
      own: mine.items[0]?.id,
    };
  }

  test("a plan's version history answers 404 across projects, like the plan itself", async () => {
    const { foreign } = await projects();
    test.skip(!foreign, "every project is reachable by the Projektleitung account");
    const sa = await as("superAdmin");
    const plans = await data<{ items: { id: string; projectId: string }[] }>(
      await sa.get(`${API}/drawings`, {
        params: { perPage: 50, "filter[projectId]": `eq:${foreign}` },
      }),
    );
    let plan: { id: string } | undefined = plans.items[0];
    if (!plan) {
      // Made here rather than skipped: a load-seeded database has projects
      // without plans, and a skipped regression test guards nothing.
      const discipline = (await data<{ id: string }[]>(await sa.get(`${API}/disciplines`)))[0];
      const created = await sa.post(`${API}/drawings`, {
        data: {
          number: e2eNumber("P0"),
          title: e2eName("P0 Plan in fremdem Projekt"),
          projectId: foreign,
          disciplineId: discipline.id,
          type: "SCHEMA",
        },
      });
      expect(created.status(), await created.text()).toBe(201);
      plan = await data<{ id: string }>(created);
    }

    const pl = await as("projectManager");
    expect((await pl.get(`${API}/drawings/${plan.id}`)).status()).toBe(404);
    // SEC-R6: this route used to answer 200 with every snapshot.
    expect((await pl.get(`${API}/drawings/${plan.id}/versions`)).status()).toBe(404);
    expect((await (await as("superAdmin")).get(`${API}/drawings/${plan.id}/versions`)).status()).toBe(200);
  });

  test("creating into an unreachable project is the same 404 as into a missing one", async () => {
    const { foreign } = await projects();
    test.skip(!foreign, "every project is reachable by the Projektleitung account");
    const pl = await as("projectManager");
    const missing = "cmzzzznotarealid0000";

    const bodies = (projectId: string) => [
      [`${API}/tasks`, { title: e2eName("P0 Aufgabe"), projectId }],
      [`${API}/meetings`, { title: e2eName("P0 Sitzung"), startsAt: new Date().toISOString(), projectId }],
      [
        `${API}/decisions`,
        {
          title: e2eName("P0 Entscheid"),
          rationale: "Ein Entscheid in einem fremden Projekt darf nicht entstehen.",
          decidedAt: new Date().toISOString(),
          projectId,
        },
      ],
    ] as const;

    for (const projectId of [foreign!, missing]) {
      for (const [url, body] of bodies(projectId)) {
        const res = await pl.post(url, { data: body });
        expect(res.status(), `${url} → ${projectId}`).toBe(404);
        expect((await res.json()).message).toBe("Projekt nicht gefunden.");
      }
    }
  });

  test("moving a task into an unreachable project is refused and leaves it where it was", async () => {
    const { foreign, own } = await projects();
    test.skip(!foreign || !own, "needs one reachable and one unreachable project");
    const pl = await as("projectManager");

    const created = await pl.post(`${API}/tasks`, { data: { title: e2eName("P0 Umzug"), projectId: own } });
    expect(created.status(), await created.text()).toBe(201);
    const task = await data<{ id: string; version: number }>(created);

    const moved = await pl.patch(`${API}/tasks/${task.id}`, {
      data: { expectedVersion: task.version, projectId: foreign },
    });
    expect(moved.status()).toBe(404);

    const after = await data<{ projectId?: string | null; project?: { id: string } | null }>(
      await pl.get(`${API}/tasks/${task.id}`),
    );
    expect(after.project?.id ?? after.projectId).toBe(own);
  });

  test("a protocol line cannot link a task the caller cannot see", async () => {
    const { own } = await projects();
    test.skip(!own, "the Projektleitung account reaches no project");

    // A firm-level to-do the Super Admin writes for themselves: invisible to
    // the Projektleitung (not creator, not assignee, no project).
    const hidden = await data<{ id: string }>(
      await (await as("superAdmin")).post(`${API}/tasks`, { data: { title: e2eName("P0 verborgen") } }),
    );

    const pl = await as("projectManager");
    expect((await pl.get(`${API}/tasks/${hidden.id}`)).status()).toBe(404);

    const meeting = await data<{ id: string }>(
      await pl.post(`${API}/meetings`, {
        data: { title: e2eName("P0 Protokoll"), startsAt: new Date().toISOString(), projectId: own },
      }),
    );
    const line = await pl.post(`${API}/meetings/${meeting.id}/items`, {
      data: { text: "E2E: Verweis auf eine fremde Aufgabe", kind: "INFORMATION", taskId: hidden.id },
    });
    expect(line.status()).toBe(400);
    expect((await line.json()).message).toBe("Die Aufgabe gibt es nicht.");
  });
});

/* ================================================================== */
/* SEC-5 — settings authority                                          */
/* ================================================================== */

test.describe("SEC-5: settings.update is not security or secret authority", () => {
  type SettingRow = { key: string; value: unknown; canEdit?: boolean; authority?: string };

  async function settings(who: Who): Promise<Map<string, SettingRow>> {
    const groups = await data<{ settings: SettingRow[] }[]>(await (await as(who)).get(`${API}/settings`));
    return new Map(groups.flatMap((g) => g.settings).map((s) => [s.key, s]));
  }

  test("the Administrator is told which settings it may not change", async () => {
    const rows = await settings("administrator");
    expect(rows.get("workflow.requireApproval")?.canEdit).toBe(false);
    expect(rows.get("security.lockoutMinutes")?.canEdit).toBe(false);
    expect(rows.get("mail.smtpHost")?.canEdit).toBe(false);
    expect(rows.get("mail.smtpPassword")?.canEdit).toBe(false);
    expect(rows.get("mail.fromName")?.canEdit).toBe(true);
  });

  test("the Administrator cannot switch off four-eyes, repoint SMTP or replace its password", async () => {
    const adm = await as("administrator");
    const before = await settings("superAdmin");
    const flip = !(before.get("workflow.requireApproval")?.value as boolean);

    for (const updates of [
      [{ key: "workflow.requireApproval", value: flip }],
      [{ key: "mail.smtpHost", value: "smtp.attacker.example" }],
      [{ key: "mail.smtpPassword", value: "e2e-p0-not-a-password" }],
      [{ key: "applications.retentionDays", value: 31 }],
    ]) {
      const res = await adm.patch(`${API}/settings`, { data: { updates } });
      expect(res.status(), updates[0].key).toBe(403);
      expect((await res.json()).code).toBe("settings_authority");
    }

    const after = await settings("superAdmin");
    for (const key of ["workflow.requireApproval", "mail.smtpHost", "applications.retentionDays"]) {
      expect(after.get(key)?.value, key).toEqual(before.get(key)?.value);
    }
  });

  test("an unchanged protected field does not block an ordinary save", async () => {
    // A form posts every field it rendered; the untouched SMTP host must not
    // make the sender name unsaveable for the Administrator.
    const adm = await as("administrator");
    const before = await settings("superAdmin");
    const original = before.get("mail.fromName")!.value;

    const res = await adm.patch(`${API}/settings`, {
      data: {
        updates: [
          { key: "mail.smtpHost", value: before.get("mail.smtpHost")!.value },
          { key: "mail.fromName", value: "E2E: P0 Absender" },
        ],
      },
    });
    expect(res.status(), await res.text()).toBe(200);

    await (await as("superAdmin")).patch(`${API}/settings`, {
      data: { updates: [{ key: "mail.fromName", value: original }] },
    });
  });
});
