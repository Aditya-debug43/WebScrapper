import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Package, Search, Trash2, Clock, ArrowRight } from "lucide-react";
import { useAuth } from "../state/AuthContext";
import { getTracked, untrack } from "../api/discoveryService";
import MetricCard from "../components/common/MetricCard";
import LoadingState from "../components/common/LoadingState";
import Breadcrumbs from "../components/common/Breadcrumbs";
import { formatMinor } from "../utils/money";
import "./Dashboard.css";

/**
 * THE DESK — what this user is actually following.
 *
 * It used to open on a stratified sample of twelve seeded products chosen by
 * profiling the whole bundled catalogue. That set was identical for every
 * visitor and belonged to none of them.
 *
 * Now it is empty until you track something, and that emptiness is correct:
 * a desk showing products nobody asked for was furniture.
 *
 * Every figure comes from a real capture. A product tracked a minute ago has
 * one observation and no movement, and says so rather than showing a zero.
 */

/** A capture older than this is called out rather than presented as current. */
const STALE_AFTER_HOURS = 48;

function age(iso) {
  if (!iso) return null;
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 1) return "under an hour ago";
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function Dashboard() {
  const { token } = useAuth();
  const [state, setState] = useState({ loading: true, error: null, rows: [] });
  const [removing, setRemoving] = useState(null);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const rows = await getTracked({ token });
      setState({ loading: false, error: null, rows });
    } catch (error) {
      setState({ loading: false, error, rows: [] });
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (trackingId) => {
    setRemoving(trackingId);
    try {
      await untrack(trackingId, { token });
      await load();
    } finally {
      setRemoving(null);
    }
  };

  const { loading, error, rows } = state;
  const withPrice = rows.filter((r) => r.currentPriceMinor != null);
  const awaiting = rows.length - withPrice.length;

  return (
    <div className="page">
      <Breadcrumbs items={[{ label: "Dashboard" }]} />
      <div className="page-head">
        <div>
          <h1 className="page-title">Your desk</h1>
          <p className="page-subtitle">
            The products you follow, priced from real market captures. History begins the day you start tracking.
          </p>
        </div>
        <Link to="/catalogue" className="btn btn-primary">
          <Search size={15} strokeWidth={2} /> Find a product
        </Link>
      </div>

      {loading && <LoadingState label="Loading your desk…" />}

      {error && (
        <div className="pw-missing">
          <span className="eyebrow">Unavailable</span>
          <h2 className="page-title">Your desk could not be loaded</h2>
          <p className="page-subtitle">{error.message}</p>
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="dash-empty">
          <p>You are not following anything yet.</p>
          <p className="disc-empty-note">
            Search for a product and press <strong>Track this product</strong>. Its price is recorded immediately,
            and a new observation is added each time the market is captured.
          </p>
          <Link to="/catalogue" className="btn btn-primary btn-sm">
            Find a product <ArrowRight size={14} strokeWidth={2} />
          </Link>
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <>
          <div className="dash-metrics stagger">
            <MetricCard label="Products followed" value={rows.length} icon={Package} sublabel="on your desk" />
            <MetricCard
              label="With a price"
              value={`${withPrice.length} / ${rows.length}`}
              icon={Clock}
              sublabel={awaiting > 0 ? `${awaiting} awaiting first capture` : "all captured"}
            />
          </div>

          <div className="scroll-x">
            <table className="desk-table">
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">Source</th>
                  <th scope="col" className="num">Obs.</th>
                  <th scope="col" className="num">Price</th>
                  <th scope="col">Last capture</th>
                  <th scope="col">Followers</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const stale =
                    row.currentObservedAt &&
                    (Date.now() - new Date(row.currentObservedAt).getTime()) / 3_600_000 > STALE_AFTER_HOURS;
                  return (
                    <tr key={row.trackingId}>
                      <th scope="row">
                        <Link to={`/products/${row.productId}/recommendation`} className="desk-name">
                          {row.name}
                        </Link>
                        {row.searchQuery && <span className="desk-sub">searched “{row.searchQuery}”</span>}
                      </th>
                      <td>{row.currentMarketplace ?? "—"}</td>
                      <td className="num tabular">{row.observationCount}</td>
                      <td className="num tabular">
                        {row.currentPriceMinor != null ? formatMinor(row.currentPriceMinor) : "—"}
                      </td>
                      <td>
                        {/*
                          * An unpriced row is waiting, not free. The two states
                          * look nothing alike on purpose.
                          */}
                        {row.currentObservedAt ? (
                          <span className={stale ? "desk-none" : ""}>{age(row.currentObservedAt)}</span>
                        ) : (
                          <span className="desk-none">Waiting for first capture</span>
                        )}
                      </td>
                      <td className="tabular">{row.trackerCount}</td>
                      <td className="desk-go">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => remove(row.trackingId)}
                          disabled={removing === row.trackingId}
                          aria-label={`Stop tracking ${row.name}`}
                        >
                          <Trash2 size={13} strokeWidth={2} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="desk-note">
            <strong>Obs.</strong> is how many real observations exist — it starts at one and grows with each
            capture. <strong>Followers</strong> is how many people track this product in total; they all share the
            same market captures, so following something popular costs no extra lookups.
          </p>
        </>
      )}
    </div>
  );
}
