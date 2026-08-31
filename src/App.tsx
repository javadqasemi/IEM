import type { ReactNode } from "react";
import { Nav } from "./components/Nav";
import { Hero } from "./components/Hero";
import { SectionHeader } from "./components/SectionHeader";
import { ServiceIndex } from "./components/ServiceIndex";
import { CompanyProfile } from "./components/CompanyProfile";
import { Bauablauf } from "./components/Bauablauf";
import { ProjectRegister } from "./components/ProjectRegister";
import { TeamGrid } from "./components/TeamGrid";
import { Button } from "./components/Button";
import { JobRegister } from "./components/JobRegister";
import { ProfisMark } from "./components/ProfisMark";
import { Footer } from "./components/Footer";
import { facts, offices, sponsorships } from "@/content/iem";

export function App() {
  return (
    <div id="top" className="min-h-screen">
      <a href="#leistungen" className="skip-link">
        Zum Inhalt springen
      </a>

      <Nav />

      <main>
        <Hero />

        <Section id="leistungen">
          <SectionHeader
            eyebrow="Dienstleistungen"
            title="Fünf Fachbereiche, ein Ansprechpartner."
            description="Wir planen Gebäudetechnik gewerkeübergreifend — und bleiben bis zur Abnahme im Projekt."
          />
          <div className="mt-12">
            <ServiceIndex />
          </div>
        </Section>

        <Section id="ablauf" tinted>
          <SectionHeader
            eyebrow="Ablauf"
            title="Wo wir einsteigen — und wann wir aufhören."
            description="Meist im Vorprojekt, spätestens zur Ausschreibung. Aufgehört wird nach der Einregulierung, wenn die Anlage gemessen ist."
          />
          <div className="mt-12">
            <Bauablauf />
          </div>
        </Section>

        <Section id="referenzen">
          <SectionHeader
            eyebrow="Referenzen"
            title="Gebaut, gemessen, abgenommen."
            description="Ein Auszug aus den Projekten, die wir öffentlich dokumentieren — Pflege, Bildung, Gewerbe und Photovoltaik."
          />
          <div className="mt-12">
            <ProjectRegister />
          </div>
        </Section>

        {/* iem.ch/ueber-uns, which the page had no home for: the Leitbild and
            the register of company facts. The heading's "über 30" is computed
            from `facts.founded` rather than typed, so it cannot go stale the
            way the client's own page eventually will. */}
        <Section id="ueber-uns" tinted>
          <SectionHeader
            eyebrow="Über uns"
            title={`Seit über ${
              Math.floor((new Date().getFullYear() - facts.founded) / 10) * 10
            } Jahren.`}
            description={`Seit dem ${facts.foundedLong} stehen wir für massgeschneiderte Lösungen in den Bereichen Heizung, Lüftung, Klima, Sanitär und Elektro.`}
          />
          <div className="mt-12">
            <CompanyProfile />
          </div>
        </Section>

        <Section id="team">
          <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-8">
            <SectionHeader
              className="lg:col-span-6"
              eyebrow="Team"
              title={`${facts.headcount} Leute, zwei Büros.`}
              description="Gebäudetechnik plant niemand allein. Das sind die Menschen, die an Ihrem Projekt arbeiten — Lernende eingerechnet."
            />
            {/* The image the client heads their own team page with. */}
            <div className="overflow-hidden rounded-lg ring-1 ring-line lg:col-span-6">
              <img
                src="/img/team/chrischonaturm.jpg"
                alt="Aussichtsturm St. Chrischona"
                loading="lazy"
                decoding="async"
                className="aspect-[16/9] w-full object-cover"
              />
            </div>
          </div>
          <div className="mt-14">
            <TeamGrid />
          </div>
        </Section>

        <Section id="sponsoring" tinted>
          <SectionHeader
            eyebrow="Sponsoring"
            title="Wen wir unterstützen."
            description="Sport aus der Region und aus dem eigenen Team — vom Eishockey bis zum Gleitschirm-Testflug."
          />
          <ul className="mt-12 grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 lg:grid-cols-5">
            {sponsorships.map((s) => (
              <li key={s.name} className="group flex flex-col gap-3">
                <div className="overflow-hidden rounded-md bg-surface ring-1 ring-line">
                  <img
                    src={s.photo}
                    alt={s.name}
                    loading="lazy"
                    decoding="async"
                    className={`aspect-[3/4] w-full transition-transform duration-500 group-hover:scale-[1.04] ${
                      s.fit === "contain" ? "object-contain p-5" : "object-cover"
                    }`}
                  />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[14px] font-medium leading-tight text-ink">{s.name}</span>
                  <span className="text-[12px] leading-snug text-muted">{s.detail}</span>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="karriere">
          <SectionHeader
            eyebrow="Karriere"
            title="Wir suchen Leute, die nachrechnen."
            description="Sieben offene Stellen in Thun und Bern. Dazu jedes Jahr Schnupperlehren — Lehrstellen sind ab Sommer 2026 alle besetzt."
            action={<ProfisMark className="h-[150px] w-full sm:w-[280px]" />}
          />
          <div className="mt-12">
            <JobRegister />
          </div>
        </Section>

        <Section id="standorte">
          <SectionHeader
            eyebrow="Standorte"
            title="Zwei Büros, kurze Wege."
            description="Beide Standorte planen vollständig — Sie arbeiten mit dem Team, das näher an Ihrer Baustelle sitzt."
          />
          <div className="mt-12 grid gap-px overflow-hidden rounded-lg bg-line ring-1 ring-line md:grid-cols-2">
            {offices.map((o) => (
              <div key={o.city} className="flex flex-col gap-6 bg-surface p-8 sm:p-10">
                <div className="flex items-start justify-between gap-4">
                  <h3 className="font-display text-display-md font-semibold text-ink">{o.city}</h3>
                  <span className="eyebrow text-muted">
                    {o.city === "Thun" ? "Hauptsitz" : "Zweigbüro"}
                  </span>
                </div>
                <address className="flex flex-col gap-1 text-[15px] not-italic leading-relaxed text-muted">
                  <span className="text-ink">{o.street}</span>
                  <span>{o.zip}</span>
                </address>
                <div className="mt-auto flex flex-wrap gap-3">
                  <Button variant="secondary" href={o.phoneHref}>
                    {o.phone}
                  </Button>
                  <Button
                    variant="ghost"
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                      `${o.street}, ${o.zip}`,
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                    trailing="↗"
                  >
                    Anfahrt
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <section id="kontakt" className="px-6 pb-24 pt-[1.6rem] sm:pb-32 lg:px-10">
          <div className="mx-auto max-w-7xl">
            <div className="relative overflow-hidden rounded-lg bg-brand-navy px-8 py-14 sm:px-14 sm:py-20">
              <div
                aria-hidden
                className="absolute inset-0 opacity-[0.14]"
                style={{
                  backgroundImage:
                    "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
                  backgroundSize: "56px 56px",
                }}
              />
              <div className="relative flex flex-col gap-10 lg:flex-row lg:items-end lg:justify-between">
                <div className="flex max-w-2xl flex-col gap-5">
                  <p className="eyebrow text-brand-sand">Kontakt</p>
                  <h2 className="font-display text-display-lg font-semibold text-surface">
                    Erzählen Sie uns vom Gebäude.
                  </h2>
                  <p className="text-lg leading-relaxed text-surface/70">
                    Nutzung, Baujahr, was heute nicht funktioniert — das genügt
                    für ein erstes Gespräch. Wir sagen Ihnen, welche Variante wir
                    rechnen würden und was sie kostet.
                  </p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button size="lg" variant="inverse" href="mailto:info@iem.ch" trailing="→">
                    info@iem.ch
                  </Button>
                  <Button size="lg" variant="inverseOutline" href={offices[0].phoneHref}>
                    {offices[0].phone}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

/** Consistent section rhythm; `tinted` alternates the ground to group content. */
function Section({
  id,
  tinted,
  children,
}: {
  id: string;
  tinted?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={
        tinted
          ? "border-y border-line bg-surface py-[3.2rem] sm:py-[4.48rem]"
          : "py-[3.2rem] sm:py-[4.48rem]"
      }
    >
      <div className="mx-auto max-w-7xl px-6 lg:px-10">{children}</div>
    </section>
  );
}
