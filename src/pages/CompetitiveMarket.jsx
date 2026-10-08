import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { RefreshCw, Store, TriangleAlert } from "lucide-react";
import { useAsyncData } from "../utils/useAsyncData";
import { getProductMarket, captureMarket } from "../api/discoveryService";
import { useAuth } from "../state/AuthContext";
import LoadingState from "../components/common/LoadingState";
import { formatMinor, formatPct, formatDate, relativeTime } from "../utils/money";
import "./CompetitiveMarket.css";

/**
 * WHO ELSE SELLS THIS, AND AT WHAT
 * ================================
 *
 * The screen the application was missing, and the reason the data model was
 * rebuilt. Before this, a tracked product had one seller — whichever listing
 * the user had clicked — so every question a seller actually has was
 * unanswerable: who am I up against, where is the floor, what does it cost to
 * be cheapest, is anyone moving.
 *
 * Three decisions about how it reads, all of them about not overstating what
 * is known:
 *
 * THE SELLER COUNT IS ALWAYS VISIBLE, next to every statistic computed from
 * it. A median over three sellers and one over twenty are different claims,
 * and a reader who cannot see which they have will assume the stronger one.
 *
 * THE FLOOR IS DESCRIBED, NOT JUST STATED. "Cheapest: ₹24,550" invites
 * undercutting it by a rupee. Whether that price is held by one seller or
 * matched by six is the difference between an opportunity and a price war,
 * so the gap to the next seller and the size of the pack at the floor are
 * given the same prominence as the number itself.
 *
 * HISTORY SAYS HOW OLD IT IS. The data provider supplies no past prices — it
 * reports only that it keeps a chart of its own — so every point here was
 * observed by this system. On the first day that is one point, and the page
 * says so rather than drawing a flat line through it.
 */

/** A seller within this of the floor is "at" it. Matches the backend's rule. */
const FLOOR_TOLERANCE = 0.02;

