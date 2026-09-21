import { Badge, Card, type BadgeTone } from "@/shared/ui/primitives";
import { Pair } from "@/shared/ui/data";
import { formatDateTime, relativeTime } from "@/shared/utils/format";
import { describeState, headlineFor, type StateTone } from "../service";
import type { MailProbe, MailStatus } from "../types";

/**
 * The verdict, and the evidence for it.
 *
 * Every figure is measured — the provider description comes from the resolved
 * configuration, the two probes from the audit log, the counts from
 * `NotificationDelivery`. Nothing on this card is declared, which is the
 * brief's "never create fake status data" applied at the point where it is
 * easiest to break: a panel is exactly where somebody reaches for a plausible
 * placeholder.
 */

/**
 * The semantic tone the service returns, mapped to the brand's badge palette.
 *
 * Mapped here rather than in `service.ts` so the pure layer keeps saying
 * *what it means* — positive, warning, danger — and this layer decides what
 * that looks like. It is the same split `features/notifications/service.ts`
 * makes, and the reason a theme change never touches a rules file.
 */
const TONE: Record<StateTone, BadgeTone> = {
  positive: "energy",
  warning: "gold",
  danger: "bronze",
  neutral: "neutral",
};

export function MailStatusCard({ status }: { status: MailStatus }) {
  const state = describeState(status.state);

  return (
    <Card
      title="Status"
      description={headlineFor(status)}
      action={<Badge tone={TONE[state.tone]}>{state.label}</Badge>}
    >
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Pair label="Anbieter">{status.provider.kind}</Pair>
        <Pair label="Server">
          {status.provider.host ? (
            <span className="font-mono text-[13px]">
              {status.provider.host}:{status.provider.port}
            </span>
          ) : (
            <span className="text-muted">— keiner konfiguriert —</span>
          )}
        </Pair>
        <Pair label="TLS">
          {status.provider.secure ? "Ab Verbindungsaufbau" : "STARTTLS oder keine"}
        </Pair>
        <Pair label="Absender">
          {status.provider.fromName} &lt;{status.provider.from}&gt;
        </Pair>
        <Pair label="Antwort an">
          {status.provider.replyTo ?? <span className="text-muted">— Absenderadresse —</span>}
        </Pair>
        <Pair label="Zugangsdaten">
          {/*
            A boolean, never the pair. The type this reads has no field a
            password could occupy — see `MailStatus` — so there is nothing here
            to accidentally render.
          */}
          {status.provider.hasCredentials ? (
            <Badge tone="neutral">Hinterlegt</Badge>
          ) : (
            <span className="text-muted">Keine — offenes Relay oder Umgebung</span>
          )}
        </Pair>
      </dl>

      {!status.secretsReadable ? (
        /*
          The failure that otherwise reads as success.

          A stored credential the server cannot decrypt leaves every other
          field on this card looking correct — the row exists, so "configured"
          is true — while every send fails for a reason two layers away. It is
          called out in its own block rather than folded into the status word.
        */
        <p className="mt-4 rounded-lg bg-surface-2 p-3 text-[13px] leading-relaxed text-ink ring-1 ring-line">
          <strong>Gespeichertes Passwort nicht lesbar.</strong> Der Schlüssel{" "}
          <code className="font-mono text-[12px]">APP_SECRETS_ENCRYPTION_KEY</code> fehlt oder wurde
          gewechselt. Setzen Sie das SMTP-Passwort neu, sobald der Schlüssel wieder vorhanden ist.
        </p>
      ) : null}

      {/*
        `<dl>`, not `<div>`, on both of these.

        `Pair` renders a `<dt>`/`<dd>`, and those are only valid inside a
        definition list — axe's `dlitem` rule is *serious* and it caught both of
        these blocks the first time this screen was scanned. The first grid
        above was already a `<dl>`; these two were copied from it and lost the
        element while keeping the classes, which is exactly the mistake a
        grid-shaped list invites.
      */}
      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        <ProbeLine label="Letzter Verbindungstest" probe={status.lastVerify} />
        <ProbeLine label="Letzte Testnachricht" probe={status.lastTestSend} />
      </dl>

      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        <Pair label="Letzte erfolgreiche Zustellung">
          <When at={status.deliveries.lastDeliveredAt} />
        </Pair>
        <Pair label="Letzte fehlgeschlagene Zustellung">
          <When at={status.deliveries.lastFailedAt} />
          {status.deliveries.lastFailureDetail ? (
            <span className="mt-1 block text-[12px] leading-snug text-muted">
              {status.deliveries.lastFailureDetail}
            </span>
          ) : null}
        </Pair>
      </dl>

      <div className="mt-5 flex flex-wrap gap-2">
        <Count label="Zugestellt" value={status.deliveries.delivered} />
        <Count label="Fehlgeschlagen" value={status.deliveries.failed} />
        <Count label="In Warteschlange" value={status.deliveries.pending} />
        {/*
          `SKIPPED` is counted and drawn like the rest, because it is a
          deliberate non-send rather than a fault. On a development machine it
          is by far the largest number, and colouring it amber would put a wall
          of warning in front of every operator on every install.
        */}
        <Count label="Übersprungen" value={status.deliveries.skipped} />
      </div>
    </Card>
  );
}

function ProbeLine({ label, probe }: { label: string; probe: MailProbe | null }) {
  if (!probe) {
    return (
      <Pair label={label}>
        <span className="text-muted">Noch nie ausgeführt</span>
      </Pair>
    );
  }
  return (
    <Pair label={label}>
      <span className="flex flex-wrap items-center gap-2">
        <Badge tone={probe.ok ? "energy" : "bronze"}>
          {probe.ok ? "Erfolgreich" : "Fehlgeschlagen"}
        </Badge>
        <span title={formatDateTime(probe.at)} className="text-[13px] text-muted">
          {relativeTime(probe.at)}
          {probe.by ? ` · ${probe.by}` : ""}
        </span>
      </span>
      {probe.detail ? (
        <span className="mt-1 block text-[12px] leading-snug text-muted">{probe.detail}</span>
      ) : null}
    </Pair>
  );
}

function When({ at }: { at: string | null }) {
  if (!at) return <span className="text-muted">—</span>;
  return <span title={formatDateTime(at)}>{relativeTime(at)}</span>;
}

/**
 * One figure and its name.
 *
 * **No `Badge` inside**, and that is the fix for a real violation rather than a
 * simplification. `Badge` sets its text on a 10% wash *of the card's*
 * background — `theme.contrast.test.ts` says so in as many words — so putting
 * one inside a `bg-surface-2` pill changes the colour underneath it and the
 * pair stops clearing AA. axe measured `disc-energy` on that wash at below
 * 4.5:1 in the light theme.
 *
 * The figures do not need colour anyway: they are counts, and the one that
 * matters (`failed`) is already stated by the status word at the top of the
 * card. Colouring them would be a second, quieter verdict beside the real one.
 */
function Count({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-1.5 ring-1 ring-line">
      <span className="text-[13px] font-semibold tabular-nums text-ink">{value}</span>
      <span className="text-[13px] text-muted">{label}</span>
    </span>
  );
}
