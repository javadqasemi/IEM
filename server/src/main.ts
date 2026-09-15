import "reflect-metadata";
import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { json, urlencoded } from "express";
import { AppModule } from "./app.module";
import { PrismaService } from "./common/prisma.service";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  const logger = new Logger("Bootstrap");

  assertSecretsAreReal(config, logger);
  assertClusteringIsSafe(config, logger);

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
   */
  const port = Number(config.get("PORT") ?? 3100);
  await app.listen(port);
  logger.log(`IEM CMS API läuft auf Port ${port}`);
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
