import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { env } from "./config/env.js";
import { createDb, type Db } from "./db/client.js";
import { registerErrorHandling } from "./plugins/errors.js";
import { registerAuth } from "./plugins/auth.js";
import { createEmailAdapter, type EmailAdapter } from "./email/index.js";
import { AuthRepository } from "./modules/auth/auth.repository.js";
import { AuthService } from "./modules/auth/auth.service.js";
import { registerAuthRoutes } from "./modules/auth/auth.routes.js";
import { CatalogueRepository } from "./modules/catalogue/catalogue.repository.js";
import { CatalogueService } from "./modules/catalogue/catalogue.service.js";
import { registerCatalogueRoutes } from "./modules/catalogue/catalogue.routes.js";
import { MarketplaceRepository } from "./modules/marketplace/marketplace.repository.js";
import { MarketplaceService } from "./modules/marketplace/marketplace.service.js";
import { registerMarketplaceRoutes } from "./modules/marketplace/marketplace.routes.js";
import { AnalysisRepository } from "./modules/analysis/analysis.repository.js";
import { CompetitorService } from "./modules/analysis/competitor.service.js";
import { AnalysisService } from "./modules/analysis/analysis.service.js";
import { registerAnalysisRoutes } from "./modules/analysis/analysis.routes.js";
import { PricingRepository } from "./modules/pricing/pricing.repository.js";
import { PricingService } from "./modules/pricing/pricing.service.js";
import { registerPricingRoutes } from "./modules/pricing/pricing.routes.js";
import { IngestionService } from "./ingestion/ingestion.service.js";
import { registerIngestionRoutes } from "./modules/ingestion/ingestion.routes.js";

export type BuiltApp = {
  app: FastifyInstance;
  db: Db;
  email: EmailAdapter;
  close: () => Promise<void>;
};

/**
 * The composition root.
 *
 * Everything is wired here and nowhere else, which is what lets a test build a
 * complete application against an in-memory database and a capturing email
 * adapter with no globals to reset and no network to stub. `server.ts` does
 * nothing but call this and listen.
 */
export async function buildApp(
  overrides: { db?: Db; email?: EmailAdapter; closeDb?: () => Promise<void> } = {}
): Promise<BuiltApp> {
  let closeDb = overrides.closeDb ?? (async () => {});
  let db = overrides.db;
  if (!db) {
    const conn = await createDb();
    db = conn.db;
    closeDb = () => conn.close();
  }

  const email = overrides.email ?? createEmailAdapter();

  /**
   * Prove the mail transport before serving a single request.
   *
   * Only adapters with something to prove implement `verify` — an SMTP one
   * performs the handshake and the AUTH exchange and stops, sending nothing.
   * It costs a few hundred milliseconds once, and it is the difference
   * between finding a wrong app password now and finding it when somebody
   * cannot receive their signup code.
   *
   * Failing startup is the point. An API that boots with a broken mail path
   * accepts registrations it cannot complete, and every one of those users
   * is stranded with an unverified account.
   */
  if (email.verify) {
    try {
      await email.verify();
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`Email transport (${email.name}) failed its startup check.\n\n  ${detail}\n`);
    }
  }

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Credentials must never reach a log sink, where they would outlive the
      // ten-minute window the code itself is bounded by.
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.body.code",
          "req.body.otp",
          "req.body.password",
          "req.body.newPassword",
          "req.body.currentPassword",
          "req.body.passwordHash",
          "req.body.resetToken",
          "res.headers['set-cookie']",
        ],
        censor: "[redacted]",
      },
      serializers: {
        req: (req) => ({ method: req.method, url: req.url, id: req.id }),
      },
    },
    // Trust the proxy Railway puts in front, so `request.ip` is the caller's
    // address rather than the load balancer's — without this every per-IP
    // limit would be shared by the entire internet.
    trustProxy: true,
    /**
     * Fastify's AJV defaults to `removeAdditional: true`, which silently
     * STRIPS unknown properties instead of rejecting them — so
     * `additionalProperties: false` in a schema had no effect and a request
     * carrying a misspelled field was accepted as if it were correct. That
     * hides client bugs, so unknown input is now refused.
     */
    ajv: { customOptions: { removeAdditional: false, coerceTypes: "array", allErrors: true } },
    // Per-request access logs are noise in a test run; the logger itself is
    // already silent there, this just keeps the deprecation surface small.
    disableRequestLogging: env.NODE_ENV === "test",
  });

  registerErrorHandling(app);

  await app.register(cors, {
    origin: (origin, cb) => {
      // Same-origin and non-browser callers (curl, health checks) send no
      // Origin header at all; rejecting those would break monitoring.
      if (!origin) return cb(null, true);
      cb(null, env.CORS_ORIGINS.includes(origin));
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", "authorization"],
    maxAge: 600,
  });

  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW_SECONDS * 1000,
    // Per-IP by default; the auth routes add their own tighter budget, and
    // the auth service adds a per-address one on top, because one attacker
    // with many addresses and many attackers with one address are different
    // problems.
    keyGenerator: (request) => request.ip,
    // No errorResponseBuilder: it replaces the thrown error's shape and the
    // central handler then cannot recognise a 429, which surfaced as a 500.
    // The handler in plugins/errors.ts already renders 429 in the standard
    // envelope, so there is one place that formats errors rather than two.
  });

  const authService = new AuthService(new AuthRepository(db), email);
  registerAuth(app, authService);

  const catalogueService = new CatalogueService(new CatalogueRepository(db));
  const marketplaceService = new MarketplaceService(new MarketplaceRepository(db));

  // One repository, one competitor service, shared by both analysis routes —
  // /competitors and /analysis must never compute a different set.
  const analysisRepository = new AnalysisRepository(db);
  const competitorService = new CompetitorService(analysisRepository);
  const analysisService = new AnalysisService(analysisRepository, competitorService);

  // The recommendation sits ON TOP of the analysis and reuses it wholesale —
  // the same competitor service, the same statistics. There is one
  // definition of competitive evidence in this system.
  const pricingService = new PricingService(
    new PricingRepository(db),
    analysisRepository,
    competitorService,
    analysisService
  );

  // Market data. Holds a MarketOfferProvider chosen by one environment
  // variable; nothing above this line knows which provider that is.
  const ingestionService = new IngestionService(db);

  /**
   * Liveness only. No version, no commit, no database host, no dependency
   * detail — a health endpoint is unauthenticated by necessity and is the
   * cheapest reconnaissance target on any deployment.
   */
  app.get("/health", async () => ({ status: "ok" }));

  await app.register(
    async (v1) => {
      registerAuthRoutes(v1, authService);
      registerCatalogueRoutes(v1, catalogueService);
      registerMarketplaceRoutes(v1, marketplaceService);
      registerAnalysisRoutes(v1, analysisService);
      registerPricingRoutes(v1, pricingService);
      registerIngestionRoutes(v1, ingestionService);
    },
    { prefix: "/api/v1" }
  );

  return {
    app,
    db,
    email,
    close: async () => {
      await app.close();
      await closeDb();
    },
  };
}
