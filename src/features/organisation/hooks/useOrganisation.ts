import { useCallback } from "react";
import { invalidate, peek, prime, useQuery } from "@/core/api";
import type {
  Office,
  OfficeDraft,
  Organisation,
  SettingGroup,
  SystemInfo,
} from "@/entities/organisation";
import {
  toOffice,
  toOfficeCreateBody,
  toOfficeUpdateBody,
  toOffices,
  toOrganisation,
  toSettingGroups,
  toSystemInfo,
  toUpdateBody,
} from "../mapper";
import { organisationRepository } from "../repository";

/**
 * React only. Cache keys, loading state, invalidation.
 *
 * Every function is `repository → mapper → cache`, in that order: nothing
 * below this file knows about React, and nothing above it has seen a DTO.
 */

/**
 * **One cache prefix for the whole workspace**, and that is a decision rather
 * than a shortcut.
 *
 * The organisation, the offices and the settings are three resources that
 * render on one screen and change each other's output: saving the company name
 * changes the mail sender shown under E-Mail, and archiving an office changes
 * the publish warning the workspace header carries. Two prefixes would make
 * every mutation guess which to invalidate, and the guess would be wrong
 * exactly when something interesting had happened. Sitzungen und Entscheide
 * share one prefix for the same reason.
 */
const KEY = "organisation";

/** The one query the workspace's own screens keep a component mounted on. */
const RECORD_KEY = [KEY, "record"] as const;

type RecordEntry = {
  organisation: Organisation;
  canEditLegal: boolean;
  officeKinds: string[];
};

export function useOrganisation() {
  return useQuery<RecordEntry>([...RECORD_KEY], () =>
    organisationRepository.get().then((dto) => ({
      organisation: toOrganisation(dto.organisation),
      canEditLegal: dto.canEditLegal,
      officeKinds: dto.officeKinds,
    })),
  );
}

export function useSaveOrganisation() {
  return useCallback(
    async (
      before: Organisation,
      after: Organisation,
    ): Promise<{ organisation: Organisation; warnings: string[] }> => {
      const result = await organisationRepository.update(toUpdateBody(before, after));
      const organisation = toOrganisation(result.organisation);

      /*
        Invalidate the prefix, then **prime the record back**.

        The invalidate is real work: a changed company name is the mail
        sender shown under E-Mail, and a changed anything is a row in the
        System panel's audit count. What it must not do is take the record
        itself off screen — and it did.

        `invalidate` sets `updatedAt = 0`, and `useQuery` gates `data` on
        `updatedAt > 0`, so the record read `null` for the moment between the
        invalidate and the refetch landing. `SettingsWorkspace` renders a
        skeleton when there is no record, so **the open form unmounted on
        every save**: the "Gespeichert." confirmation vanished with the
        component that owned it, and any second edit started from a fresh
        mount. `useQuery`'s own comment promises the opposite — *"a refetch
        over data already on screen is not a loading state"* — and that
        promise holds for every key except the one being invalidated.

        Priming is the better answer regardless of the bug: the `PATCH`
        response **is** the new record, so refetching it is a round trip to be
        told what we were just told. Both calls happen in one tick, so React
        batches them and `data` is never observed null.
      */
      // Read **before** the invalidate: `peek` is gated on `updatedAt > 0`
      // too, so afterwards it would answer `undefined` and the two flags
      // would be lost.
      const current = peek<RecordEntry>([...RECORD_KEY]);
      invalidate([KEY]);
      prime([...RECORD_KEY], {
        organisation,
        // Neither can change as a result of a write, so the previous answer
        // stands; falling back keeps the shape valid if nothing was cached.
        canEditLegal: current?.canEditLegal ?? false,
        officeKinds: current?.officeKinds ?? [],
      } satisfies RecordEntry);

      return { organisation, warnings: result.warnings };
    },
    [],
  );
}

