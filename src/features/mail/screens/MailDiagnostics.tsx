import { useId, useState } from "react";
import { Badge, Button, Card } from "@/shared/ui/primitives";
import { Field, Input } from "@/shared/ui/forms";
import { useToast } from "@/shared/ui/feedback";
import { useCan } from "@/core/auth";
import { useMailDiagnostics } from "../hooks/useMail";
import { describeTest, describeVerify, remedyFor } from "../service";

/**
 * The two diagnostics, deliberately separate.
 *
 * ---
 *
 * ## Why they are two buttons and not one
 *
 * They answer different questions and fail in different places:
 *
 * - **Verbindung testen** covers DNS, TCP, TLS and AUTH, and puts nothing in
 *   anybody's inbox. It is the one an operator presses repeatedly while
 *   editing the form, and it is the only check that works against a
 *   configuration whose sender address is not valid yet.
 * - **Testnachricht senden** additionally covers the sender identity, the
 *   recipient's acceptance and the template.
 *
 * Folding them into one button would mean either sending a message every time
 * somebody checks a password — which trains people to ignore the inbox — or
 * never proving that a message can actually leave the building.
 *
 * ## What the recipient field is, and what it is not
 *
 * An optional address, defaulting to the signed-in administrator. There is
 * **no subject and no body field**, here or on the server, and that absence is
 * what keeps this from being an authenticated relay: the most it can produce
 * is one fixed diagnostic note, three times a minute.
 */
export function MailDiagnostics() {
  const toast = useToast();
  const { busy, verifyResult, testResult, verify, sendTest } = useMailDiagnostics();
  const [to, setTo] = useState("");
  const recipientId = useId();

  // The server enforces it; this keeps the button from offering a 403.
  const mayTest = useCan("settings.update");

  const verdict = verifyResult ? describeVerify(verifyResult) : null;
  const sent = testResult ? describeTest(testResult) : null;
  const verifyRemedy =
    verifyResult?.status === "failed" ? remedyFor(verifyResult.failure.category) : null;
  const testRemedy = testResult?.ok === false ? remedyFor(testResult.category) : null;

  return (
    <Card
      title="Diagnose"
      description="Zwei getrennte Prüfungen: die Verbindung allein, oder eine echte Nachricht."
    >
      {!mayTest ? (
        <p className="text-[13px] text-muted">
          Zum Ausführen der Diagnose wird die Berechtigung „Einstellungen ändern“ benötigt.
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="flex flex-col gap-3">
            <div>
              <h4 className="text-[14px] font-medium text-ink">Verbindung testen</h4>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">
                Baut eine Verbindung auf, handelt TLS aus und meldet sich an — und sendet dabei{" "}
                <strong>keine</strong> Nachricht.
              </p>
            </div>
            <div>
              <Button
                variant="secondary"
                busy={busy === "verify"}
                disabled={busy !== null}
                onClick={() => {
                  void verify().then(
                    (r) => {
                      const d = describeVerify(r);
                      if (d.ok) toast.success("Verbindung steht", d.message);
                      else toast.error("Verbindungstest fehlgeschlagen", d.message);
                    },
                    (err: Error) => toast.error("Verbindungstest fehlgeschlagen", err.message),
                  );
                }}
              >
                Verbindung testen
              </Button>
            </div>
            {verdict ? (
              <Outcome ok={verdict.ok} message={verdict.message} remedy={verifyRemedy} />
            ) : null}
          </section>

          <section className="flex flex-col gap-3">
            <div>
              <h4 className="text-[14px] font-medium text-ink">Testnachricht senden</h4>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">
                Verschickt eine feste Diagnosenachricht. Betreff und Inhalt sind nicht änderbar.
              </p>
            </div>
            <Field
              label="Empfänger"
              htmlFor={recipientId}
              hint="Leer lassen für die eigene Adresse."
            >
              <Input
                id={recipientId}
                type="email"
                value={to}
                onChange={(e) => setTo(e.currentTarget.value)}
                placeholder="name@firma.ch"
                autoComplete="off"
              />
            </Field>
            <div>
              <Button
                variant="secondary"
                busy={busy === "test"}
                disabled={busy !== null}
                onClick={() => {
                  void sendTest(to.trim() || undefined).then(
                    (r) => {
                      const d = describeTest(r);
                      if (d.ok) toast.success("Nachricht angenommen", d.message);
                      else toast.error("Test-Versand fehlgeschlagen", d.message);
                    },
                    (err: Error) => toast.error("Test-Versand fehlgeschlagen", err.message),
                  );
                }}
              >
                Testnachricht senden
              </Button>
            </div>
            {sent ? <Outcome ok={sent.ok} message={sent.message} remedy={testRemedy} /> : null}
          </section>
        </div>
      )}
    </Card>
  );
}

/**
 * One result, with the next step where there is one.
 *
 * The message is the server's sanitized sentence — never a provider string —
 * and the remedy is this application's advice about what to do next, which is
 * the part a panel can usefully add.
 */
function Outcome({
  ok,
  message,
  remedy,
}: {
  ok: boolean;
  message: string;
  remedy: string | null;
}) {
  return (
    <div
      className="rounded-lg bg-surface-2 p-3 ring-1 ring-line"
      // Announced, because the outcome arrives after a button press and a
      // reader who cannot see the panel gets no other signal that it changed.
      role="status"
    >
      <span className="flex flex-wrap items-center gap-2">
        <Badge tone={ok ? "energy" : "bronze"}>{ok ? "Erfolgreich" : "Fehlgeschlagen"}</Badge>
      </span>
      <p className="mt-2 text-[13px] leading-relaxed text-ink">{message}</p>
      {remedy ? <p className="mt-1 text-[12px] leading-relaxed text-muted">{remedy}</p> : null}
    </div>
  );
}
