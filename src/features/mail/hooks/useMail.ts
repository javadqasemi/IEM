import { useCallback, useState } from "react";
import { invalidate, prime, useQuery } from "@/core/api";
import { mailRepository } from "../repository";
import type {
  MailStatus,
  MailTemplate,
  MailTemplatePreview,
  MailTestResult,
  MailVerifyResult,
} from "../types";

/**
 * The mail panel's data.
 *
 * ---
 *
 * ## Why the probes are not queries
 *
 * `verify` and `sendTest` are `useCallback`s that the screen calls, never
 * `useQuery`. A query runs when it mounts and re-runs when a cache entry goes
 * stale, and both of those would be wrong here in a way that leaves the
 * building: opening the settings page would open an SMTP connection, and a
 * stale cache entry would send somebody a test message. The same reasoning
 * `useTestMail` in `features/organisation` already records.
 *
 * ## Why the status *is* a query
 *
 * It reads rows. It costs one request and nothing outward-facing, and it has
 * to refresh after a probe — which is what the `prime` calls below do without
 * a second round trip, because the probe's own response already says what
 * changed.
 */

const STATUS_KEY = ["mail", "status"];
const TEMPLATES_KEY = ["mail", "templates"];

export function useMailStatus() {
  return useQuery<MailStatus>(STATUS_KEY, () => mailRepository.status());
}

export function useMailTemplates() {
  return useQuery<{ items: MailTemplate[] }>(TEMPLATES_KEY, () => mailRepository.templates());
}

/**
 * The two diagnostics, and the local state that belongs to the screen.
 *
 * Kept together because they share the "one at a time" rule: pressing both at
 * once would open two connections and produce two results racing for the same
 * line of the panel.
 */
export function useMailDiagnostics() {
  const [busy, setBusy] = useState<null | "verify" | "test">(null);
  const [verifyResult, setVerifyResult] = useState<MailVerifyResult | null>(null);
  const [testResult, setTestResult] = useState<MailTestResult | null>(null);

  const verify = useCallback(async () => {
    setBusy("verify");
    try {
      const result = await mailRepository.verify();
      setVerifyResult(result);
      /*
        Invalidate rather than prime, and this is the one place that is right.

        A probe changes `lastVerify` *and* `state` — and `state` is computed on
        the server from several inputs this response does not carry. Priming a
        guess would put a stale verdict on screen beside a fresh probe result,
        which is exactly the contradiction the panel exists to prevent.
      */
      invalidate(STATUS_KEY);
      return result;
    } finally {
      setBusy(null);
    }
  }, []);

  const sendTest = useCallback(async (to?: string) => {
    setBusy("test");
    try {
      const result = await mailRepository.sendTest(to);
      setTestResult(result);
      invalidate(STATUS_KEY);
      return result;
    } finally {
      setBusy(null);
    }
  }, []);

  return { busy, verifyResult, testResult, verify, sendTest };
}

/**
 * One template's rendered preview, fetched on demand.
 *
 * Keyed by the template so switching between two and back reads from the
 * cache, and a **null key** keeps it off the wire until somebody opens one —
 * the catalogue has fourteen entries and pre-fetching all of them to fill a
 * dialog nobody may open is fourteen requests for nothing.
 *
 * `useQuery` takes `null` rather than an `enabled` flag, which is the better
 * shape for the reason it is built that way: a disabled query with a real key
 * still occupies a cache entry that a later `invalidate` would try to refetch.
 */
export function useMailTemplatePreview(key: string | null) {
  return useQuery<MailTemplatePreview>(
    key ? ["mail", "template", key] : null,
    () => mailRepository.preview(key!),
  );
}

/**
 * Clears a stored credential.
 *
 * The settings list comes back in the response, so it is **primed** rather
 * than invalidated — the trap recorded against `MfaCard` and the notification
 * centre, where an invalidate takes the invalidated key's data off screen and
 * a component rendering a skeleton on empty data unmounts, losing whatever it
 * held. Here that would be the confirmation dialog the operator is standing in.
 */
export function useRemoveSecret() {
  return useCallback(async (key: string) => {
    const settings = await mailRepository.removeSecret(key);
    prime(["settings"], settings);
    invalidate(STATUS_KEY);
    return settings;
  }, []);
}