export default function CompetitiveMarket() {
  const { productId } = useOutletContext();
  const { token } = useAuth();
  const [yourPrice, setYourPrice] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [captureNote, setCaptureNote] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  /**
   * The typed price is debounced into the request by being applied only when
   * it parses to a number. A keystroke-per-request would be wasteful for a
   * question the page can also answer client-side, but the backend owns the
   * positioning arithmetic and having two implementations of it is how the
   * two would eventually disagree.
   */
  const parsedPrice = Number.parseFloat(yourPrice);
  const priceParam = Number.isFinite(parsedPrice) && parsedPrice > 0 ? parsedPrice : undefined;

  const { data, loading, error } = useAsyncData(
    () => getProductMarket(productId, { token, yourPrice: priceParam }),
    [productId, token, priceParam, reloadKey]
  );

  const scale = useMemo(() => {
    if (!data?.distribution) return null;
    const { lowMinor, highMinor } = data.distribution;
    // A single price would make a zero-width axis; give it room either side.
    const pad = Math.max(1, Math.round((highMinor - lowMinor) * 0.08)) || Math.round(lowMinor * 0.05);
    const min = Math.max(0, lowMinor - pad);
    const max = highMinor + pad;
    const span = max - min || 1;
    return { min, max, at: (minor) => ((minor - min) / span) * 100 };
  }, [data]);

  async function recapture() {
    setCapturing(true);
    setCaptureNote(null);
    try {
      const result = await captureMarket(productId, { token, force: true });
      setCaptureNote({
        kind: "ok",
        text:
          `${result.sellers} seller(s) across ${result.marketplaces} marketplace(s), ` +
          `from ${result.catalogIds.length} catalogue id(s) — ${result.providerCalls} provider call(s).`,
      });
      setReloadKey((k) => k + 1);
    } catch (cause) {
      setCaptureNote({ kind: "error", text: cause?.message ?? "The market could not be re-read." });
    } finally {
      setCapturing(false);
    }
  }

  if (loading && !data) return <LoadingState label="Reading this product's market…" />;

  if (error) {
    return (
      <section className="cm-empty" role="alert">
        <h2>This product's market could not be read</h2>
        <p>{error.message}</p>
      </section>
    );
  }

  const {
    distribution: dist,
    structure,
    sellers,
    marketplaces,
    history,
    position,
    sufficient,
    product,
    condition,
    otherConditions = [],
  } = data;

  /* ------------------------------------------------- nothing captured yet */

  if (!dist || sellers.length === 0) {
    return (
      <section className="cm-empty">
        <h2>No competing sellers stored yet</h2>
        <p>
          This product has no captured market. Nothing is shown rather than an estimate, because a price with no
          competitors behind it is an assertion.
        </p>
        <button type="button" className="cm-capture" onClick={recapture} disabled={capturing}>
          <RefreshCw size={14} aria-hidden="true" />
          {capturing ? "Reading the market…" : "Read this product's market"}
        </button>
        {captureNote && <p className={`cm-note cm-note-${captureNote.kind}`}>{captureNote.text}</p>}
      </section>
    );
  }


  return (
    <div className="cm">
      {/* ------------------------------------------------------- the summary */}
      <section className="cm-head">
        <div className="cm-head-figures">
          <div className="cm-figure">
            <span className="cm-figure-label">
              {condition ? `Competing sellers · ${condition}` : "Competing sellers"}
            </span>
            <strong className="cm-figure-value tabular">{dist.sellerCount}</strong>
            <span className="cm-figure-note">
              on {dist.marketplaceCount} marketplace{dist.marketplaceCount === 1 ? "" : "s"}
              {product.catalogIdCount > 1 ? `, from ${product.catalogIdCount} catalogue listings` : ""}
            </span>
          </div>
          <div className="cm-figure">
            <span className="cm-figure-label">Cheapest</span>
            <strong className="cm-figure-value tabular">{formatMinor(dist.lowMinor)}</strong>
            <span className="cm-figure-note">
              {structure?.cheapest.sellerName}
              {structure && structure.atFloorCount > 1 ? ` + ${structure.atFloorCount - 1} matching` : ""}
            </span>
          </div>
          <div className="cm-figure">
            <span className="cm-figure-label">Median</span>
            <strong className="cm-figure-value tabular">{formatMinor(dist.medianMinor)}</strong>
            <span className="cm-figure-note">over {dist.sellerCount} sellers</span>
          </div>
          <div className="cm-figure">
            <span className="cm-figure-label">Dearest</span>
            <strong className="cm-figure-value tabular">{formatMinor(dist.highMinor)}</strong>
            <span className="cm-figure-note">{dist.spreadPct}% spread</span>
          </div>
        </div>

        <div className="cm-head-actions">
          <p className="cm-captured">
            {product.lastCapturedAt
              ? `Market read ${relativeTime(product.lastCapturedAt)}`
              : "Never read"}
          </p>
          <button type="button" className="cm-capture" onClick={recapture} disabled={capturing}>
            <RefreshCw size={14} aria-hidden="true" />
            {capturing ? "Reading…" : "Read again"}
          </button>
        </div>
      </section>

      {captureNote && <p className={`cm-note cm-note-${captureNote.kind}`}>{captureNote.text}</p>}

      {/*
        Stated, not implied. A two-seller market is still shown — it is the
        truth about the product — but it is labelled so no reader mistakes it
        for a market a price can be argued against.
      */}
      {!sufficient && (
        <p className="cm-thin" role="note">
          <TriangleAlert size={14} aria-hidden="true" />
          Only {dist.sellerCount} seller{dist.sellerCount === 1 ? "" : "s"} known. This is what the market looks like,
          but it is too thin to position a price against with any confidence.
        </p>
      )}

      {/*
        CONDITION IS A PARTITION, NOT A FILTER, so what was set aside is shown
        rather than quietly dropped. A refurbished market 20% below the new one
        is real competitive information; it is simply not the market a
        new-stock seller's price is argued against. Found against live data,
        where pooling them put a product's floor at a refurbished price.
      */}
      {otherConditions.length > 0 && (
        <section className="cm-conditions">
          <h2>Not counted as competition</h2>
          <p>
            These are a different market. A {condition} listing does not compete with them, so they are excluded from
            every figure above — and shown here, because they are real.
          </p>
          <ul>
            {otherConditions.map((group) => (
              <li key={group.condition}>
                <span className="cm-cond-name">{group.condition}</span>
                <span className="cm-cond-count">
                  {group.sellerCount} seller{group.sellerCount === 1 ? "" : "s"}
                </span>
                <span className="cm-cond-range tabular">
                  {group.lowMinor == null
                    ? "—"
                    : group.lowMinor === group.highMinor
                      ? formatMinor(group.lowMinor)
                      : `${formatMinor(group.lowMinor)} – ${formatMinor(group.highMinor)}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* --------------------------------------------------- the distribution */}
      <section className="cm-panel">
        <header className="cm-panel-head">
          <h2>Where every seller sits</h2>
          <p>
            One dot per seller, on a zoomed axis. Bars from a zero baseline would make a 30% spread look like none at
            all, and a truncated baseline would exaggerate it.
          </p>
        </header>

        <div className="cm-plot">
          <div className="cm-plot-track">
            {/* The inter-quartile body, so the middle of the market is visible. */}
            <span
              className="cm-plot-iqr"
              style={{ left: `${scale.at(dist.p25Minor)}%`, width: `${scale.at(dist.p75Minor) - scale.at(dist.p25Minor)}%` }}
              aria-hidden="true"
            />
            <span className="cm-plot-median" style={{ left: `${scale.at(dist.medianMinor)}%` }} aria-hidden="true" />

            {sellers.map((s) => {
              const atFloor = structure && s.priceMinor <= structure.floorMinor * (1 + FLOOR_TOLERANCE);
              return (
                <span
                  key={s.sellerId}
                  className={`cm-dot${atFloor ? " cm-dot-floor" : ""}${s.inStock ? "" : " cm-dot-oos"}`}
                  style={{ left: `${scale.at(s.priceMinor)}%` }}
                  title={`${s.sellerName} — ${formatMinor(s.priceMinor)}${s.inStock ? "" : " (out of stock)"}`}
                />
              );
            })}

            {position && priceParam != null && (
              <span className="cm-plot-you" style={{ left: `${scale.at(Math.round(parsedPrice * 100))}%` }}>
                <span className="cm-plot-you-flag">you</span>
              </span>
            )}
          </div>
          <div className="cm-plot-axis">
            <span className="tabular">{formatMinor(scale.min)}</span>
            <span className="tabular">{formatMinor(scale.max)}</span>
          </div>
        </div>

        {/* ---------------------------------------- what the floor really is */}
        {structure && (
          <dl className="cm-structure">
            <div>
              <dt>Price floor</dt>
              <dd className="tabular">{formatMinor(structure.floorMinor)}</dd>
              {/*
                The store and the merchant are the same entity for most of
                this data, so naming both reads as "held by X on X".
              */}
              <p>
                held by {structure.cheapest.sellerName}
                {structure.cheapest.marketplaceName !== structure.cheapest.sellerName
                  ? ` on ${structure.cheapest.marketplaceName}`
                  : ""}
              </p>
            </div>
            <div>
              <dt>Sellers at that price</dt>
              <dd className="tabular">{structure.atFloorCount}</dd>
              <p>
                {structure.atFloorCount >= 3
                  ? "A contested floor — a cut there will be matched."
                  : structure.atFloorCount === 2
                    ? "One other seller is already matching it."
                    : "One seller holds it alone."}
              </p>
            </div>
            <div>
              <dt>Gap to the next seller</dt>
              <dd className="tabular">
                {structure.floorGapMinor == null ? "—" : formatMinor(structure.floorGapMinor)}
              </dd>
              {/*
                A zero gap is its own case. Calling it "narrow" was
                technically true and read as nonsense beside a figure of ₹0.
              */}
              <p>
                {structure.floorGapMinor == null
                  ? "Only one seller, so there is no gap to read."
                  : structure.floorGapMinor === 0
                    ? "No gap at all — the next seller is at the same price."
                    : structure.floorGapMinor > structure.floorMinor * 0.08
                      ? "Wide — the cheapest seller is an outlier rather than the market."
                      : "Narrow — the cheapest price is roughly where the market is."}
              </p>
            </div>
            <div>
              <dt>Clustered within 5%</dt>
              <dd className="tabular">{formatPct(structure.clustering)}</dd>
              <p>
                {structure.clustering >= 0.7
                  ? "Almost everyone charges the same; price is not the lever here."
                  : "Prices are spread, so there is room to position."}
              </p>
            </div>
          </dl>
        )}
      </section>

      {/* --------------------------------------------------- where you'd land */}
      <section className="cm-panel cm-position">
        <header className="cm-panel-head">
          <h2>If you listed at…</h2>
          <p>Your own intended price. Not stored — it is a question, not a fact about the product.</p>
        </header>

        <label className="cm-price-input">
          <span>Your price</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="1"
            value={yourPrice}
            onChange={(e) => setYourPrice(e.target.value)}
            placeholder={String(Math.round(dist.medianMinor / 100))}
          />
        </label>

        {position ? (
          <dl className="cm-position-facts">
            <div>
              <dt>Rank</dt>
              <dd className="tabular">
                {position.rank} of {position.of}
              </dd>
            </div>
            <div>
              <dt>Sellers you undercut</dt>
              <dd className="tabular">{position.undercuts}</dd>
            </div>
            <div>
              <dt>Above the cheapest by</dt>
              <dd className="tabular">{position.premiumOverLowPct}%</dd>
            </div>
            <div>
              <dt>Against the median</dt>
              <dd className="tabular">
                {position.vsMedianPct > 0 ? "+" : ""}
                {position.vsMedianPct}%
              </dd>
            </div>
          </dl>
        ) : (
          <p className="cm-position-hint">Type a price to see where it would place you.</p>
        )}
      </section>

      {/* ------------------------------------------------------ by marketplace */}
      <section className="cm-panel">
        <header className="cm-panel-head">
          <h2>By marketplace</h2>
          <p>Cheapest first. Several sellers on one marketplace is a narrower market than the same count spread out.</p>
        </header>
        <ul className="cm-marketplaces">
          {marketplaces.map((m) => (
            <li key={m.marketplaceId}>
              <span className="cm-mp-name">
                <Store size={13} aria-hidden="true" />
                {m.marketplaceName}
              </span>
              <span className="cm-mp-price tabular">{formatMinor(m.lowMinor)}</span>
              <span className="cm-mp-count">
                {m.sellers} seller{m.sellers === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* ------------------------------------------------------- every seller */}
      <section className="cm-panel">
        <header className="cm-panel-head">
          <h2>Every seller</h2>
          <p>
            As the provider reported them. A blank is a blank — an unstated shipping cost is not recorded as free.
          </p>
        </header>
        <div className="cm-table-scroll">
          <table className="cm-table">
            <thead>
              <tr>
                <th scope="col">Seller</th>
                <th scope="col">Marketplace</th>
                <th scope="col" className="num">
                  Price
                </th>
                <th scope="col" className="num">
                  Shipping
                </th>
                <th scope="col" className="num">
                  Landed
                </th>
                <th scope="col">Stock</th>
                <th scope="col">Condition</th>
                <th scope="col" className="num">
                  Rating
                </th>
              </tr>
            </thead>
            <tbody>
              {sellers.map((s) => {
                const atFloor = structure && s.priceMinor <= structure.floorMinor * (1 + FLOOR_TOLERANCE);
                return (
                  <tr key={s.sellerId} className={atFloor ? "cm-row-floor" : undefined}>
                    <th scope="row">
                      {s.url ? (
                        <a href={s.url} target="_blank" rel="noreferrer noopener">
                          {s.sellerName}
                        </a>
                      ) : (
                        s.sellerName
                      )}
                    </th>
                    <td>{s.marketplaceName}</td>
                    <td className="num tabular">{formatMinor(s.priceMinor)}</td>
                    <td className="num tabular">
                      {s.shippingMinor == null ? "—" : s.shippingMinor === 0 ? "free" : formatMinor(s.shippingMinor)}
                    </td>
                    <td className="num tabular">{formatMinor(s.landedMinor)}</td>
                    <td>{s.inStock ? "in stock" : "out of stock"}</td>
                    <td>{s.condition}</td>
                    <td className="num tabular">{s.rating == null ? "—" : s.rating}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ----------------------------------------------------------- history */}
      <section className="cm-panel">
        <header className="cm-panel-head">
          <h2>This market over time</h2>
          <p>
            Every point was observed by this system. The data provider supplies no past prices, so history begins at
            the first capture and nothing before it is drawn.
          </p>
        </header>

        {history.note ? (
          <p className="cm-history-note">{history.note}</p>
        ) : (
          <>
            <dl className="cm-trend">
              <div>
                <dt>Direction</dt>
                <dd>{history.trend.direction}</dd>
              </div>
              <div>
                <dt>Change</dt>
                <dd className="tabular">
                  {history.trend.changePct > 0 ? "+" : ""}
                  {history.trend.changePct}%
                </dd>
              </div>
              <div>
                <dt>Captures</dt>
                <dd className="tabular">
                  {history.trend.points} over {history.trend.spanDays} day
                  {history.trend.spanDays === 1 ? "" : "s"}
                </dd>
              </div>
              <div>
                <dt>Sellers behind it</dt>
                <dd className="tabular">
                  {history.trend.minSellerCount}–{history.trend.maxSellerCount}
                </dd>
              </div>
            </dl>

            {/*
              The caveat that the per-product aggregate exists to make
              visible: a median can move because the population changed
              rather than because anyone changed a price.
            */}
            {!history.trend.comparable && (
              <p className="cm-thin" role="note">
                <TriangleAlert size={14} aria-hidden="true" />
                The number of sellers changed materially across this window, so part of that movement describes who was
                counted rather than what was charged.
              </p>
            )}

            <ol className="cm-points">
              {history.points.map((p) => (
                <li key={p.capturedOn}>
                  <span className="cm-point-date">{formatDate(p.capturedOn)}</span>
                  <span className="cm-point-price tabular">{formatMinor(p.medianMinor)}</span>
                  <span className="cm-point-count">
                    {p.sellerCount} seller{p.sellerCount === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    </div>
  );
}
