import "reflect-metadata";
import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { json, static as expressStatic, urlencoded } from "express";
import type { NextFunction, Request, Response } from "express";
import { resolve } from "node:path";
import { AppModule } from "./app.module";
import { PrismaService } from "./common/prisma.service";
import { listenHost, proxyTrustSetting } from "./common/proxy-trust";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  const logger = new Logger("Bootstrap");

  assertSecretsAreReal(config, logger);
  assertClusteringIsSafe(config, logger);
  configureProxyTrust(app, config, logger);

  /**
   * The API is versioned in the path rather than by header. It is the version
   * scheme a browser client can see in its network tab and a proxy can route
   * on, and the public site's URL — `/api/v1/content/published` — is baked
   * into deployed bundles, so it has to be stable and visible.
   */
  app.setGlobalPrefix("api/v1");

  /**
   * Security headers.
   *
   * `contentSecurityPolicy` is off here on purpose: this process serves JSON
   * and file downloads, never HTML, so a CSP on these responses protects
   * nothing. The dashboard and the public site are static assets served by
   * whatever fronts them, and that is where their CSP belongs.
   *
   * `crossOriginResourcePolicy` is relaxed to `cross-origin` because media is
   * served from here and embedded by the site, which is a different origin.
   */
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
      hsts: config.get("NODE_ENV") === "production" ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );

  app.use(cookieParser());
  // 2 MB. Content entries are text and the largest realistic body is a job
  // advert with its full duty list; files go through multipart, which has its
  // own, larger limit.
  app.use(json({ limit: "2mb" }));
  app.use(urlencoded({ extended: true, limit: "2mb" }));

  /**
   * Uploaded media, served from disk.
   *
   * This was missing, and everything around it assumed it was here:
   * `MEDIA_PUBLIC_PATH` exists, `LocalStorageAdapter.url()` hands out
   * `/media/<key>`, the snapshot stores those paths, and the
   * `crossOriginResourcePolicy` note above says in as many words that media is
   * served from this process. Nothing ever mounted it, so every upload since
   * the beginning wrote correct bytes to disk, recorded a correct URL, and
   * produced a dead link. It is not visible from any one file, which is why it
   * survived: the upload succeeds, the save succeeds, the publish succeeds.
   *
   * **The gate below is not optional.** `applications.service.ts` says its
   * dossiers are "deliberately *not* under the media root", but it passes the
   * key `bewerbungen/<year>/<hash>.<ext>` to this same adapter, whose root
   * *is* `MEDIA_ROOT` — so they are sitting in `var/media` right now. Mounting
   * the root unguarded would publish every applicant's CV to anyone who can
   * guess a URL. The dossiers keep their one legitimate route, the
   * permission-checked download in `ApplicationsController`.
   *
   * It is an allowlist rather than a `bewerbungen/` denial, and that is the
   * whole point. A denial has to be written against `req.path`, which is *not*
   * percent-decoded, while `express.static` decodes before it opens a file —
   * so `/media/%62ewerbungen/…` and `/media/bewerbungen%2f2026%2f…` both walk
   * straight past a prefix test and serve the PDF. Both were verified to leak
   * before this replaced it. Matching the one shape that is legitimate has no
   * such gap: `MediaService.upload` writes exactly
   * `<year>/<slug>-<hash>.<ext>` and nothing else — media folders are a
   * database relation, not a path — so anything that is not two segments of
   * that shape is not a media file, whatever it is.
   *
   * Registered before the static handler so it runs first, and mounted with
   * plain express rather than `useStaticAssets` so the order is the order
   * written here rather than whenever Nest chooses to apply it.
   */
  const mediaRoot = resolve(config.get<string>("MEDIA_ROOT") ?? "./var/media");
  const mediaPath = config.get<string>("MEDIA_PUBLIC_PATH") ?? "/media";

  /** `<year>/<name>.<ext>`, the only shape `MediaService` ever writes. The
      leading character cannot be a dot, which rules out `..` and dotfiles. */
  const PUBLIC_MEDIA_KEY = /^\/\d{4}\/[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

  app.use(mediaPath, (req: Request, res: Response, next: NextFunction) => {
    let path: string;
    try {
      // Decode to the same string `express.static` will resolve, so the test
      // and the file open agree on what was asked for.
      path = decodeURIComponent(req.path);
    } catch {
      // A malformed escape never names a real key.
      res.status(400).end();
      return;
    }
    if (!PUBLIC_MEDIA_KEY.test(path)) {
      res.status(404).end();
      return;
    }
    next();
  });
  /**
   * Neutralises script in a served file, whatever the file turns out to be.
   *
   * `image/svg+xml` is an allowed upload type and SVG is XML, not a binary
   * format with a magic number — so it is admitted on the declared type plus an
   * `<svg>`/`<?xml` root check (`MediaService.sniff`), and neither of those
   * stops `<script>` inside it. This process also runs with helmet's
   * `contentSecurityPolicy` disabled, on the reasoning that it "serves JSON and
   * file downloads, never HTML". Mounting media here made that untrue.
   *
   * The chain that closed: a user holding `media.upload` uploads a scripted
   * SVG; an administrator opens it in a tab; the script runs **on this origin**,
   * where the refresh cookie lives at `path=/api/v1/auth`; a same-origin
   * `fetch("/api/v1/auth/refresh")` matches that path, mints an access token and
   * acts as that administrator.
   *
   * `sandbox` with no allow-tokens is the load-bearing part: it puts the
   * document in a unique opaque origin, so even script that somehow ran could
   * not reach this origin's cookies. `default-src 'none'` stops it running in
   * the first place. Both are inert for a raster image — there is no script
   * context in a JPEG — so this applies to every media response rather than
   * being conditional on a type, which is one fewer thing to get wrong when a
   * format is added to `ALLOWED`.
   *
   * `nosniff` stays because the two belong together: without it a browser may
   * decide a file is HTML despite the declared type, and re-enter exactly the
   * case above.
   */
  app.use(mediaPath, (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });
  app.use(
    mediaPath,
    expressStatic(mediaRoot, {
      index: false,
      dotfiles: "deny",
      // A missing file ends here with a 404 instead of falling through to the
      // API router, where it would come back as a JSON "route not found" for
      // something that is plainly an image request.
      fallthrough: false,
      // Deliberately no long `max-age`: `MediaService.replace` overwrites a
      // key in place (keeping the previous bytes beside it as `-v1`), so a
      // media URL is *not* immutable. `express.static` still sends ETag and
      // Last-Modified, so repeat loads are conditional requests rather than
      // full transfers.
    }),
  );
  logger.log(`Medien: ${mediaPath} → ${mediaRoot}`);

  /**
   * CORS.
   *
   * An explicit allowlist, not a wildcard — `credentials: true` and `*` are
   * incompatible anyway, and the refresh-token cookie needs credentials. The
   * public site's origin has to be listed for it to fetch the published
   * snapshot.
   */
  const origins = (config.get<string>("CORS_ORIGINS") ?? "http://localhost:5173")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    /**
     * Without this the dashboard cannot read `Content-Disposition`.
     *
     * A cross-origin response exposes only the CORS-safelisted headers to
     * script, so `filenameFrom()` — which exists to keep an applicant's own
     * filename on a downloaded dossier — was reading `null` on every call and
     * silently falling back. The fallback happens to be the same name, so the
     * failure was invisible: the feature worked and the header it was built
     * around was never once reachable.
     *
     * Only in development, strictly: in production the dashboard and the API
     * share an origin and none of this applies.
     */
    exposedHeaders: ["Content-Disposition"],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      // Strips keys no DTO declares, rather than rejecting them: a request
      // from an older dashboard build carrying a field since removed should
      // still do the part that is still valid.
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  const prisma = app.get(PrismaService);
  await prisma.enableShutdownHooks(app);
  app.enableShutdownHooks();

  if (config.get("NODE_ENV") !== "production") {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle("IEM CMS API")
        .setDescription(
          "Inhalte, Medien, Benutzer, Rollen und Freigaben für die IEM-Website. " +
            "Öffentlich erreichbar sind nur GET /content/published und POST /applications.",
        )
        .setVersion("1.0")
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup("api/v1/docs", app, doc);
    logger.log("API-Dokumentation: /api/v1/docs");
  }

  /**
   * No explicit host, so Node binds dual-stack (`::` plus IPv4) where the
   * platform allows it.
   *
   * It used to pass `"0.0.0.0"`, which binds **IPv4 only** — and that is worth
   * a comment because of how it fails. Another process can then hold `::` on
   * the same port quite happily, the OS reports no conflict, and this server
   * starts and logs success. A browser resolving `localhost` prefers `::1`,
   * reaches the *other* process, and the dashboard shows whatever that one
   * answers. Testing with `127.0.0.1` hits the right server and hides it
   * completely. Binding both families turns that silent mix-up into an
   * ordinary `EADDRINUSE` at startup.
   *
   * **Unless `HOST` is set**, which production does: the installer writes
   * `HOST=127.0.0.1` because nginx is the API's only client, and until now
   * nothing read it, so the API listened on every interface with the
   * firewall as its only barrier (SEC-R22).
   */
  const port = Number(config.get("PORT") ?? 3100);
  const host = listenHost(config.get<string>("HOST"));
  if (host) await app.listen(port, host);
  else await app.listen(port);
  logger.log(`IEM CMS API läuft auf ${host ?? "allen Schnittstellen"}, Port ${port}`);
  logger.log(`Erlaubte Herkünfte: ${origins.join(", ")}`);
}

