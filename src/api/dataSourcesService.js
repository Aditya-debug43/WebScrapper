import { apiRequest } from "./http";

/**
 * DATA SOURCES & COVERAGE, FROM THE BACKEND.
 *
 * This screen says whether the rest of the app can be trusted, so it was the
 * worst possible place for the old arrangement: it described a bundled
 * six-item array of marketplaces and a bundled list of capture runs. That
 * made two failures impossible to see. A platform that had never been
 * captured still looked captured, because the array said it existed; and a
 * platform the system had genuinely learned about from a provider did not
 * appear at all, because the array did not mention it.
 *
 * Everything here now comes from `capture_runs`, `raw_documents`,
 * `rejected_records`, `field_coverage` and `marketplaces` — the rows the
 * ingestion layer actually wrote. If a source has never run, this page says
 * so.
 *
 * There is NO fallback. A failed request surfaces as an error, because a
 * provenance screen that quietly substitutes made-up provenance when the
 * backend is unreachable is worse than no provenance screen at all.
 */

/**
 * @param {object}  [options]
 * @param {string}  [options.token]           Session token; the endpoint is authenticated.
 * @param {number}  [options.runLimit]        How many recent capture runs to return.
 * @param {number}  [options.rejectionLimit]  How many quarantined rows to return.
 * @param {AbortSignal} [options.signal]
 */
export async function getDataSourcesOverview({ token, runLimit, rejectionLimit, signal } = {}) {
  const params = new URLSearchParams();
  if (runLimit != null) params.set("runLimit", String(runLimit));
  if (rejectionLimit != null) params.set("rejectionLimit", String(rejectionLimit));
  const query = params.toString();

  const body = await apiRequest(`/sources${query ? `?${query}` : ""}`, { token, signal });
  return body?.data ?? body;
}
