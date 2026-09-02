import { useState } from "react";
import { Button } from "./Button";
import { BewerbungDialog } from "./BewerbungDialog";
import { Wordmark } from "./Wordmark";
import {
  jobBewerbung,
  jobSchluss,
  jobUeberUns,
  offices,
  openings,
} from "@/content/iem";

type Opening = (typeof openings)[number];

const MAIL = "info@iem.ch";

/**
 * The Bewerbung paragraph ends on the address IEM wants the dossier sent to,
 * so it is split off and linked rather than left as text a reader has to
 * retype. The wording is untouched — the address is the tail of the verbatim
 * string, and the `endsWith` guard means a reworded advert falls back to plain
 * text instead of silently losing its last words.
 */
function bewerbungTeile(text: string): [string, string | null] {
  return text.endsWith(MAIL) ? [text.slice(0, -MAIL.length), MAIL] : [text, null];
}

/**
 * One job advert as a page of its own.
 *
 * It stands on its own entry point (`stelle.html`) rather than in a dialog on
 * the landing page, because that is what makes it a real window: an address a
 * reader can send to someone, keep open beside the register, print, or bookmark.
 * A modal can do none of those, and a job advert is exactly the kind of thing
 * that gets forwarded.
 *
 * The body is the client's own PDF, set as text — see `JobDetail` in the
 * content module for why it is stored verbatim. The PDF itself stays one click
 * away at the foot: this page is a reading copy, not a replacement for the
 * signed document.
 */
function Liste({ titel, items }: { titel: string; items: string[] }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-xl font-semibold text-ink">{titel}</h2>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item} className="flex gap-3 text-[15px] leading-relaxed text-ink">
            {/* A rule, not a bullet — the same hairline vocabulary the rest of
                the page uses for a list of measured facts. */}
            <span aria-hidden className="mt-[0.6em] h-px w-3 shrink-0 bg-brand-gold" />
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function StelleDetail({ opening }: { opening: Opening }) {
  const [open, setOpen] = useState(false);
  const d = opening.detail;
  const [bewerbungText, bewerbungMail] = bewerbungTeile(jobBewerbung);

  return (
    <div className="min-h-dvh bg-base">
      {/* Back to the register rather than a full site header: this window was
          opened from there, and a second copy of the nav would invite the
          reader to treat it as the site rather than as one document. */}
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-4">
          {/* `Wordmark` carries its own `aria-label="IEM"`, so the link needs
              no second label of its own — one would be read out twice. */}
          <a
            href="/"
            title="IEM AG — Startseite"
            className="flex items-center text-brand-navy transition-colors hover:text-brand-blue"
          >
            <Wordmark className="h-5 w-auto" />
          </a>
          <a
            href="/#karriere"
            className="eyebrow flex items-center gap-1.5 text-brand-blue transition-colors hover:text-brand-bronze"
          >
            <span aria-hidden>←</span>
            Alle offenen Stellen
          </a>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-10 sm:py-14">
        <div className="flex flex-col gap-5">
          <p className="eyebrow text-muted">
            {opening.category} · {opening.place} · {opening.pensum}
          </p>
          <h1 className="font-display text-display-md font-semibold leading-tight text-ink">
            {d.titel}
          </h1>
          <p className="max-w-prose text-[16px] leading-relaxed text-muted">{d.einstieg}</p>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button variant="mark" onClick={() => setOpen(true)}>
              Jetzt bewerben
            </Button>
            <Button variant="secondary" href={opening.pdf} target="_blank" rel="noreferrer noopener">
              Original-Inserat (PDF)
            </Button>
          </div>
        </div>

        <section className="tick-rule flex flex-col gap-3 pt-8">
          <h2 className="font-display text-xl font-semibold text-ink">Über uns</h2>
          <p className="max-w-prose text-[15px] leading-relaxed text-ink">{jobUeberUns}</p>
        </section>

        <Liste titel="Deine Aufgaben" items={d.aufgaben} />
        <Liste titel="Dein Profil" items={d.profil} />
        <Liste titel="Wir bieten" items={d.bieten} />

        <section className="flex flex-col gap-4 rounded-lg bg-surface p-6 ring-1 ring-line sm:p-8">
          <h2 className="font-display text-xl font-semibold text-ink">Bewerbung</h2>
          <p className="max-w-prose text-[15px] leading-relaxed text-ink">
            {bewerbungText}
            {bewerbungMail ? (
              <a
                href={`mailto:${bewerbungMail}`}
                className="font-medium text-brand-blue underline decoration-line-strong underline-offset-4 hover:text-brand-bronze"
              >
                {bewerbungMail}
              </a>
            ) : null}
          </p>
          <p className="max-w-prose text-[15px] leading-relaxed text-ink">
            Für Rückfragen steht Dir {d.kontakt.name} unter der Telefonnummer{" "}
            <a
              href={`tel:+41${d.kontakt.telefon.replace(/\D/g, "").replace(/^0/, "")}`}
              className="font-medium text-brand-blue underline decoration-line-strong underline-offset-4 hover:text-brand-bronze"
            >
              {d.kontakt.telefon}
            </a>{" "}
            gerne zur Verfügung.
          </p>
          <p className="max-w-prose text-[15px] leading-relaxed text-ink">{jobSchluss}</p>
          <div className="pt-1">
            {/* The same trigger as at the top: on a page this long, a reader who
                has just finished reading should not have to scroll back up to
                act on it. */}
            <Button variant="mark" onClick={() => setOpen(true)}>
              Jetzt bewerben
            </Button>
          </div>
        </section>

        <footer className="flex flex-col gap-2 border-t border-line pt-6 text-[13px] leading-relaxed text-muted">
          <p>
            Inseratstext gemäss dem von IEM veröffentlichten{" "}
            <a
              href={opening.pdf}
              target="_blank"
              rel="noreferrer noopener"
              className="text-brand-blue underline decoration-line-strong underline-offset-2 hover:text-brand-bronze"
            >
              Stelleninserat (PDF)
            </a>
            .
          </p>
          <p>
            IEM AG ·{" "}
            {offices.map((o, i) => (
              <span key={o.city}>
                {i > 0 ? " · " : ""}
                {o.city}, {o.street}
              </span>
            ))}
          </p>
        </footer>
      </main>

      {/* Hosted here rather than reached through the landing page's custom
          event: this window has its own React root, and `BewerbungButton`'s
          `iem:open-bewerbung` listener lives in the other one. */}
      <BewerbungDialog open={open} position={opening.role} onClose={() => setOpen(false)} />
    </div>
  );
}

/** Shown when the `?id=` in the address matches no advert. */
export function StelleNichtGefunden() {
  return (
    <div className="grid min-h-dvh place-items-center bg-base px-6">
      <div className="flex max-w-md flex-col items-start gap-4">
        <Wordmark className="h-5 w-auto text-brand-navy" />
        <h1 className="font-display text-display-md font-semibold text-ink">
          Dieses Inserat gibt es nicht.
        </h1>
        <p className="text-[15px] leading-relaxed text-muted">
          Die Stelle wurde vermutlich besetzt oder die Adresse ist unvollständig. Die aktuell
          offenen Stellen stehen auf der Karriere-Seite.
        </p>
        <Button href="/#karriere" trailing="→">
          Offene Stellen
        </Button>
      </div>
    </div>
  );
}