/**
 * Refuses to start on a placeholder or obviously weak signing secret.
 *
 * The failure this prevents is silent: with `.env` copied from the example and
 * never edited, everything works — sign-in, sessions, the lot — while anyone
 * holding the repository can mint a valid token for any account. A warning in
 * a log nobody reads would not stop that, so this throws.
 *
 * In development it downgrades to a warning **only** for a secret that is
 * merely short, never for the shipped placeholder. Getting into the habit of
 * ignoring this message locally is how it ends up ignored in production.
 */
function assertSecretsAreReal(config: ConfigService, logger: Logger): void {
  const secret = config.get<string>("JWT_ACCESS_SECRET") ?? "";
  const production = config.get("NODE_ENV") === "production";

  if (secret.includes("CHANGE-ME")) {
    throw new Error(
      "JWT_ACCESS_SECRET ist noch der Platzhalter aus .env.example. " +
        "Ein echtes Geheimnis erzeugen:\n" +
        `  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`,
    );
  }

  if (secret.length < 32) {
    const message =
      "JWT_ACCESS_SECRET ist kürzer als 32 Zeichen und damit zu schwach für signierte Tokens.";
    if (production) throw new Error(message);
    logger.warn(`${message} In der Produktion verweigert der Server den Start.`);
  }

  if (production && config.get("CORS_ORIGINS")?.includes("localhost")) {
    logger.warn("CORS_ORIGINS enthält localhost, obwohl NODE_ENV=production gesetzt ist.");
  }
}

