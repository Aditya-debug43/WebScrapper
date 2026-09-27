import { env } from "./config/env.js";
import { buildApp } from "./app.js";

/**
 * Process entry point. Nothing is wired here — `buildApp` owns composition —
 * so the only concerns left are listening and shutting down cleanly.
 */
/**
 * Composition can fail before there is a logger to report it — a bad
 * database URL, or a mail transport that will not authenticate. Those are
 * configuration mistakes, so they get a plain readable message rather than
 * an unhandled-rejection stack trace.
 */
let built: Awaited<ReturnType<typeof buildApp>>;
try {
  built = await buildApp();
} catch (err) {
  console.error(`\nmulya api failed to start.\n\n${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

/**
 * Railway sends SIGTERM and then waits. Closing Fastify first lets in-flight
 * requests finish before the database handle goes, which is the difference
 * between a rolling deploy and a handful of 502s on every release.
 */
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    built.app.log.info({ signal }, "shutting down");
    try {
      await built.close();
      process.exit(0);
    } catch (err) {
      built.app.log.error({ err }, "failed to shut down cleanly");
      process.exit(1);
    }
  });
}

process.on("unhandledRejection", (reason) => {
  built.app.log.error({ err: reason }, "unhandled rejection");
});

try {
  await built.app.listen({ port: env.PORT, host: env.HOST });
  built.app.log.info(
    { port: env.PORT, driver: env.DB_DRIVER, email: env.EMAIL_ADAPTER, env: env.NODE_ENV },
    "mulya api listening"
  );
} catch (err) {
  built.app.log.error({ err }, "failed to start");
  process.exit(1);
}
