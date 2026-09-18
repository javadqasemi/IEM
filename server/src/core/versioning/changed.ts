/**
 * Which fields a `PATCH` body actually carried.
 *
 * ---
 *
 * **The bug this exists for, because it is invisible everywhere it matters.**
 *
 * `Object.keys(dto)` on a validated DTO returns **every declared property**, not
 * the ones the caller sent. The reason is two settings agreeing:
 * `tsconfig.json` targets ES2022, so `useDefineForClassFields` defaults to true
 * and every `@IsOptional() foo?: string` is *defined* on the instance as
 * `undefined`; and `ValidationPipe` runs with `transform: true`, so what reaches
 * the service is a class instance rather than the plain object the request
 * parsed.
 *
 * Nothing about that fails. It typechecks, every unit test passes, and the
 * endpoint answers 200. What it produces is a **version history in which every
 * edit changed every field** and a `TaskUpdated`/`ProjectUpdated` event whose
 * `fields` payload is the whole DTO — so the one thing a history is for, reading
 * as a sentence rather than as two JSON blobs, does not work, and a workflow
 * rule that wanted to react to "somebody moved the deadline" would fire on every
 * save.
 *
 * It was found by opening the Verlauf tab in a browser and reading a row that
 * listed eleven fields for a request that sent one. There was no other way to
 * see it: the shape is right, the count is plausible, and `changed: string[]`
 * cannot be wrong at the type level.
 *
 * ---
 *
 * `undefined` means "not supplied" and `null` means "clear it" — the same
 * distinction the mappers make — so a `null` is a change and is kept.
 */
export function changedFields(dto: object, ignore: readonly string[] = []): string[] {
  const skip = new Set(ignore);
  return Object.entries(dto)
    .filter(([key, value]) => !skip.has(key) && value !== undefined)
    .map(([key]) => key);
}

/**
 * The keys that are not data.
 *
 * `expectedVersion` is the optimistic lock and `versionNote` is the note *about*
 * the change; neither is a field of the record, and a history saying "version
 * changed" on every row would be noise on the one screen that exists to be
 * readable.
 */
export const VERSION_CONTROL_FIELDS = ["expectedVersion", "versionNote"] as const;
