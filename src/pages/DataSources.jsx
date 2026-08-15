import { useAsyncData } from "../utils/useAsyncData";
import { getDataSourcesOverview } from "../api/dataSourcesService";
import Breadcrumbs from "../components/common/Breadcrumbs";
import StatusBadge from "../components/common/StatusBadge";
import DataTable from "../components/common/DataTable";
import LoadingState from "../components/common/LoadingState";
import { formatDateTime, relativeTime } from "../utils/money";
import { Clock, CheckCircle2, ShieldAlert } from "lucide-react";
import "./DataSources.css";

const RUN_STATUS = { success: "good", partial: "warning", failed: "critical" };

export default function DataSources() {
  const { data, loading } = useAsyncData(() => getDataSourcesOverview(), []);

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

      {data && (
        <>
          <div className="ds-marketplace-grid">
            {data.perMarketplace.map((m) => (
              <div className="card ds-marketplace-card" key={m.marketplace.id}>
                <div className="ds-marketplace-head">
                  <span className="marketplace-dot" style={{ background: m.marketplace.brandColor }} />
                  <h3>{m.marketplace.name}</h3>
                  {m.latestRun && <StatusBadge status={RUN_STATUS[m.latestRun.runStatus]}>{m.latestRun.runStatus}</StatusBadge>}
                </div>

                <div className="ds-marketplace-metrics">
                  <div>
                    <span className="eyebrow">Last capture</span>
                    <p className="ds-metric-value">
                      <Clock size={13} strokeWidth={2} /> {m.latestRun ? relativeTime(m.latestRun.finishedAt) : "—"}
                    </p>
                  </div>
                  <div>
                    <span className="eyebrow">Pages</span>
                    <p className="ds-metric-value">
                      <CheckCircle2 size={13} strokeWidth={2} />
                      {m.latestRun ? `${m.latestRun.pagesSucceeded}/${m.latestRun.pagesAttempted}` : "—"}
                    </p>
                  </div>
                  <div>
                    <span className="eyebrow">Match confidence</span>
                    <p className="ds-metric-value">
                      <ShieldAlert size={13} strokeWidth={2} />
                      {Math.round(m.avgMatchConfidence * 100)}% avg
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

          <section style={{ marginTop: 32 }}>
            <h2 className="section-title" style={{ marginBottom: 14 }}>
              Recent capture runs
            </h2>
            <DataTable
              columns={[
                { key: "marketplace", header: "Marketplace", render: (r) => data.perMarketplace.find((m) => m.marketplace.id === r.marketplaceId)?.marketplace.name },
                { key: "started", header: "Started", render: (r) => formatDateTime(r.startedAt) },
                { key: "status", header: "Status", render: (r) => <StatusBadge status={RUN_STATUS[r.runStatus]}>{r.runStatus}</StatusBadge> },
                { key: "pages", header: "Pages", align: "right", render: (r) => `${r.pagesSucceeded}/${r.pagesAttempted}` },
                { key: "parser", header: "Parser version", render: (r) => r.parserVersion },
              ]}
              rows={data.recentRuns}
              rowKey={(r) => r.id}
            />
          </section>

          <section style={{ marginTop: 32 }}>
            <h2 className="section-title" style={{ marginBottom: 14 }}>
              Quarantined records
            </h2>
            <p className="pr-explainer" style={{ marginBottom: 14, fontSize: "var(--text-sm)", color: "var(--ink-500)" }}>
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
