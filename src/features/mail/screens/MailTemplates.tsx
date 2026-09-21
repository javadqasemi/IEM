import { useState } from "react";
import { Badge, Button, Card, ErrorState, Skeleton } from "@/shared/ui/primitives";
import { Modal } from "@/shared/ui/overlays";
import { useMailTemplatePreview, useMailTemplates } from "../hooks/useMail";
import { groupTemplates } from "../service";

/**
 * Every message the application can put in somebody's inbox, previewable.
 *
 * ---
 *
 * ## A catalogue, not an editor
 *
 * The brief asks for templates and explicitly not for a free-form HTML editor,
 * and `server/src/mail/mail.templates.ts` carries the full argument. The short
 * version: a template is where a **variable meets a string**, and both ways
 * that goes wrong — a reference to something that does not exist, and a
 * convincing sentence written beside a real link — are worse in a system whose
 * messages include "your second factor was removed".
 *
 * In code, the variables a template may use are its parameter type, so a
 * reference to something that does not exist is a compile error rather than a
 * support ticket. What an operator needs is not the ability to rewrite them —
 * it is the ability to **see what will be sent**, which is what this screen is.
 *
 * ## The preview sends nothing
 *
 * It renders with sample values. Previewing "Ihr zweiter Faktor wurde
 * zurückgesetzt" by actually mailing it would produce a security alert that is
 * a lie, in the one category of message where a false alarm costs the most.
 */
export function MailTemplates() {
  const templates = useMailTemplates();
  const [open, setOpen] = useState<string | null>(null);

  if (templates.error) {
    return (
      <Card title="Vorlagen">
        <ErrorState message="Die Vorlagen konnten nicht geladen werden." />
      </Card>
    );
  }

  if (!templates.data) {
    return (
      <Card title="Vorlagen">
        <Skeleton className="h-32" />
      </Card>
    );
  }

  const groups = groupTemplates(templates.data.items);

  return (
    <Card
      title="Vorlagen"
      description="Alle Nachrichten, die das System versenden kann. Der Wortlaut steht im Code — die Vorschau zeigt ihn mit Beispielwerten, ohne etwas zu senden."
    >
      <div className="flex flex-col gap-6">
        {groups.map((group) => (
          <section key={group.category}>
            <h4 className="field-label">{group.category}</h4>
            <ul className="mt-2 flex flex-col divide-y divide-line">
              {group.items.map((item) => (
                <li
                  key={item.key}
                  className="flex flex-wrap items-start justify-between gap-3 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-[14px] text-ink">
                      {item.label}
                      {item.optional ? (
                        <Badge tone="neutral">Abbestellbar</Badge>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
                      {item.description}
                    </p>
                    {item.variables.length ? (
                      <p className="mt-1 font-mono text-[11px] text-muted">
                        {item.variables.join(" · ")}
                      </p>
                    ) : null}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setOpen(item.key)}>
                    Vorschau
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <PreviewDialog templateKey={open} onClose={() => setOpen(null)} />
    </Card>
  );
}

function PreviewDialog({
  templateKey,
  onClose,
}: {
  templateKey: string | null;
  onClose: () => void;
}) {
  // A null key keeps the request off the wire until somebody opens one — the
  // catalogue has fourteen entries and pre-fetching them all to fill a dialog
  // nobody may open is fourteen requests for nothing.
  const preview = useMailTemplatePreview(templateKey);

  return (
    <Modal open={templateKey !== null} onClose={onClose} title="Vorschau" size="lg">
      {preview.error ? (
        <ErrorState message="Diese Vorlage konnte nicht gerendert werden." />
      ) : !preview.data ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <h4 className="field-label">Betreff</h4>
            <p className="mt-1 text-[14px] text-ink">{preview.data.subject}</p>
          </div>
          <div>
            <h4 className="field-label">Inhalt</h4>
            {/*
              `whitespace-pre-wrap` on plain text, not `dangerouslySetInnerHTML`.

              Every message this system sends is plain text — see
              `mail.templates.ts` — which means the whole class of
              HTML-injection questions does not arise: there is no markup to
              escape, no URL scheme to allowlist and no script to strip. This
              element is where that would have been reintroduced, so it is
              worth the comment.
            */}
            <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-surface-2 p-3 font-mono text-[12px] leading-relaxed text-ink ring-1 ring-line">
              {preview.data.text}
            </pre>
          </div>
          <p className="text-[12px] text-muted">
            Beispielwerte. Es wurde nichts versendet.
          </p>
        </div>
      )}
    </Modal>
  );
}
