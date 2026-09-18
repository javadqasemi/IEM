import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

/** The raw query string, before any pipe has touched it. */
export type RawListQuery = Record<string, unknown>;

/**
 * The whole query object, unfiltered.
 *
 * **It has to bypass the validation pipe, and that is not a shortcut.** The
 * global pipe runs with `whitelist: true`, which strips any property a DTO
 * does not declare — and `filter[status]` cannot be declared, because its key
 * is chosen by the caller. A `@Query() dto: ListQueryDto` therefore arrives
 * with every filter silently removed: no error, no warning, a list that
 * ignores the filter somebody set. That is the same trap the content and
 * settings DTOs fell into twice, wearing a different hat.
 *
 * Nothing is lost by skipping the pipe, because `parseListQuery` is the
 * validator: it coerces the types, enforces both allowlists, bounds the page
 * size and throws `BadRequestException` naming what *is* allowed. A DTO could
 * only have checked the four static fields, and it would have looked like the
 * whole thing was checked.
 *
 * ```ts
 * @Get()
 * list(@ListQuery() query: RawListQuery) {
 *   return this.applications.list(query);
 * }
 * ```
 */
export const ListQuery = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<Request>().query as RawListQuery;
});