/**
 * Decides whether `X-Forwarded-For` may be believed.
 *
 * It used to be believed unconditionally: `ClientIp` read the header and took
 * its first entry, with no proxy configured. Any client can send that header, so
 * every IP in the audit log — including the ones on `auth.login_failed` and
 * `auth.refresh_reuse_detected`, which is precisely what the log is read for
 * after an incident — was attacker-chosen. Nothing failed; the values were just
 * fiction.
 *
 * Express already solves this properly, so the fix is to let it: with
 * `trust proxy` set, `req.ip` is the left-most address that is *not* a trusted
 * hop, and with it unset `req.ip` is the socket address and the header is
 * ignored. `ClientIp` now reads `req.ip` alone, which means this one setting
 * decides it for the audit log and the throttler together rather than the two
 * disagreeing.
 *
 * `TRUST_PROXY` takes what Express takes: a hop count (`1` behind one reverse
 * proxy), a comma-separated list of trusted addresses or CIDR ranges, or one of
 * `loopback` / `linklocal` / `uniquelocal`. Unset means "no proxy", which is the
 * right default — believing the header without one is the bug.
 */
function configureProxyTrust(
  app: { getHttpAdapter(): { getInstance(): { set(k: string, v: unknown): void } } },
  config: ConfigService,
  logger: Logger,
): void {
  const raw = (config.get<string>("TRUST_PROXY") ?? "").trim();
  const value = proxyTrustSetting(raw);
  if (value === null) {
    if (config.get("NODE_ENV") === "production") {
      /*
        Not fatal — a deployment without a reverse proxy is legitimate — but
        loud, because behind one it is the failure SEC-R2 describes: every
        request arrives from the proxy's address, every rate limit becomes a
        single bucket for the whole internet, and every IP in the audit log is
        the proxy's. The installer writes `TRUST_PROXY=loopback`.
      */
      logger.warn(
        "TRUST_PROXY ist nicht gesetzt. Hinter einem Reverse Proxy (Nginx) sieht die API " +
          "dann jede Anfrage von dessen Adresse: Ratenbegrenzungen gelten für alle zusammen " +
          "und das Audit-Log enthält keine echten Client-Adressen. Hinter Nginx auf demselben " +
          "Rechner: TRUST_PROXY=loopback.",
      );
    } else {
      logger.log("Kein Proxy konfiguriert — X-Forwarded-For wird ignoriert (korrekt).");
    }
    return;
  }

  app.getHttpAdapter().getInstance().set("trust proxy", value);
  logger.log(`TRUST_PROXY=${raw} — X-Forwarded-For wird ausgewertet.`);
}

