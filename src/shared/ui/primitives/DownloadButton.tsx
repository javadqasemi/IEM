import { useState } from "react";
import { useToast } from "@/shared/ui/feedback/toast";
import { Button } from "./Button";

/**
 * Starts an authenticated download and reports a failure.
 *
 * Both download routes in the dashboard used to be `<a href>` links that sent no
 * credential and answered 401 — silently, because a browser shows a failed
 * navigation, not an error the application can catch. That is the second reason
 * this is a button: the first is that the request needs an `Authorization`
 * header, and the second is that a failure now has somewhere to go.
 *
 * It has no domain knowledge — the caller hands it the promise — which is why
 * the dossier list and the audit export can share it.
 *
 * Imports `useToast` from its module rather than from `../feedback`, because
 * that barrel also exports `ErrorBoundary`, which imports this family. Reaching
 * past the barrel keeps the two from forming a cycle.
 */
export function DownloadButton({
  label,
  onDownload,
  variant = "link",
}: {
  label: string;
  onDownload: () => Promise<void>;
  variant?: "link" | "secondary";
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      await onDownload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Der Download ist fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  if (variant === "secondary") {
    return (
      <Button variant="secondary" busy={busy} onClick={() => void run()}>
        {label}
      </Button>
    );
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void run()}
      className="shrink-0 text-[13px] text-brand-blue transition-colors hover:text-brand-bronze disabled:opacity-50"
    >
      {busy ? "Wird geladen …" : label}
    </button>
  );
}
