import type { Prisma } from "@prisma/client";

/**
 * Gewerk master data.
 *
 * `defaultColour` leaves as `colour` and it is **a token name**, never a hex
 * literal. Every consumer — the drawings, the Gantt, the Kanban, the 3D scene —
 * resolves it per theme, so a Lüftung run is the same colour everywhere and
 * still answers to dark mode. A hex value here would be the one colour in the
 * system `theme.tokens.test.ts` cannot see.
 */

export const DISCIPLINE_SELECT = {
  id: true,
  code: true,
  name: true,
  defaultColour: true,
  defaultBudgetShare: true,
  defaultHourlyRate: true,
  order: true,
  active: true,
  manager: { select: { id: true, firstName: true, lastName: true, email: true } },
} satisfies Prisma.DisciplineSelect;

type Row = Prisma.DisciplineGetPayload<{ select: typeof DISCIPLINE_SELECT }>;

export function toDiscipline(row: Row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    colour: row.defaultColour,
    // A share, so a number; a rate, so a money string. The same split
    // `projects.mapper.ts` makes, for the same reason.
    defaultBudgetShare: row.defaultBudgetShare === null ? null : row.defaultBudgetShare.toNumber(),
    defaultHourlyRate: row.defaultHourlyRate === null ? null : row.defaultHourlyRate.toFixed(2),
    order: row.order,
    active: row.active,
    /** The Fachbereichsleiter — the answer to "who do I ask about Lüftung". */
    manager: row.manager
      ? {
          id: row.manager.id,
          name: `${row.manager.firstName} ${row.manager.lastName}`,
          email: row.manager.email,
        }
      : null,
  };
}

export type DisciplineView = ReturnType<typeof toDiscipline>;