/**
 * Refuses to run as one of several workers without Redis.
 *
 * The scheduler's jobs are in-process timers guarded by a Redis lock. Without
 * Redis the lock is a no-op, so every worker would run every job — and
 * scheduled publishing is not idempotent: four workers would produce four
 * snapshots of the site, four database writes apart, with no error anywhere.
 *
 * That failure is invisible until someone looks at the publish history and
 * finds versions 12, 13, 14 and 15 all identical and all one second apart. So
 * it throws at startup instead, where PM2 reports it immediately.
 *
 * PM2 sets `NODE_APP_INSTANCE` per worker in cluster mode; a single process
 * has no such variable and is unaffected.
 */
function assertClusteringIsSafe(config: ConfigService, logger: Logger): void {
  const instance = process.env.NODE_APP_INSTANCE;
  const clustered = instance !== undefined && Number(instance) >= 0;
  const hasRedis = Boolean(config.get("REDIS_URL"));

  if (!clustered) {
    if (!hasRedis) {
      logger.log("Einzelner Prozess ohne Redis — Zeitsteuerung läuft ungesperrt (korrekt).");
    }
    return;
  }

  if (!hasRedis) {
    throw new Error(
      "Der Prozess läuft im Cluster-Modus, aber REDIS_URL ist nicht gesetzt. " +
        "Ohne gemeinsame Sperre führt jeder Worker die Zeitsteuerung aus und " +
        "zeitgesteuerte Veröffentlichungen würden mehrfach ausgeführt. " +
        "Entweder REDIS_URL setzen oder PM2 auf eine Instanz begrenzen.",
    );
  }
  logger.log(`Cluster-Worker ${instance} — Zeitsteuerung über Redis-Sperre koordiniert.`);
}

void bootstrap();
