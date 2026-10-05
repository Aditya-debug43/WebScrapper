import { useAsyncData } from "../utils/useAsyncData";
import { useAuth } from "../state/AuthContext";
import { getDataSourcesOverview } from "../api/dataSourcesService";
import Breadcrumbs from "../components/common/Breadcrumbs";
import StatusBadge from "../components/common/StatusBadge";
import DataTable from "../components/common/DataTable";
import LoadingState from "../components/common/LoadingState";
import { formatDateTime, relativeTime } from "../utils/money";
import { Clock, CheckCircle2, ShieldAlert } from "lucide-react";
import "./DataSources.css";

const RUN_STATUS = { success: "good", partial: "warning", failed: "critical" };

/**
 * Pages attempted and succeeded, where a run recorded them.
 *
 * A provider call fetches one response rather than crawling pages, so these
 * are null for it. "null/null" on screen is worse than an em dash, and
 * "0/0" would read as a run that failed to fetch anything.
 */
function pages(run) {
  if (!run || run.pagesAttempted == null) return "—";
  return `${run.pagesSucceeded ?? 0}/${run.pagesAttempted}`;
}

export default function DataSources() {
  const { token } = useAuth();
  const { data, loading, error } = useAsyncData(() => getDataSourcesOverview({ token }), [token]);

  return (
    <div className="page">
      <Breadcrumbs items={[{ label: "Data Sources" }]} />
      <div className="page-head">
        <div>
          <h1 className="page-title">Data sources &amp; coverage</h1>
          <p className="page-subtitle">
            What was captured, when, how completely, and how confident the system is that a listing is matched to
            the right product — the numbers that say whether the rest of this app can be trusted.
          </p>
        </div>
      </div>

      {loading && <LoadingState label="Loading provenance…" />}

      {/*
        * A provenance screen that invents provenance when the backend is
        * unreachable is worse than no provenance screen. The failure is
        * shown.
        */}
      {error && (
        <div className="pw-missing">
          <span className="eyebrow">Unavailable</span>
          <h2 className="page-title">Provenance could not be loaded</h2>
          <p className="page-subtitle">{error.message}</p>
        </div>
      )}

      {data && (
        <>
          <div className="ds-marketplace-grid stagger">
            {data.perMarketplace.map((m) => (
              <div className="ds-marketplace-card" key={m.marketplace.id}>
                <div className="ds-marketplace-head">
                  <span className="marketplace-dot" style={{ background: m.marketplace.brandColor }} />
                  <h3>{m.marketplace.name}</h3>
                  {m.latestRun && <StatusBadge status={RUN_STATUS[m.latestRun.runStatus]}>{m.latestRun.runStatus}</StatusBadge>}
                </div>

                <div className="ds-marketplace-metrics">
                  <div>
                    <span className="eyebrow">Last capture</span>
                    <p className="ds-metric-value">
                      <Clock size={13} strokeWidth={2} />{" "}
                      {m.latestRun
                        ? relativeTime(m.latestRun.finishedAt ?? m.latestRun.startedAt)
                        : m.lastObservedAt
                          ? "via another source"
                          : "never"}
                    </p>
                  </div>
                  <div>
                    <span className="eyebrow">Pages</span>
                    <p className="ds-metric-value">
                      <CheckCircle2 size={13} strokeWidth={2} />
                      {pages(m.latestRun)}
                    </p>
                  </div>
                  <div>
                    <span className="eyebrow">Match confidence</span>
                    <p className="ds-metric-value">
                      <ShieldAlert size={13} strokeWidth={2} />
                      {m.avgMatchConfidence != null ? `${Math.round(m.avgMatchConfidence * 100)}% avg` : "—"}
                    </p>
                  </div>
                </div>

                <p className="ds-listing-count">
                  {m.listingCount} listings tracked · {m.humanConfirmed} human-confirmed
                </p>

                <div className="ds-coverage">
                  <span className="eyebrow" style={{ display: "block", marginBottom: 8 }}>
                    Field parse coverage, most recent run
                  </span>
                  {m.coverage.map((c) => (
                    <div className="ds-coverage-row" key={c.field}>
                      <span>{c.field.replace(/_/g, " ")}</span>
                      <div className="ds-coverage-bar">
                        <div className="ds-coverage-bar-fill" style={{ width: `${c.coveragePct}%` }} />
                      </div>
                      <span className="tabular">{c.coveragePct.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>

                {m.latestRun?.notes && <p className="ds-notes">{m.latestRun.notes}</p>}
              </div>
            ))}
          </div>

          <section className="ds-section">
            <h2 className="section-title ds-section-title">Recent capture runs</h2>
            <DataTable
              columns={[
                {
                  key: "marketplace",
                  header: "Marketplace",
                  // A provider run spans several stores and names none of
                  // them, so it reports its provider instead of a blank.
                  render: (r) => r.marketplaceName ?? (r.provider ? `${r.provider} (all stores)` : "—"),
                },
                { key: "started", header: "Started", render: (r) => formatDateTime(r.startedAt) },
                { key: "status", header: "Status", render: (r) => <StatusBadge status={RUN_STATUS[r.runStatus]}>{r.runStatus}</StatusBadge> },
                { key: "pages", header: "Pages", align: "right", render: (r) => pages(r) },
                { key: "parser", header: "Parser version", render: (r) => r.parserVersion ?? "—" },
              ]}
              rows={data.recentRuns}
              rowKey={(r) => r.id}
            />
          </section>

          <section className="ds-section">
            <h2 className="section-title ds-section-title">Quarantined records</h2>
            <p className="ds-section-note">
              Rows that failed validation are kept, not dropped — a rejects table turns a mystery into a report.
            </p>
            <DataTable
              columns={[
                { key: "entity", header: "Target entity", render: (r) => r.targetEntity },
                { key: "reason", header: "Rejection reason", render: (r) => r.rejectionReason },
                { key: "when", header: "Captured", render: (r) => formatDateTime(r.capturedAt) },
              ]}
              rows={data.recentRejections}
              rowKey={(r) => r.id}
              emptyMessage="Nothing quarantined in the most recent runs."
            />
          </section>
        </>
      )}
    </div>
  );
}
