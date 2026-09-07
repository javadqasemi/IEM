import { useEffect, useRef, useState, type ReactNode } from "react";
import { Wordmark } from "./Wordmark";
import { cn } from "@/lib/cn";

/**
 * Zugangscode-Schranke vor der Seite.
 *
 * Wichtig, damit sich niemand darauf verlässt: das ist eine *Anzeige*-Sperre,
 * keine Sicherheit. Der Code steht im ausgelieferten Bundle und ist mit den
 * Entwicklerwerkzeugen in Sekunden zu finden — die Seite bleibt vollständig
 * über das Netzwerk abrufbar. Sie hält Zufallsbesucher von einer Vorschau ab,
 * mehr nicht. Wer echten Schutz braucht, setzt ihn beim Server an (Basic Auth
 * o. ä.), nicht hier.
 */
const CODE = "753159";
const LAENGE = CODE.length;

/**
 * `sessionStorage`, nicht `localStorage`: die Freigabe soll für den Besuch
 * gelten, nicht für immer. Sie überlebt damit den Sprung von der Startseite in
 * ein Stelleninserat (`stelle.html`), das eine eigene React-Wurzel mountet und
 * sonst erneut fragen würde — aber nicht das Schliessen des Browsers.
 */
const SCHLUESSEL = "iem:zutritt";

/** Privater Modus kann jeden Zugriff auf den Storage werfen. */
function freigegeben(): boolean {
  try {
    return sessionStorage.getItem(SCHLUESSEL) === CODE;
  } catch {
    return false;
  }
}

function freigeben() {
  try {
    sessionStorage.setItem(SCHLUESSEL, CODE);
  } catch {
    /* Ohne Storage gilt die Freigabe nur für diese Seite — auch das genügt. */
  }
}

export function CodeGate({ children }: { children: ReactNode }) {
  const [offen, setOffen] = useState(freigegeben);
  if (offen) return <>{children}</>;
  return <CodeDialog onOk={() => setOffen(true)} />;
}

function CodeDialog({ onOk }: { onOk: () => void }) {
  const [ziffern, setZiffern] = useState<string[]>(() => Array(LAENGE).fill(""));
  const [fehler, setFehler] = useState(false);
  const felder = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    felder.current[0]?.focus();
  }, []);

  function pruefen(werte: string[]) {
    const eingabe = werte.join("");
    if (eingabe.length < LAENGE) return;
    if (eingabe === CODE) {
      freigeben();
      onOk();
      return;
    }
    setFehler(true);
    setZiffern(Array(LAENGE).fill(""));
    felder.current[0]?.focus();
  }

  function setzen(index: number, roh: string) {
    // Eine Ziffernfolge (Tippen, Einfügen, Autofill der SMS-Vorschläge) füllt
    // ab dem aktuellen Feld weiter, statt nur das eine Zeichen zu nehmen.
    const folge = roh.replace(/\D/g, "");
    if (!folge) return;
    setFehler(false);
    const naechste = [...ziffern];
    for (let i = 0; i < folge.length && index + i < LAENGE; i++) {
      naechste[index + i] = folge[i];
    }
    setZiffern(naechste);
    const ziel = Math.min(index + folge.length, LAENGE - 1);
    felder.current[ziel]?.focus();
    pruefen(naechste);
  }

  function taste(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      e.preventDefault();
      setFehler(false);
      const naechste = [...ziffern];
      if (naechste[index]) {
        naechste[index] = "";
      } else if (index > 0) {
        naechste[index - 1] = "";
        felder.current[index - 1]?.focus();
      }
      setZiffern(naechste);
      return;
    }
    if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault();
      felder.current[index - 1]?.focus();
    }
    if (e.key === "ArrowRight" && index < LAENGE - 1) {
      e.preventDefault();
      felder.current[index + 1]?.focus();
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-brand-navy px-5 py-16">
      {/* Dasselbe Blaupausenraster wie im Hero, hier auf Navy. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-[0.14]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
        }}
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          pruefen(ziffern);
        }}
        className="relative w-full max-w-md animate-fade-up rounded-lg bg-surface p-8 shadow-card sm:p-10"
      >
        <Wordmark className="h-7 text-brand-navy" />

        <p className="eyebrow mt-8 text-brand-bronze">Zugang</p>
        <h1 className="mt-2 font-display text-display-md text-ink">Zugangscode eingeben</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          Diese Vorschau ist nicht öffentlich. Bitte den sechsstelligen Code eingeben.
        </p>

        <div className="mt-8 flex justify-between gap-2" role="group" aria-label="Zugangscode">
          {ziffern.map((z, i) => (
            <input
              key={i}
              ref={(el) => {
                felder.current[i] = el;
              }}
              value={z}
              onChange={(e) => setzen(i, e.target.value)}
              onKeyDown={(e) => taste(i, e)}
              onFocus={(e) => e.target.select()}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={LAENGE}
              aria-label={`Ziffer ${i + 1} von ${LAENGE}`}
              aria-invalid={fehler}
              className={cn(
                "h-14 w-full min-w-0 rounded-md bg-surface-2 text-center font-mono text-xl text-ink",
                "ring-1 transition-[box-shadow,background] duration-200",
                "focus:outline-none focus:ring-2",
                fehler
                  ? "ring-disc-heat focus:ring-disc-heat"
                  : "ring-line focus:bg-surface focus:ring-brand-navy",
              )}
            />
          ))}
        </div>

        {/* Der Platz bleibt reserviert, damit die Karte beim Fehler nicht springt. */}
        <p
          role="status"
          aria-live="polite"
          className={cn(
            "mt-4 min-h-[1.25rem] text-sm",
            fehler ? "text-disc-heat" : "text-transparent",
          )}
        >
          {fehler ? "Code ungültig. Bitte erneut versuchen." : " "}
        </p>

        <div className="tick-rule mt-6 pt-5">
          <p className="text-sm text-muted">
            Code vergessen?{" "}
            <a
              href="tel:+41782485859"
              className="text-brand-blue underline decoration-line underline-offset-4 hover:text-brand-bronze"
            >
              +41 782 248 58 59
            </a>
          </p>
        </div>
      </form>
    </main>
  );
}
