import { mockDelay } from "./client";
import { buildRecommendation } from "../utils/pricingEngine";
import { apiRequest } from "./http";

/**
 * The recommendation, from either source.
 *
 * Phase 6 moved the pricing engine to the backend and proved it computes the
 * same numbers — 77 parity assertions over twelve products chosen to exercise
 * every branch. What has NOT moved is this screen: the backend returns
 * structured factors and deliberately generates no prose, while
 * `RecommendationPanel` renders sentences, drivers, viability notes and
 * sanity checks that the engine composes. Swapping the source would mean
 * redesigning the panel, which is a separate piece of work.
 *
 * So the local engine remains what the page renders and what the backend is
 * measured against, and the backend call below exists so the page can consume
 * it, compare against it, and show whether the two agree. The engine is the
 * oracle until the panel is ready to read structured factors instead.
 */

/** GET /api/products/:id/recommendation — the local engine. The oracle. */
export async function getRecommendation(productId) {
  await mockDelay(180);
  return buildRecommendation(productId);
}

/**
 * GET /api/v1/products/:id/recommendation — the backend.
 *
 * Authenticated, like every other pricing endpoint: a recommendation is the
 * product, not the public marketplace data underneath it. `model` selects the
 * recommendation model and defaults server-side to `baseline-v1`; passing
 * `hedonic-cv-v2` asks for the cross-validated attribute model instead.
 */
export async function getBackendRecommendation(productId, { token, model, marketplace, signal } = {}) {
  const query = new URLSearchParams();
  if (model) query.set("model", model);
  if (marketplace) query.set("marketplace", marketplace);
  const suffix = query.toString() ? `?${query}` : "";
  return apiRequest(`/products/${encodeURIComponent(productId)}/recommendation${suffix}`, { token, signal });
}

/** A field both sources carry, and how to read it from each. */
const COMPARED = [
  ["status", (l) => (l.insufficientData ? "insufficient_evidence" : "recommended"), (b) => b.status],
  ["fast sale", (l) => priceOf(l, "fast_sale"), (b) => backendPrice(b, "fast_sale")],
  ["balanced", (l) => priceOf(l, "balanced"), (b) => backendPrice(b, "balanced")],
  ["premium", (l) => priceOf(l, "premium"), (b) => backendPrice(b, "premium")],
  ["anchor", (l) => l.anchor?.minor ?? null, (b) => b.anchor?.minor ?? null],
  ["floor", (l) => l.constraints?.floorMinor ?? null, (b) => b.floorMinor ?? null],
  ["ceiling", (l) => l.constraints?.ceilingMinor ?? null, (b) => b.ceilingMinor ?? null],
  ["attribute model", (l) => l.wtp?.trusted ?? null, (b) => b.wtp?.trusted ?? null],
  ["evidence level", (l) => l.evidence?.level ?? null, (b) => b.evidence?.level ?? null],
];

const priceOf = (rec, key) => rec.strategies?.find((s) => s.key === key)?.priceMinor ?? null;
const backendPrice = (data, key) => data.strategies?.find((s) => s.key === key)?.priceMinor ?? null;

/**
 * Compare the two sources on the values they both express.
 *
 * Structured fields only, never a rendered sentence: prose can differ by a
 * word and mean the same thing, and can read identically while the number
 * behind it moved. Returns the fields that differ, so "they agree" is
 * something the screen can show rather than something we assert.
 */
export function compareRecommendations(local, backend) {
  if (!local || !backend) return null;
  const differences = [];
  for (const [label, readLocal, readBackend] of COMPARED) {
    const a = readLocal(local) ?? null;
    const b = readBackend(backend) ?? null;
    if (a !== b) differences.push({ field: label, local: a, backend: b });
  }
  return { agrees: differences.length === 0, comparedCount: COMPARED.length, differences };
}
