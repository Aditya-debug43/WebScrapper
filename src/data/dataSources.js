// Provenance — describes the act of observing, not the product. Kept
// separate so a pipeline stays debuggable rather than only rebuildable.

export const captureRuns = [
  {
    id: "run_fk_20260813",
    marketplaceId: "mp_flipkart",
    startedAt: "2026-08-13T03:00:00+05:30",
    finishedAt: "2026-08-13T03:42:00+05:30",
    runStatus: "success",
    parserVersion: "fk-parser-v2.3",
    pagesAttempted: 1,
    pagesSucceeded: 1,
    notes: "Single category page — Smartphones, page 1.",
  },
  {
    id: "run_az_20260813",
    marketplaceId: "mp_amazon_in",
    startedAt: "2026-08-13T03:10:00+05:30",
    finishedAt: "2026-08-13T03:58:00+05:30",
    runStatus: "partial",
    parserVersion: "az-parser-v1.8",
    pagesAttempted: 1,
    pagesSucceeded: 1,
    notes: "2 of 34 rows quarantined — sponsored placements use a different DOM structure.",
  },
  {
    id: "run_fk_20260812",
    marketplaceId: "mp_flipkart",
    startedAt: "2026-08-12T03:00:00+05:30",
    finishedAt: "2026-08-12T03:39:00+05:30",
    runStatus: "success",
    parserVersion: "fk-parser-v2.3",
    pagesAttempted: 1,
    pagesSucceeded: 1,
    notes: "Single category page — Smartphones, page 1.",
  },
  {
    id: "run_az_20260812",
    marketplaceId: "mp_amazon_in",
    startedAt: "2026-08-12T03:10:00+05:30",
    finishedAt: "2026-08-12T03:51:00+05:30",
    runStatus: "success",
    parserVersion: "az-parser-v1.8",
    pagesAttempted: 1,
    pagesSucceeded: 1,
    notes: "Single category page — Smartphones, page 1.",
  },
  {
    id: "run_meesho_20260813",
    marketplaceId: "mp_meesho",
    startedAt: "2026-08-13T03:20:00+05:30",
    finishedAt: "2026-08-13T04:02:00+05:30",
    runStatus: "success",
    parserVersion: "meesho-parser-v1.2",
    pagesAttempted: 2,
    pagesSucceeded: 2,
    notes: "Category pages — Mobile Phones page 1, Earphones page 1.",
  },
  {
    id: "run_meesho_20260812",
    marketplaceId: "mp_meesho",
    startedAt: "2026-08-12T03:20:00+05:30",
    finishedAt: "2026-08-12T04:05:00+05:30",
    runStatus: "partial",
    parserVersion: "meesho-parser-v1.1",
    pagesAttempted: 2,
    pagesSucceeded: 1,
    notes: "Earphones page timed out mid-fetch and was retried the following run.",
  },
];

export const rawDocuments = [
  {
    id: "doc_fk_20260813_p1",
    captureRunId: "run_fk_20260813",
    sourceUrl: "https://www.flipkart.com/mobile-phones-store/smartphones?page=1",
    httpStatus: 200,
    fetchedAt: "2026-08-13T03:04:00+05:30",
    contentHash: "9f3a1c7de0b2f4a6c1e9d5b8a02f77e1",
    storagePath: "/bronze/flipkart/2026-08-13/smartphones_p1.html",
  },
  {
    id: "doc_az_20260813_p1",
    captureRunId: "run_az_20260813",
    sourceUrl: "https://www.amazon.in/s?k=smartphones&page=1",
    httpStatus: 200,
    fetchedAt: "2026-08-13T03:12:00+05:30",
    contentHash: "22b7e0aa41d9c6f083b5e1a7c4029fd3",
    storagePath: "/bronze/amazon/2026-08-13/smartphones_p1.html",
  },
  {
    id: "doc_meesho_20260813_p1",
    captureRunId: "run_meesho_20260813",
    sourceUrl: "https://www.meesho.com/mobile-phones/pl/2ka",
    httpStatus: 200,
    fetchedAt: "2026-08-13T03:24:00+05:30",
    contentHash: "6e19d4b7c2a08f351de6903a4c8e2b17",
    storagePath: "/bronze/meesho/2026-08-13/mobile-phones_p1.html",
  },
];

export const rejectedRecords = [
  {
    id: "rej_1",
    rawDocumentId: "doc_az_20260813_p1",
    targetEntity: "offer",
    rejectionReason: "selling_price > mrp — parsed a sponsored-slot markup, not a genuine listing price",
    capturedAt: "2026-08-13T03:40:00+05:30",
  },
  {
    id: "rej_2",
    rawDocumentId: "doc_az_20260813_p1",
    targetEntity: "listing",
    rejectionReason: "missing external_listing_id — ad redirect URL, not a canonical ASIN page",
    capturedAt: "2026-08-13T03:41:00+05:30",
  },
  {
    id: "rej_3",
    rawDocumentId: "doc_meesho_20260813_p1",
    targetEntity: "offer",
    rejectionReason: "shipping_fee missing — Meesho listings frequently omit a separate shipping line item",
    capturedAt: "2026-08-13T04:00:00+05:30",
  },
];

// Per-field parse coverage, most recent run — the number that catches a
// silent site change before anyone notices the data looks "off".
export const fieldCoverage = [
  { marketplaceId: "mp_flipkart", field: "selling_price", coveragePct: 99.4 },
  { marketplaceId: "mp_flipkart", field: "mrp", coveragePct: 97.1 },
  { marketplaceId: "mp_flipkart", field: "rating", coveragePct: 94.8 },
  { marketplaceId: "mp_flipkart", field: "specifications", coveragePct: 88.2 },
  { marketplaceId: "mp_amazon_in", field: "selling_price", coveragePct: 98.9 },
  { marketplaceId: "mp_amazon_in", field: "mrp", coveragePct: 92.0 },
  { marketplaceId: "mp_amazon_in", field: "rating", coveragePct: 96.3 },
  { marketplaceId: "mp_amazon_in", field: "specifications", coveragePct: 90.5 },
  { marketplaceId: "mp_meesho", field: "selling_price", coveragePct: 97.8 },
  { marketplaceId: "mp_meesho", field: "mrp", coveragePct: 89.5 },
  { marketplaceId: "mp_meesho", field: "rating", coveragePct: 91.2 },
  { marketplaceId: "mp_meesho", field: "specifications", coveragePct: 82.0 },
];

export function getLatestCaptureRun(marketplaceId) {
  return (
    captureRuns
      .filter((r) => r.marketplaceId === marketplaceId)
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0] ?? null
  );
}

export function getCoverageForMarketplace(marketplaceId) {
  return fieldCoverage.filter((f) => f.marketplaceId === marketplaceId);
}
