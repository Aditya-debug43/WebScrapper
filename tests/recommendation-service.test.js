import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The recommendation service — what it asks for, and what it refuses to do.
 *
 * Three properties matter here and none of them is visible from the screen:
 * the request carries the session, it does NOT pin a model version, and a
 * response that is not a recommendation is rejected rather than presented.
 */

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn(), presentRecommendation: vi.fn() }));
vi.mock("../src/api/http", () => ({ apiRequest: mocks.apiRequest }));
vi.mock("../src/utils/recommendationPresenter", () => ({ presentRecommendation: mocks.presentRecommendation }));

const { getRecommendation } = await import("../src/api/recommendationService");

const envelope = { data: { status: "recommended" }, meta: { modelVersion: "baseline-v1" } };

beforeEach(() => {
  mocks.apiRequest.mockClear();
  mocks.presentRecommendation.mockClear();
  mocks.apiRequest.mockImplementation(async () => envelope);
  mocks.presentRecommendation.mockImplementation(() => ({ presented: true }));
});

describe("the recommendation request", () => {
  it("asks the recommendation endpoint for the product, with the session token", async () => {
    await getRecommendation("prod_dove_hair_fall", { token: "session-token" });

    expect(mocks.apiRequest).toHaveBeenCalledTimes(1);
    const [path, options] = mocks.apiRequest.mock.calls[0];
    expect(path).toBe("/products/prod_dove_hair_fall/recommendation");
    expect(options.token).toBe("session-token");
  });

  it("does NOT pin a model version, so the server's default decides", async () => {
    /**
     * Phase 6 made `baseline-v1` the default and `hedonic-cv-v2` opt-in.
     * Hard-coding either here would mean a backend decision needed a frontend
     * release to take effect — and would quietly make the browser the thing
     * that chooses a pricing model.
     */
    await getRecommendation("prod_dove_hair_fall", { token: "t" });
    const [path] = mocks.apiRequest.mock.calls[0];
    expect(path).not.toContain("model=");
    expect(path).not.toContain("baseline-v1");
    expect(path).not.toContain("hedonic-cv-v2");
  });

  it("passes a model only when one is explicitly asked for", async () => {
    await getRecommendation("prod_x", { token: "t", model: "hedonic-cv-v2" });
    expect(mocks.apiRequest.mock.calls[0][0]).toBe("/products/prod_x/recommendation?model=hedonic-cv-v2");
  });

  it("encodes the product id rather than interpolating it raw", async () => {
    await getRecommendation("prod a/b?c", { token: "t" });
    expect(mocks.apiRequest.mock.calls[0][0]).toBe("/products/prod%20a%2Fb%3Fc/recommendation");
  });

  it("presents what the API returned, and returns the presentation", async () => {
    const result = await getRecommendation("prod_x", { token: "t" });
    expect(mocks.presentRecommendation).toHaveBeenCalledWith(envelope);
    expect(result).toEqual({ presented: true });
  });

  it("rejects a response that is not a recommendation rather than presenting half of one", async () => {
    for (const bad of [null, {}, { data: {} }, { data: { strategies: [] } }]) {
      mocks.apiRequest.mockImplementationOnce(async () => bad);
      await expect(getRecommendation("prod_x", { token: "t" })).rejects.toThrow(/without a status/i);
    }
    expect(mocks.presentRecommendation).not.toHaveBeenCalled();
  });

  it("lets an API failure through untouched, so the page can branch on its code", async () => {
    const failure = Object.assign(new Error("Could not reach the server."), { name: "ApiError", code: "NETWORK_ERROR" });
    mocks.apiRequest.mockImplementation(async () => {
      throw failure;
    });
    await expect(getRecommendation("prod_x", { token: "t" })).rejects.toBe(failure);
    expect(mocks.presentRecommendation).not.toHaveBeenCalled();
  });
});
