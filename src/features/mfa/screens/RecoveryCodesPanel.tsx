import { useEffect, useRef, useState } from "react";
import { Button } from "@/shared/ui/primitives";
import { Checkbox } from "@/shared/ui/forms";
import { recoveryCodesAsText } from "../mapper";
import type { RecoveryCodes } from "../types";

/**
 * Ten one-time codes, shown once and never again.
 *
 * ---
 *
 * **"Never again" is the whole design constraint.** The server stores hashes,
 * so there is no route that could return these later even if somebody built
 * one. Everything on this panel follows from that: the codes are large enough
 * to read off the screen and photograph, there are two ways to keep them that
 * do not involve retyping, and the way forward is blocked behind an explicit
 * statement that they have been kept.
 *
 * **The checkbox is not ceremony.** Without it the commonest outcome is that
 * somebody clicks past this screen, loses their phone four months later, and
 * discovers that the recovery path they were given exists only in a dialog
 * they dismissed. A confirmation that costs one click is the cheapest thing
 * on this page and the only one that changes that outcome.
 *
 * **Copy and download, not just copy.** The clipboard is where these go to be
 * pasted into the password manager the codes are supposed to be *outside* of,
 * so the file is offered first — and the text it produces names the account
 * and the date, because the failure it prevents is finding `codes.txt` in two
 * years with no idea what it opens.
 */
export function RecoveryCodesPanel({
  codes,
  account,
  onAcknowledged,
  acknowledgeLabel = "Weiter",
  heading = "Ihre Wiederherstellungscodes",
}: {
  codes: RecoveryCodes;
  /** Written into the downloaded file so it identifies itself later. */
  account: string;
  onAcknowledged: () => void;
  acknowledgeLabel?: string;
  heading?: string;
}) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The "Kopiert" state is a two-second acknowledgement, not a mode. Clearing
  // the timer on unmount keeps it from calling `setState` on a closed dialog.
  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  const text = recoveryCodesAsText(codes.codes, account, codes.generatedAt);

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.codes.join("\n"));
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      /*
        The clipboard API is refused in an insecure context and by some
        policies, and there is nothing useful to say about it — the codes are
        on screen and the download button is beside this one. Failing
        silently is right here; an error about a convenience would read as
        though the codes themselves had gone wrong.
      */
    }
  }

  function downloadFile() {
    // A local blob rather than `core/api`'s `download`, which fetches from
    // the server. These bytes exist only in this tab and must not be sent
    // anywhere to come back.
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "iem-wiederherstellungscodes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h3 className="font-display text-[15px] font-semibold text-ink">{heading}</h3>
        <p className="text-[14px] leading-relaxed text-muted">
          Damit kommen Sie in Ihr Konto, wenn Ihr Telefon verloren, kaputt oder
          zurückgesetzt ist. Jeder Code funktioniert genau einmal.{" "}
          <strong className="font-medium text-ink">
            Sie werden diese Liste nie wieder sehen.
          </strong>
        </p>
      </div>

      {/*
        `tnum` and a monospace face, because these are read character by
        character off a screen and `1`/`l` and `0`/`O` must not be a guess.
        The alphabet already excludes the four worst glyphs — see
        `mfa.rules.ts` — and this is the other half of the same decision.
      */}
      <ul
        aria-label="Wiederherstellungscodes"
        className="grid grid-cols-1 gap-x-6 gap-y-1.5 rounded-md bg-surface-2 p-4 font-mono text-[14px] tnum text-ink ring-1 ring-line sm:grid-cols-2"
      >
        {codes.codes.map((code) => (
          <li key={code} className="select-all tracking-wider">
            {code}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={downloadFile}>
          Als Datei speichern
        </Button>
        <Button variant="ghost" onClick={() => void copy()}>
          {copied ? "Kopiert" : "In die Zwischenablage"}
        </Button>
      </div>

      {/*
        `role="status"` rather than `alert`: it is worth announcing when the
        copy succeeds, and it is not an error. Rendered outside the button so
        the announcement is not the button's own label changing, which some
        readers do not report at all.
      */}
      <span role="status" className="sr-only">
        {copied ? "Die Codes wurden in die Zwischenablage kopiert." : ""}
      </span>

      <div className="flex flex-col gap-4 border-t border-line pt-5">
        <Checkbox
          label="Ich habe meine Wiederherstellungscodes sicher abgelegt."
          hint="Am besten ausgedruckt oder an einem Ort, der nicht dasselbe Gerät ist wie Ihre Authenticator-App."
          checked={saved}
          onChange={setSaved}
        />
        <div>
          <Button variant="primary" disabled={!saved} onClick={onAcknowledged}>
            {acknowledgeLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
