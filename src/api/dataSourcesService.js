import { mockDelay } from "./client";
import { marketplaces } from "../data/marketplaces";
import {
  captureRuns,
  rawDocuments,
  rejectedRecords,
  getLatestCaptureRun,
  getCoverageForMarketplace,
} from "../data/dataSources";
import { listings } from "../data/listings";

/** GET /api/data-sources — provenance & coverage overview, one row per marketplace. */
export async function getDataSourcesOverview() {
  await mockDelay();
  const perMarketplace = marketplaces.map((mp) => {
    const latestRun = getLatestCaptureRun(mp.id);
    const coverage = getCoverageForMarketplace(mp.id);
    const mpListings = listings.filter((l) => l.marketplaceId === mp.id);
    const avgMatchConfidence =
      mpListings.reduce((s, l) => s + l.matchConfidence, 0) / (mpListings.length || 1);
    const humanConfirmed = mpListings.filter((l) => l.matchStatus === "human_confirmed").length;
    return {
      marketplace: mp,
      latestRun,
      coverage,
      listingCount: mpListings.length,
      avgMatchConfidence,
      humanConfirmed,
    };
  });

  const recentRuns = [...captureRuns].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  const recentRejections = rejectedRecords
    .map((r) => ({ ...r, document: rawDocuments.find((d) => d.id === r.rawDocumentId) }))
    .sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1));

  return { perMarketplace, recentRuns, recentRejections, rawDocuments };
}
