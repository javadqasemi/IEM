import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NestInterceptor,
  CallHandler,
  ExecutionContext,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { Observable, map } from "rxjs";

/* ------------------------------------------------------------------ */
/* Error shape                                                         */
/* ------------------------------------------------------------------ */

/**
 * One error shape for the whole API.
 *
 * The dashboard has a single error renderer, so the server has to give it a
 * single thing to render. `code` is what the client branches on; `message` is
 * what a human reads; `fields` carries per-field validation messages so a form
 * can put them beside the inputs rather than in a banner.
 */
export type ApiError = {
  statusCode: number;
  code: string;
  message: string;
  fields?: Record<string, string[]>;
  requestId?: string;
  path: string;
  timestamp: string;
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("Http");

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = "internal_error";
    let message = "Ein unerwarteter Fehler ist aufgetreten.";
    let fields: Record<string, string[]> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      code = httpCode(status);
      if (typeof body === "string") {
        message = body;
      } else if (body && typeof body === "object") {
        const b = body as Record<string, unknown>;
        // `ValidationPipe` puts an array of strings in `message`; everything
        // else puts a single string there.
        if (Array.isArray(b.message)) {
          code = "validation_failed";
          message = "Die Eingaben sind unvollständig oder ungültig.";
          fields = groupValidationMessages(b.message as string[]);
        } else if (typeof b.message === "string") {
          message = b.message;
        }
        if (typeof b.code === "string") code = b.code;
        if (b.fields && typeof b.fields === "object") {
          fields = b.fields as Record<string, string[]>;
        }
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // Translate the handful of Prisma codes that correspond to something a
      // caller did, rather than leaking a 500 for a duplicate key.
      switch (exception.code) {
        case "P2002":
          status = HttpStatus.CONFLICT;
          code = "already_exists";
          message = "Dieser Wert ist bereits vergeben.";
          break;
        case "P2025":
          status = HttpStatus.NOT_FOUND;
          code = "not_found";
          message = "Der Eintrag wurde nicht gefunden.";
          break;
        case "P2003":
          status = HttpStatus.CONFLICT;
          code = "in_use";
          message = "Der Eintrag wird noch verwendet und kann nicht gelöscht werden.";
          break;
        default:
          this.logger.error(`Prisma ${exception.code}: ${exception.message}`);
      }
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    const payload: ApiError = {
      statusCode: status,
      code,
      message,
      ...(fields ? { fields } : {}),
      path: req.originalUrl,
      timestamp: new Date().toISOString(),
    };
    res.status(status).json(payload);
  }
}

function httpCode(status: number): string {
  switch (status) {
    case 400: return "bad_request";
    case 401: return "unauthenticated";
    case 403: return "forbidden";
    case 404: return "not_found";
    case 409: return "conflict";
    case 413: return "too_large";
    case 422: return "unprocessable";
    case 429: return "rate_limited";
    default: return status >= 500 ? "internal_error" : "error";
  }
}

/**
 * `ValidationPipe` flattens nested errors into strings like
 * `"detail.kontakt.name should not be empty"`. Splitting the leading dotted
 * path back out lets the dashboard attach each message to its own input.
 */
function groupValidationMessages(messages: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const m of messages) {
    const field = m.split(" ")[0];
    const key = /^[\w.[\]]+$/.test(field) ? field : "_";
    (out[key] ??= []).push(m);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Envelope                                                            */
/* ------------------------------------------------------------------ */

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
};

/**
 * Wraps every successful body as `{ data: … }`.
 *
 * It costs one key and buys the ability to add `meta` later without breaking
 * every caller — which a bare array cannot do. A handler that already returns
 * a `{ data }` shape is passed through untouched so paginated responses do not
 * end up double-wrapped.
 */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((body) =>
        body && typeof body === "object" && "data" in (body as object) ? body : { data: body },
      ),
    );
  }
}

/** Standard list query, shared by every collection endpoint. */
export function paginate<T>(items: T[], total: number, page: number, perPage: number): Paginated<T> {
  return { items, total, page, perPage, pages: Math.max(1, Math.ceil(total / perPage)) };
}