/* ================================================================== */
/* Offices                                                             */
/* ================================================================== */

export function useOffices(enabled = true) {
  return useQuery<Office[]>(enabled ? [KEY, "offices"] : null, () =>
    organisationRepository.offices().then(toOffices),
  );
}

/**
 * What an office write actually affects.
 *
 * **Not the whole prefix.** The organisation record does not change when an
 * office does, and invalidating it anyway would take it off screen for a tick
 * — `invalidate` zeroes `updatedAt` and `useQuery` gates `data` on it, which
 * is the mechanism written up on `useSaveOrganisation` above. Nothing
 * currently unmounts on that here, and narrowing it is how it stays that way.
 *
 * The System panel *is* included: it reports the count of active offices.
 */
function invalidateOffices(): void {
  invalidate([KEY, "offices"]);
  invalidate([KEY, "system"]);
}

export function useOfficeMutations() {
  const create = useCallback(async (draft: OfficeDraft): Promise<Office> => {
    const row = await organisationRepository.createOffice(toOfficeCreateBody(draft));
    invalidateOffices();
    return toOffice(row);
  }, []);

  const update = useCallback(
    async (id: string, draft: OfficeDraft, expectedVersion: number): Promise<Office> => {
      const row = await organisationRepository.updateOffice(
        id,
        toOfficeUpdateBody(draft, expectedVersion),
      );
      invalidateOffices();
      return toOffice(row);
    },
    [],
  );

  const setArchived = useCallback(async (id: string, archived: boolean): Promise<Office> => {
    const row = await organisationRepository.setArchived(id, archived);
    invalidateOffices();
    return toOffice(row);
  }, []);

  const remove = useCallback(async (id: string): Promise<void> => {
    await organisationRepository.deleteOffice(id);
    invalidateOffices();
  }, []);

  return { create, update, setArchived, remove };
}

/* ================================================================== */
/* Settings                                                            */
/* ================================================================== */

export function useSettings(enabled = true) {
  return useQuery<SettingGroup[]>(enabled ? [KEY, "settings"] : null, () =>
    organisationRepository.settings().then(toSettingGroups),
  );
}

export function useSaveSettings() {
  return useCallback(async (updates: { key: string; value: unknown }[]) => {
    const groups = await organisationRepository.updateSettings(updates);
    const mapped = toSettingGroups(groups);
    /*
      The `PATCH` answers with the whole list, so the cache takes it directly
      rather than being invalidated into a refetch — and the System panel, which
      counts audit rows, is told to go stale. Same reasoning as
      `useSaveOrganisation`: narrow, and prime what the server already sent.
    */
    prime([KEY, "settings"], mapped);
    invalidate([KEY, "system"]);
    return mapped;
  }, []);
}

/*
  `useTestMail` stood here and is **gone** (P2-4).

  It was this feature's own path to `POST /settings/mail/test`, from the days
  when the E-Mail section was a form with one probe button on it. Email
  Operations owns that now — `features/mail` has the two distinct diagnostics,
  the sanitized classification and the status they belong beside — and keeping
  this would have left two client paths to one endpoint, which is the "parallel
  mail service" the brief names, in miniature.

  The argument it carried is not lost: it is at the head of
  `features/mail/hooks/useMail.ts`, which records why a probe is a callback and
  never a `useQuery`.
*/

/* ================================================================== */
/* System                                                              */
/* ================================================================== */

/**
 * `null` disables the query.
 *
 * The system panel reads eight tables and times the database, so it is the one
 * call in this workspace worth *not* making until somebody opens that section
 * — which is what the `enabled` flag is for. It is also the reason the figure
 * is not on the workspace header: a latency measurement taken on every page
 * load measures the page load.
 */
export function useSystemInfo(enabled: boolean) {
  return useQuery<SystemInfo>(enabled ? [KEY, "system"] : null, () =>
    organisationRepository.system().then(toSystemInfo),
  );
}

