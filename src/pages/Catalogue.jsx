import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, Plus, Check, RefreshCw, ExternalLink, Star } from "lucide-react";
import { useAuth } from "../state/AuthContext";
import { searchMarket, trackResult } from "../api/discoveryService";
import LoadingState from "../components/common/LoadingState";
import Breadcrumbs from "../components/common/Breadcrumbs";
import { formatMinor } from "../utils/money";
import "./Catalogue.css";

/**
 * DISCOVERY, NOT A CATALOGUE
 * ==========================
 *
 * This page used to filter a bundled product table, which meant it could only
 * find what had been seeded: searching for anything else returned nothing,
 * however real the product was. It asks the market now.
 *
 * What went with the old page, and why:
 *
 *   FACETS. Brand, category, rating and price-bucket counts were computed
 *   over the whole seeded catalogue. There is no catalogue to count any
 *   more — a search returns the offers for one query — so a facet rail would
 *   be furniture describing nothing. Removed rather than faked.
 *
 *   THE CATEGORY TREE. Same reason. A live result has no taxonomy, and
 *   inventing one to keep a sidebar would be the same mistake as inventing
 *   a price.
 *
 * The query stays in the URL so a search remains shareable and Back works.
 */

export default function Catalogue() {
  const { token } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeQuery = searchParams.get("q") ?? "";

  const [draft, setDraft] = useState(activeQuery);
  const [state, setState] = useState({ loading: false, error: null, data: null });
  /** Tracking is per-result and optimistic-free: a row shows what it is doing. */
  const [tracking, setTracking] = useState({});

  useEffect(() => setDraft(activeQuery), [activeQuery]);

  const run = useCallback(
    async (query, { refresh = false } = {}) => {
      if (!query.trim()) return;
      setState({ loading: true, error: null, data: null });
      try {
        const data = await searchMarket(query, { token, refresh });
        setState({ loading: false, error: null, data });
      } catch (error) {
        // Surfaced, never swapped for invented products.
        setState({ loading: false, error, data: null });
      }
    },
    [token]
  );

  useEffect(() => {
    if (activeQuery) run(activeQuery);
  }, [activeQuery, run]);

  const submit = (event) => {
    event.preventDefault();
    const next = new URLSearchParams(searchParams);
    if (draft.trim()) next.set("q", draft.trim());
    else next.delete("q");
    setSearchParams(next);
  };

  const track = async (result) => {
    setTracking((t) => ({ ...t, [result.ref]: { status: "saving" } }));
    try {
      const saved = await trackResult(result.ref, { token });
      setTracking((t) => ({ ...t, [result.ref]: { status: "tracked", productId: saved.product.id } }));
    } catch (error) {
      setTracking((t) => ({ ...t, [result.ref]: { status: "failed", message: error.message } }));
    }
  };

  const { loading, error, data } = state;

  return (
    <div className="page">
      <Breadcrumbs items={[{ label: "Find a product" }]} />
      <div className="page-head">
        <div>
          <h1 className="page-title">Find a product</h1>
          <p className="page-subtitle">
            Searches the live market rather than a stored catalogue, so a product we have never seen before can
            still be found — and followed.
          </p>
        </div>
      </div>

      <form className="disc-search" onSubmit={submit} role="search">
        <Search size={16} strokeWidth={2} aria-hidden="true" />
        <input
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Search any product — for example, iPhone 17 256GB"
          aria-label="Search the live market"
        />
        <button type="submit" className="btn btn-primary" disabled={!draft.trim() || loading}>
          Search
        </button>
      </form>

      {!activeQuery && !loading && (
        <div className="disc-empty">
          <p>Search for anything. It does not need to be in our database already.</p>
        </div>
      )}

      {loading && <LoadingState label="Asking the market…" />}

      {error && (
        <div className="pw-missing">
          <span className="eyebrow">Unavailable</span>
          <h2 className="page-title">The market could not be read</h2>
          <p className="page-subtitle">{error.message}</p>
          <button type="button" className="btn btn-secondary" onClick={() => run(activeQuery, { refresh: true })}>
            Try again
          </button>
        </div>
      )}

      {data && (
        <>
          <div className="disc-meta">
            <span>
              <strong className="tabular">{data.results.length}</strong> offer
              {data.results.length === 1 ? "" : "s"} for “{data.query}”
            </span>
            <span className="disc-freshness">
              {/* Honest about whether this cost a call. */}
              {data.reused
                ? `reused a capture from ${Math.round(data.ageSeconds / 60)} min ago`
                : "captured just now"}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => run(activeQuery, { refresh: true })}
              title="Fetch the market again. Rate-limited, so a recent capture may be reused."
            >
              <RefreshCw size={13} strokeWidth={2} /> Refresh prices
            </button>
          </div>

          {data.results.length === 0 && (
            <div className="disc-empty">
              <p>No live results found for “{data.query}”.</p>
              <p className="disc-empty-note">
                The search ran and the market returned nothing. That is different from an error — this product may
                simply not be listed.
              </p>
            </div>
          )}

          <div className="disc-grid stagger">
            {data.results.map((result) => {
              const state = tracking[result.ref];
              return (
                <article className="disc-card" key={result.ref}>
                  {/* Only an image the provider actually returned. No placeholder. */}
                  {result.thumbnailUrl ? (
                    <img className="disc-thumb" src={result.thumbnailUrl} alt="" loading="lazy" />
                  ) : (
                    <div className="disc-thumb disc-thumb-none" aria-hidden="true" />
                  )}

                  <div className="disc-body">
                    <h3 className="disc-title">{result.title}</h3>
                    <p className="disc-source">{result.source}</p>

                    <p className="disc-price tabular">
                      {result.priceMinor != null ? formatMinor(result.priceMinor) : "—"}
                      {result.mrpMinor != null && result.mrpMinor > result.priceMinor && (
                        <span className="disc-mrp tabular">{formatMinor(result.mrpMinor)}</span>
                      )}
                    </p>

                    <p className="disc-facts">
                      {/* Every field below is omitted when the provider did not state it. */}
                      {result.shippingFeeMinor != null && (
                        <span>
                          {result.shippingFeeMinor === 0 ? "Free delivery" : `+${formatMinor(result.shippingFeeMinor)} delivery`}
                        </span>
                      )}
                      {result.rating != null && (
                        <span>
                          <Star size={11} strokeWidth={2} /> {result.rating}
                          {result.reviewCount != null ? ` (${result.reviewCount.toLocaleString("en-IN")})` : ""}
                        </span>
                      )}
                      {result.condition && result.condition !== "new" && <span>{result.condition}</span>}
                    </p>

                    <div className="disc-actions">
                      <button
                        type="button"
                        className={`btn btn-sm ${state?.status === "tracked" ? "btn-secondary" : "btn-accent"}`}
                        onClick={() => track(result)}
                        disabled={state?.status === "saving" || state?.status === "tracked"}
                      >
                        {state?.status === "tracked" ? (
                          <>
                            <Check size={13} strokeWidth={2} /> Tracking
                          </>
                        ) : state?.status === "saving" ? (
                          "Saving…"
                        ) : (
                          <>
                            <Plus size={13} strokeWidth={2} /> Track this product
                          </>
                        )}
                      </button>
                      {result.url && (
                        <a className="disc-link" href={result.url} target="_blank" rel="noreferrer noopener">
                          View <ExternalLink size={12} strokeWidth={2} />
                        </a>
                      )}
                    </div>

                    {state?.status === "failed" && <p className="disc-error">{state.message}</p>}
                  </div>
                </article>
              );
            })}
          </div>

          <p className="disc-note">
            Prices are what the market showed at{" "}
            <span className="tabular">{new Date(data.capturedAt).toLocaleString("en-IN")}</span>. Tracking a product
            records that price and begins collecting its history — one capture is shared by everyone following it.
          </p>
        </>
      )}
    </div>
  );
}
