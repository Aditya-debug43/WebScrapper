import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";

/**
 * The recommendation page's states, now that the price arrives over a network.
 *
 * Phase 7 replaced a function call with a request, which can be slow, fail, or
 * come back refused. The rule that shapes all of it: **never show a price this
 * page did not receive** — no stale result while a new one loads, no locally
 * computed fallback when the request fails.
 *
 * `recommendationService` is mocked here deliberately: the point is the page's
 * handling of each outcome. Whether the service's output matches the engine is
 * `recommendation-presenter.test.js`, and whether the panel renders it is the
 * panel's own concern.
 */

const presented = {
  insufficientData: false,
  strategies: [
    { key: "fast_sale", priceMinor: 50900, label: "Fast Sale", drivers: [], bindingConstraint: null },
    { key: "balanced", priceMinor: 61900, label: "Balanced", drivers: [], bindingConstraint: null },
    { key: "premium", priceMinor: 68900, label: "Premium", drivers: [], bindingConstraint: null },
  ],
};

const mocks = vi.hoisted(() => ({ getRecommendation: vi.fn() }));

vi.mock("../src/api/recommendationService", () => mocks);
vi.mock("../src/components/recommendation/RecommendationPanel", () => ({
  // 716 lines, and not what this file is about.
  default: ({ rec }) => (
    <div data-testid="panel">{rec.insufficientData ? "refused" : `${rec.strategies.length} strategies`}</div>
  ),
}));
vi.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ token: "test-session-token" }) }));

const { default: PricingRecommendation } = await import("../src/pages/PricingRecommendation");

function renderPage(productId = "prod_dove_hair_fall") {
  return render(
    <MemoryRouter initialEntries={[`/p/${productId}/recommendation`]}>
      <Routes>
        <Route path="/p/:id" element={<Outlet context={{ productId }} />}>
          <Route path="recommendation" element={<PricingRecommendation />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

const apiError = (code, message) => Object.assign(new Error(message), { name: "ApiError", code });

/**
 * Each test installs its own implementation; this clears the call history and
 * puts a benign default back.
 *
 * Deliberately not `mockReset()`, which left vitest reporting the handled
 * rejections below as unhandled — the page catches every one of them, as the
 * rendered error states here show.
 */
beforeEach(() => {
  mocks.getRecommendation.mockClear();
  mocks.getRecommendation.mockImplementation(async () => presented);
});

describe("the recommendation page consumes the backend", () => {
  it("asks the backend for the product in context, with the session token", async () => {
    mocks.getRecommendation.mockResolvedValue(presented);
    renderPage("prod_oneplus_buds3");

    await waitFor(() => expect(screen.getByTestId("panel")).toBeInTheDocument());
    expect(mocks.getRecommendation).toHaveBeenCalledTimes(1);
    const [productId, options] = mocks.getRecommendation.mock.calls[0];
    expect(productId).toBe("prod_oneplus_buds3");
    expect(options.token).toBe("test-session-token");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("renders what the backend returned", async () => {
    mocks.getRecommendation.mockResolvedValue(presented);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("panel")).toHaveTextContent("3 strategies"));
  });

  it("shows a loading state and no price while the request is in flight", async () => {
    let settle;
    mocks.getRecommendation.mockReturnValue(new Promise((resolve) => (settle = resolve)));
    renderPage();

    expect(screen.getByText(/Building recommendation/i)).toBeInTheDocument();
    expect(screen.queryByTestId("panel")).toBeNull();

    settle(presented);
    await waitFor(() => expect(screen.getByTestId("panel")).toBeInTheDocument());
  });

  it("renders a refusal as a refusal, and invents nothing", async () => {
    mocks.getRecommendation.mockResolvedValue({
      insufficientData: true,
      reason: "Only 1 comparable product could be established for this product.",
      whatWouldHelp: [],
      strategies: [],
    });
    renderPage("prod_airpods_pro2");
    await waitFor(() => expect(screen.getByTestId("panel")).toHaveTextContent("refused"));
  });

  it("shows an error state on network failure, with no price", async () => {
    mocks.getRecommendation.mockImplementation(async () => { throw apiError("NETWORK_ERROR", "Could not reach the server."); });
    renderPage();

    await waitFor(() => expect(screen.getByText(/Could not reach the pricing service/i)).toBeInTheDocument());
    expect(screen.queryByTestId("panel")).toBeNull();
    expect(screen.getByText(/No price is shown because none was received/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try again/i })).toBeInTheDocument();
  });

  it("retries on request, and renders the result", async () => {
    mocks.getRecommendation
      .mockImplementationOnce(async () => {
        throw apiError("NETWORK_ERROR", "Could not reach the server.");
      })
      .mockResolvedValueOnce(presented);
    renderPage();

    const button = await screen.findByRole("button", { name: /Try again/i });
    button.click();

    await waitFor(() => expect(screen.getByTestId("panel")).toHaveTextContent("3 strategies"));
    expect(mocks.getRecommendation).toHaveBeenCalledTimes(2);
  });

  it("treats a missing product as permanent and offers no retry", async () => {
    mocks.getRecommendation.mockImplementation(async () => { throw apiError("NOT_FOUND", "No product with id prod_nope."); });
    renderPage("prod_nope");

    await waitFor(() => expect(screen.getByText(/could not be found/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Try again/i })).toBeNull();
  });

  it("fails safely on a malformed response rather than guessing", async () => {
    // What the service throws when the envelope is not a recommendation.
    mocks.getRecommendation.mockImplementation(async () => { throw new Error("The recommendation service returned a response without a status."); });
    renderPage();

    await waitFor(() => expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument());
    expect(screen.queryByTestId("panel")).toBeNull();
  });

  it("never leaves a previous product's price on screen", async () => {
    /**
     * The failure this guards against is the worst kind on this page: a price
     * that is real, confident, and about a different product.
     */
    let settleSecond;
    mocks.getRecommendation
      .mockResolvedValueOnce(presented)
      .mockReturnValueOnce(new Promise((resolve) => (settleSecond = resolve)));

    const { rerender } = renderPage("prod_a");
    await waitFor(() => expect(screen.getByTestId("panel")).toBeInTheDocument());

    rerender(
      <MemoryRouter initialEntries={["/p/prod_b/recommendation"]}>
        <Routes>
          <Route path="/p/:id" element={<Outlet context={{ productId: "prod_b" }} />}>
            <Route path="recommendation" element={<PricingRecommendation />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.queryByTestId("panel")).toBeNull());
    expect(screen.getByText(/Building recommendation/i)).toBeInTheDocument();

    settleSecond({ ...presented, strategies: presented.strategies.slice(0, 2) });
    await waitFor(() => expect(screen.getByTestId("panel")).toHaveTextContent("2 strategies"));
  });
});
