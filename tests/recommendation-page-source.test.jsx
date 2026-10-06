import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * THE RECOMMENDATION PAGE SHOWS ONLY WHAT IT WAS GIVEN
 * ====================================================
 *
 * These assertions survived the move from the catalogue-comparable engine to
 * market-evidence pricing, because they were never about where the number
 * came from — they are about the page never producing one of its own.
 *
 * The standing rule: a price on this screen is the backend's answer, or
 * there is no price. Not a stale one from the previous product, not one left
 * behind while a new request is in flight, not a locally computed stand-in
 * when the request fails.
 *
 * What DID change: the page now calls `getMarketRecommendation`, which works
 * for a product with no history at all, and reports which evidence mode and
 * which method produced the figure. A refusal is now a structured
 * `available: false` rather than a thrown error, so it gets its own case.
 */

const mocks = vi.hoisted(() => ({ getMarketRecommendation: vi.fn() }));

vi.mock("../src/api/discoveryService", () => mocks);
vi.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ token: "test-session-token" }) }));

let outletProductId = "prod_target";
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useOutletContext: () => ({ productId: outletProductId }) };
});

const { default: PricingRecommendation } = await import("../src/pages/PricingRecommendation");

/**
 * The headline figure specifically.
 *
 * When the method is deterministic the same number also appears under
 * "Statistical position", so a plain text query matches twice. The headline
 * is the one these assertions are about.
 */
const headline = (container) => container.querySelector(".pr-price")?.textContent ?? "";

/** A complete cold-start answer, as the backend shapes it. */
const coldStart = {
  productId: "prod_target",
  available: true,
  mode: "cold_start",
  recommendedPriceMinor: 7_849_000,
  rangeMinMinor: 7_700_000,
  rangeMaxMinor: 8_000_000,
  confidence: "medium",
  method: "deterministic",
  deterministic: { recommendedMinor: 7_849_000, rangeMinMinor: 7_700_000, rangeMaxMinor: 8_000_000, confidence: "medium", factors: ["Market median 80,000.00 across 5 offers."] },
  ai: null,
  aiError: null,
  market: {
    capturedAt: "2026-10-06T09:00:00.000Z",
    reused: false,
    offerCount: 5,
    marketplaceCount: 4,
    minMinor: 7_700_000,
    maxMinor: 8_200_000,
    medianMinor: 8_000_000,
    q1Minor: 7_800_000,
    q3Minor: 8_100_000,
  },
  history: null,
  warnings: ["No price history yet. This is positioned against the current market alone."],
};

const apiError = (code, message) => Object.assign(new Error(message), { name: "ApiError", code });

beforeEach(() => {
  outletProductId = "prod_target";
  mocks.getMarketRecommendation.mockReset();
  mocks.getMarketRecommendation.mockResolvedValue(coldStart);
});

describe("the recommendation page consumes the backend", () => {
  it("asks the backend for the product in context, with the session token", async () => {
    render(<PricingRecommendation />);

    await waitFor(() => expect(mocks.getMarketRecommendation).toHaveBeenCalledTimes(1));
    const [productId, options] = mocks.getMarketRecommendation.mock.calls[0];
    expect(productId).toBe("prod_target");
    expect(options.token).toBe("test-session-token");
  });

  it("renders what the backend returned", async () => {
    const { container } = render(<PricingRecommendation />);
    await waitFor(() => expect(headline(container)).toMatch(/78,490/));
  });

  /** A product tracked minutes ago still gets an answer, and says so. */
  it("reports cold start as cold start rather than refusing", async () => {
    render(<PricingRecommendation />);
    expect(await screen.findByText(/cold start/i)).toBeInTheDocument();
    expect(screen.getByText(/no observations yet/i)).toBeInTheDocument();
  });

  it("shows a loading state and no price while the request is in flight", async () => {
    let settle;
    mocks.getMarketRecommendation.mockReturnValue(new Promise((resolve) => (settle = resolve)));

    const { container } = render(<PricingRecommendation />);
    expect(headline(container)).toBe("");

    settle(coldStart);
    await waitFor(() => expect(headline(container)).toMatch(/78,490/));
  });

  /**
   * A refusal arrives as data, not as an error — and must still produce no
   * number anywhere on the page.
   */
  it("renders a refusal as a refusal, and invents nothing", async () => {
    mocks.getMarketRecommendation.mockResolvedValue({
      productId: "prod_target",
      available: false,
      mode: "cold_start",
      reason: "insufficient_market_evidence",
      message: "Only 1 usable offer was found; at least 3 are needed.",
      evidence: { usableOffers: 1, marketplaces: 1, historyObservations: 0, capturedAt: null },
    });

    render(<PricingRecommendation />);
    expect(await screen.findByText(/insufficient real market evidence/i)).toBeInTheDocument();
    expect(screen.getByText(/at least 3 are needed/i)).toBeInTheDocument();
    expect(screen.queryByText(/78,490/)).not.toBeInTheDocument();
  });

  it("shows an error state on network failure, with no price", async () => {
    mocks.getMarketRecommendation.mockRejectedValue(apiError("NETWORK_ERROR", "Could not reach the server."));

    render(<PricingRecommendation />);
    expect(await screen.findByText(/could not reach the server/i)).toBeInTheDocument();
    expect(screen.queryByText(/78,490/)).not.toBeInTheDocument();
  });

  it("retries on request, and renders the result", async () => {
    mocks.getMarketRecommendation
      .mockRejectedValueOnce(apiError("NETWORK_ERROR", "Could not reach the server."))
      .mockResolvedValueOnce(coldStart);

    const { container } = render(<PricingRecommendation />);
    await screen.findByText(/could not reach the server/i);

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(headline(container)).toMatch(/78,490/));
    expect(mocks.getMarketRecommendation).toHaveBeenCalledTimes(2);
  });

  /**
   * THE BUG THIS EXISTS FOR: a price from the previously-viewed product
   * surviving on screen while the next one loads would be read as the new
   * product's price.
   */
  it("never leaves a previous product's price on screen", async () => {
    const { container, rerender } = render(<PricingRecommendation />);
    await waitFor(() => expect(headline(container)).toMatch(/78,490/));

    outletProductId = "prod_other";
    let settle;
    mocks.getMarketRecommendation.mockReturnValue(new Promise((resolve) => (settle = resolve)));
    rerender(<PricingRecommendation />);

    await waitFor(() => expect(headline(container)).not.toMatch(/78,490/));
    settle({ ...coldStart, productId: "prod_other", recommendedPriceMinor: 1_234_500 });
    await waitFor(() => expect(headline(container)).toMatch(/12,345/));
  });

  /**
   * An AI failure must leave the deterministic figure visible and LABELLED,
   * never presented as a model's judgement.
   */
  it("labels a deterministic fallback as deterministic", async () => {
    mocks.getMarketRecommendation.mockResolvedValue({
      ...coldStart,
      method: "deterministic",
      aiError: "unavailable: model is down",
      warnings: [...coldStart.warnings, "The AI provider did not answer (unavailable: model is down); this is the deterministic figure."],
    });

    render(<PricingRecommendation />);
    expect((await screen.findAllByText(/deterministic/i)).length).toBeGreaterThan(0);
    expect(screen.getByText(/did not answer/i)).toBeInTheDocument();
  });
});
