import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * THE COMPETITIVE MARKET PAGE SHOWS THE MARKET IT WAS GIVEN
 * =========================================================
 *
 * The standing rule for every screen in this application: a figure here is
 * the backend's answer, or there is no figure. This page is the one most
 * tempted to break it, because it holds a distribution and a distribution is
 * easy to recompute client-side — which is precisely how two
 * implementations of the same statistic end up disagreeing on screen.
 *
 * So these assertions are about three things:
 *
 *   WHAT IS SHOWN is what the response contained, including the seller count
 *   beside every statistic derived from it.
 *
 *   A THIN MARKET IS LABELLED as thin rather than presented as a market.
 *
 *   ABSENT IS ABSENT. An unstated shipping cost renders as a dash, never as
 *   "free", because the two are different facts about a seller's offer.
 */

const mocks = vi.hoisted(() => ({ getProductMarket: vi.fn(), captureMarket: vi.fn() }));

vi.mock("../src/api/discoveryService", () => mocks);
vi.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ token: "test-session-token" }) }));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useOutletContext: () => ({ productId: "prod_target" }) };
});

const { default: CompetitiveMarket } = await import("../src/pages/CompetitiveMarket");

const seller = (name, priceMinor, extra = {}) => ({
  sellerId: `slr_${name}`,
  sellerName: name,
  marketplaceId: `mp_${name}`,
  marketplaceName: name,
  priceMinor,
  landedMinor: priceMinor,
  shippingMinor: 0,
  inStock: true,
  rating: 4.2,
  reviewCount: 100,
  url: `https://${name}.test/p`,
  condition: "new",
  ...extra,
});

