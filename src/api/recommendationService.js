import { mockDelay } from "./client";
import { buildRecommendation } from "../utils/pricingEngine";

/** GET /api/products/:id/recommendation */
export async function getRecommendation(productId) {
  await mockDelay(180);
  return buildRecommendation(productId);
}
