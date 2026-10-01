import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";

/**
 * The backend-source strip on the recommendation page.
 *
 * It is small, it is additive, and it is the one place a reader learns whether
 * the number above it was corroborated by the backend — so its three states
 * need to actually render. A broken strip would take the whole page down,
 * which is a poor trade for a provenance line.
 *
 * `recommendationService` is mocked here, deliberately: the point is the
 * page's handling of each outcome, not the engine (covered by
 * `recommendation-parity-bridge.test.js`) or the HTTP client.
 */

const engineRec = {
  insufficientData: false,
  strategies: [
    { key: "fast_sale", priceMinor: 50900, label: "Fast Sale", drivers: [], bindingConstraint: null },
    { key: "balanced", priceMinor: 61900, label: "Balanced", drivers: [], bindingConstraint: null },
    { key: "premium", priceMinor: 68900, label: "Premium", drivers: [], bindingConstraint: null },
  ],
};

const mocks = vi.hoisted(() => ({
  getRecommendation: vi.fn(),
  getBackendRecommendation: vi.fn(),
  compareRecommendations: vi.fn(),
}));

vi.mock("../src/api/recommendationService", () => mocks);
vi.mock("../src/components/recommendation/RecommendationPanel", () => ({
  // The panel itself is 716 lines and is not what this file is about.
  default: ({ rec }) => <div data-testid="panel">{rec.strategies.length} strategies</div>,
}));
vi.mock("../src/state/AuthContext", () => ({
  useAuth: () => ({ token: "test-session-token" }),
}));

const { default: PricingRecommendation } = await import("../src/pages/PricingRecommendation");

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/p/prod_dove_hair_fall/recommendation"]}>
      <Routes>
        <Route path="/p/:id" element={<Outlet context={{ productId: "prod_dove_hair_fall" }} />}>
          <Route path="recommendation" element={<PricingRecommendation />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  mocks.getRecommendation.mockResolvedValue(engineRec);
  mocks.getBackendRecommendation.mockReset();
  mocks.compareRecommendations.mockReset();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("the recommendation page's backend source strip", () => {
  it("says so when the backend agrees", async () => {
    mocks.getBackendRecommendation.mockResolvedValue({ data: {}, meta: { modelVersion: "baseline-v1" } });
    mocks.compareRecommendations.mockReturnValue({ agrees: true, comparedCount: 9, differences: [] });

    renderPage();
    await waitFor(() => expect(screen.getByTestId("panel")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/agrees with the in-app engine/i)).toBeInTheDocument());
    expect(screen.getByText("baseline-v1")).toBeInTheDocument();
    expect(screen.getByText(/all 9 compared values/i)).toBeInTheDocument();
  });

  it("names the fields when the backend disagrees", async () => {
    mocks.getBackendRecommendation.mockResolvedValue({ data: {}, meta: { modelVersion: "hedonic-cv-v2" } });
    mocks.compareRecommendations.mockReturnValue({
      agrees: false,
      comparedCount: 9,
      differences: [{ field: "balanced", local: 61900, backend: 62900 }],
    });

    renderPage();
    await waitFor(() => expect(screen.getByText(/differs on/i)).toBeInTheDocument());
    expect(screen.getByText(/balanced \(61900 vs 62900\)/)).toBeInTheDocument();
  });

  it("keeps rendering the recommendation when the backend is unreachable", async () => {
    /**
     * The invariant that matters most: the panel is rendered from the engine
     * and must not depend on the API. A dead backend degrades the strip, not
     * the page.
     */
    mocks.getBackendRecommendation.mockRejectedValue(new Error("Could not reach the server."));

    renderPage();
    await waitFor(() => expect(screen.getByTestId("panel")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/could not be reached/i)).toBeInTheDocument());
    expect(screen.getByText(/Showing the in-app engine/i)).toBeInTheDocument();
    expect(screen.getByTestId("panel")).toHaveTextContent("3 strategies");
  });

  it("shows nothing at all while the backend call is in flight", async () => {
    let settle;
    mocks.getBackendRecommendation.mockReturnValue(new Promise((resolve) => (settle = resolve)));

    renderPage();
    await waitFor(() => expect(screen.getByTestId("panel")).toBeInTheDocument());
    // No half-written provenance claim while the answer is unknown.
    expect(screen.queryByText(/agrees|differs|could not be reached/i)).toBeNull();

    settle({ data: {}, meta: { modelVersion: "baseline-v1" } });
    mocks.compareRecommendations.mockReturnValue({ agrees: true, comparedCount: 9, differences: [] });
    await waitFor(() => expect(screen.getByText(/agrees with the in-app engine/i)).toBeInTheDocument());
  });
});