/** A market of five sellers, as the backend returns one. */
function marketResponse(overrides = {}) {
  const sellers = overrides.sellers ?? [
    seller("Excess2Sell", 2_455_000),
    seller("TataCliq", 2_649_000),
    seller("Variety", 2_699_000),
    seller("Amazon", 2_876_500),
    seller("myG", 3_199_000),
  ];

  return {
    product: {
      id: "prod_target",
      name: "Sony WH-1000XM5",
      externalProductId: "cat_1",
      origin: "live",
      specifications: { brand: "Sony" },
      trackerCount: 3,
      lastCapturedAt: "2026-10-07T09:00:00.000Z",
      catalogIdCount: 4,
    },
    sufficient: true,
    distribution: {
      sellerCount: sellers.length,
      marketplaceCount: sellers.length,
      inStockCount: sellers.filter((s) => s.inStock).length,
      lowMinor: 2_455_000,
      p25Minor: 2_649_000,
      medianMinor: 2_699_000,
      p75Minor: 2_876_500,
      highMinor: 3_199_000,
      meanMinor: 2_775_700,
      spreadPct: 27.6,
    },
    structure: {
      floorMinor: 2_455_000,
      secondFloorMinor: 2_649_000,
      floorGapMinor: 194_000,
      atFloorCount: 1,
      clustering: 0.4,
      cheapest: { sellerName: "Excess2Sell", marketplaceName: "Excess2Sell", priceMinor: 2_455_000 },
      dearest: { sellerName: "myG", marketplaceName: "myG", priceMinor: 3_199_000 },
    },
    position: null,
    sellers,
    marketplaces: sellers.map((s) => ({
      marketplaceId: s.marketplaceId,
      marketplaceName: s.marketplaceName,
      sellers: 1,
      lowMinor: s.priceMinor,
    })),
    history: { points: [], trend: null, note: "Only one capture so far, so there is no trend yet." },
    condition: "new",
    otherConditions: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the competitive market page", () => {
  it("shows every seller the backend returned", async () => {
    mocks.getProductMarket.mockResolvedValue(marketResponse());
    render(<CompetitiveMarket />);

    await waitFor(() => expect(screen.getByText("Every seller")).toBeInTheDocument());

    for (const name of ["Excess2Sell", "TataCliq", "Variety", "Amazon", "myG"]) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    }
  });

  /**
   * The qualifier that stops a statistic being over-read. A median over five
   * sellers and one over twenty are different claims and the page must not
   * let a reader assume the stronger one.
   */
  it("states the seller count beside the statistics drawn from it", async () => {
    mocks.getProductMarket.mockResolvedValue(marketResponse());
    const { container } = render(<CompetitiveMarket />);

    await waitFor(() => expect(screen.getByText(/Competing sellers/)).toBeInTheDocument());
    expect(screen.getByText("over 5 sellers")).toBeInTheDocument();
    expect(container.textContent).toContain("from 4 catalogue listings");
  });

  it("describes the floor rather than only stating it", async () => {
    mocks.getProductMarket.mockResolvedValue(marketResponse());
    render(<CompetitiveMarket />);

    await waitFor(() => expect(screen.getByText("Price floor")).toBeInTheDocument());
    expect(screen.getByText("Sellers at that price")).toBeInTheDocument();
    expect(screen.getByText("Gap to the next seller")).toBeInTheDocument();
    // A gap of 194,000 on a floor of 2,455,000 is 7.9% — under the 8% bar.
    expect(screen.getByText(/Narrow — the cheapest price is roughly/)).toBeInTheDocument();
  });

  it("calls a crowded floor contested", async () => {
    mocks.getProductMarket.mockResolvedValue(
      marketResponse({
        structure: {
          ...marketResponse().structure,
          atFloorCount: 4,
          floorGapMinor: 1_000,
          secondFloorMinor: 2_456_000,
        },
      })
    );
    render(<CompetitiveMarket />);

    await waitFor(() => expect(screen.getByText(/A contested floor/)).toBeInTheDocument());
  });

  /** Two sellers is the truth about the product, and it is labelled as thin. */
  it("labels a thin market instead of presenting it as a market", async () => {
    const thin = [seller("Only Shop", 2_455_000), seller("Other Shop", 2_600_000)];
    mocks.getProductMarket.mockResolvedValue(
      marketResponse({
        sellers: thin,
        sufficient: false,
        distribution: { ...marketResponse().distribution, sellerCount: 2, marketplaceCount: 2 },
        marketplaces: thin.map((s) => ({
          marketplaceId: s.marketplaceId,
          marketplaceName: s.marketplaceName,
          sellers: 1,
          lowMinor: s.priceMinor,
        })),
      })
    );
    render(<CompetitiveMarket />);

    await waitFor(() =>
      expect(screen.getByText(/too thin to position a price against/)).toBeInTheDocument()
    );
    // And the sellers are still shown — the market is not hidden.
    expect(screen.getAllByText("Only Shop").length).toBeGreaterThan(0);
  });

  it("renders an unstated shipping cost as absent, never as free", async () => {
    mocks.getProductMarket.mockResolvedValue(
      marketResponse({
        sellers: [
          seller("Stated Free", 2_455_000, { shippingMinor: 0 }),
          seller("Stated Cost", 2_649_000, { shippingMinor: 24_000, landedMinor: 2_673_000 }),
          seller("Unstated", 2_699_000, { shippingMinor: null }),
        ],
      })
    );
    const { container } = render(<CompetitiveMarket />);

    await waitFor(() => expect(screen.getByText("Every seller")).toBeInTheDocument());

    const rowFor = (name) =>
      [...container.querySelectorAll(".cm-table tbody tr")].find((tr) => tr.textContent.includes(name));

    expect(within(rowFor("Stated Free")).getByText("free")).toBeInTheDocument();
    expect(within(rowFor("Unstated")).getByText("—")).toBeInTheDocument();
    expect(rowFor("Unstated").textContent).not.toContain("free");
  });

  /**
   * The provider supplies no past prices, so a single capture is a single
   * point. Drawing a trend through it would be manufacturing the thing this
   * whole pipeline exists to avoid.
   */
  it("claims no trend from one capture", async () => {
    mocks.getProductMarket.mockResolvedValue(marketResponse());
    render(<CompetitiveMarket />);

    await waitFor(() => expect(screen.getByText("This market over time")).toBeInTheDocument());
    expect(screen.getByText(/Only one capture so far/)).toBeInTheDocument();
    expect(screen.queryByText("Direction")).not.toBeInTheDocument();
  });

  it("flags a trend computed over a changed seller population", async () => {
    mocks.getProductMarket.mockResolvedValue(
      marketResponse({
        history: {
          points: [
            { capturedOn: "2026-10-01", medianMinor: 2_700_000, sellerCount: 12 },
            { capturedOn: "2026-10-05", medianMinor: 3_300_000, sellerCount: 3 },
          ],
          trend: {
            direction: "rising",
            changePct: 22.22,
            spanDays: 4,
            points: 2,
            minSellerCount: 3,
            maxSellerCount: 12,
            comparable: false,
          },
          note: null,
        },
      })
    );
    render(<CompetitiveMarket />);

    await waitFor(() => expect(screen.getByText("Direction")).toBeInTheDocument());
    expect(screen.getByText(/describes who was counted rather than what was charged/)).toBeInTheDocument();
    expect(screen.getByText("3–12")).toBeInTheDocument();
  });

  /** Positioning arithmetic belongs to the backend, so the page asks it. */
  it("asks the backend where a typed price would land", async () => {
    mocks.getProductMarket.mockResolvedValue(marketResponse());
    render(<CompetitiveMarket />);

    await waitFor(() => expect(screen.getByText("If you listed at…")).toBeInTheDocument());
    expect(screen.getByText(/Type a price to see where/)).toBeInTheDocument();

    mocks.getProductMarket.mockResolvedValue(
      marketResponse({
        position: { rank: 3, of: 6, undercuts: 3, percentile: 40, premiumOverLowPct: 8.5, vsMedianPct: -1.3 },
      })
    );

    await userEvent.type(screen.getByLabelText("Your price"), "26630");

    await waitFor(() =>
      expect(mocks.getProductMarket).toHaveBeenCalledWith(
        "prod_target",
        expect.objectContaining({ yourPrice: 26630 })
      )
    );
    await waitFor(() => expect(screen.getByText("3 of 6")).toBeInTheDocument());
    expect(screen.getByText("Sellers you undercut")).toBeInTheDocument();
  });

  it("offers to read the market when nothing is stored", async () => {
    mocks.getProductMarket.mockResolvedValue(
      marketResponse({ sellers: [], distribution: null, structure: null, marketplaces: [], sufficient: false })
    );
    mocks.captureMarket.mockResolvedValue({
      sellers: 7,
      marketplaces: 5,
      observations: 7,
      catalogIds: [{}, {}, {}, {}],
      providerCalls: 4,
    });

    render(<CompetitiveMarket />);

    await waitFor(() => expect(screen.getByText("No competing sellers stored yet")).toBeInTheDocument());
    // No figure of any kind is offered in place of the missing market.
    expect(screen.queryByText("Median")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Read this product's market/ }));

    /** The cost is reported where it was incurred, not only in a total. */
    await waitFor(() => expect(screen.getByText(/4 provider call\(s\)/)).toBeInTheDocument());
    expect(screen.getByText(/7 seller\(s\) across 5 marketplace\(s\)/)).toBeInTheDocument();
  });

  /**
   * Condition is a partition, not a filter, so the page must show what was
   * set aside. Pooling a refurbished unit with new stock once put a
   * product's floor at the refurbished price; excluding them silently would
   * replace that error with a quieter one.
   */
  it("shows the condition markets excluded from the comparison", async () => {
    mocks.getProductMarket.mockResolvedValue(
      marketResponse({
        condition: "new",
        otherConditions: [
          { condition: "renewed", sellerCount: 1, lowMinor: 8_999_900, medianMinor: 8_999_900, highMinor: 8_999_900 },
          { condition: "used", sellerCount: 2, lowMinor: 10_839_900, medianMinor: 11_000_000, highMinor: 11_200_000 },
        ],
      })
    );
    render(<CompetitiveMarket />);

    await waitFor(() => expect(screen.getByText("Not counted as competition")).toBeInTheDocument());
    expect(screen.getByText("renewed")).toBeInTheDocument();
    expect(screen.getByText("used")).toBeInTheDocument();
    expect(screen.getByText(/A new listing does not compete with them/)).toBeInTheDocument();
    // And the headline count is labelled with the condition it describes.
    expect(screen.getByText("Competing sellers · new")).toBeInTheDocument();
  });

  it("says nothing about other conditions when there are none", async () => {
    mocks.getProductMarket.mockResolvedValue(marketResponse());
    render(<CompetitiveMarket />);

    await waitFor(() => expect(screen.getByText("Every seller")).toBeInTheDocument());
    expect(screen.queryByText("Not counted as competition")).not.toBeInTheDocument();
  });

  it("surfaces a failed read rather than showing a stale market as current", async () => {
    mocks.getProductMarket.mockRejectedValue(new Error("the provider is out of quota"));
    render(<CompetitiveMarket />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByText("the provider is out of quota")).toBeInTheDocument();
  });
});
