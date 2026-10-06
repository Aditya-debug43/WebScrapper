import "../config/env.js";
import { env } from "../config/env.js";
import { createDb } from "../db/client.js";
import { SnapshotService, FRESHNESS } from "../ingestion/snapshot.service.js";
import { DiscoveryRepository } from "../modules/discovery/discovery.repository.js";
import { CaptureScheduler } from "../modules/discovery/capture.scheduler.js";

/**
 * THE SCHEDULED SWEEP
 * ===================
 *
 * Run hourly by a systemd timer. Captures the market for products that are
 * due, and nothing else.
 *
 *   node dist/scripts/capture-due.js
 *
 * It exits non-zero only if the sweep itself could not run. A provider
 * failure on an individual product is recorded against that product and the
 * sweep continues — one unreachable store must not stop the others, and a
 * non-zero exit would make the timer look broken when it is working.
 */

async function main() {
  const conn = await createDb();
  try {
    const scheduler = new CaptureScheduler(
      new DiscoveryRepository(conn.db),
      new SnapshotService(conn.db),
      conn.db
    );

    const started = Date.now();
    const result = await scheduler.sweep({
      limit: env.CAPTURE_SWEEP_MAX_PRODUCTS,
      maxAgeSeconds: FRESHNESS.scheduled(),
    });

    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `· swept in ${seconds}s — due ${result.due}; captured ${result.captured}; ` +
        `reused ${result.reused}; failed ${result.failed}; observations ${result.observations}; ` +
        `provider calls ${result.providerCalls}`
    );
    for (const note of result.notes) console.log(`  ${note}`);
  } finally {
    await conn.close();
  }
}

main().catch((error) => {
  console.error("sweep failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
