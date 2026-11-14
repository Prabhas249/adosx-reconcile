'use client';

import { useEffect, useState } from 'react';

interface Disagreement {
  record_id: string;
  reason: string;
  reason_label: string;
  detail: string;
  location_id: string;
  location_name: string;
  system_a_value: string | null;
  system_a_raw: string;
  system_b_value: string | null;
  system_b_raw: string;
  sort_value: number;
}

interface ReasonOption {
  code: string;
  label: string;
}

type BadgeTone = 'danger' | 'warn' | 'accent' | 'neutral';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8000/api';

function getReasonTone(reason: string): BadgeTone {
  if (reason === 'TENANT_MISMATCH' || reason === 'VOIDED_IN_A') return 'danger';
  if (reason === 'MISSING_IN_B' || reason === 'ORPHAN_IN_B') return 'warn';
  if (reason === 'VALUE_MISMATCH' || reason === 'DUPLICATE_IN_B' || reason === 'UNPARSEABLE_VALUE') {
    return 'accent';
  }
  return 'neutral';
}

function ValueCell({
  label,
  parsed,
  raw,
}: {
  label: string;
  parsed: string | null;
  raw: string;
}) {
  const showRaw = Boolean(raw) && raw !== parsed && !(parsed === null && raw === '-');
  return (
    <td className="num tabular" data-label={label}>
      <div>
        <div className="val-parsed mono">{parsed ?? '-'}</div>
        {showRaw && <div className="val-raw mono">raw: {raw}</div>}
      </div>
    </td>
  );
}

export default function DisagreementsPage() {
  const [orgs, setOrgs] = useState<string[]>([]);
  const [reasons, setReasons] = useState<ReasonOption[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<string>('');
  const [selectedReason, setSelectedReason] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<string>('value_desc');
  const [rows, setRows] = useState<Disagreement[]>([]);
  const [hasLoadedRows, setHasLoadedRows] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState<number>(0);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`${API_BASE}/orgs/`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`API error (${res.status}) loading orgs`);
        return res.json();
      })
      .then((data) => {
        const fetchedOrgs: string[] = Array.isArray(data.orgs) ? data.orgs : [];
        setOrgs(fetchedOrgs);
        if (fetchedOrgs.length > 0) {
          setSelectedOrg((prev) => (fetchedOrgs.includes(prev) ? prev : fetchedOrgs[0]));
        } else {
          setLoading(false);
        }
        if (Array.isArray(data.reasons)) {
          setReasons(data.reasons);
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setLoading(false);
        setError(
          err instanceof Error ? `${err.message} (${API_BASE})` : `Unable to reach ${API_BASE}`,
        );
      });

    return () => controller.abort();
  }, [reloadKey]);

  useEffect(() => {
    if (!selectedOrg) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ org: selectedOrg });
    if (selectedReason) params.set('reason', selectedReason);
    if (sortOrder) params.set('sort', sortOrder);

    fetch(`${API_BASE}/disagreements/?${params.toString()}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`API error (${res.status})`);
        return res.json();
      })
      .then((data) => {
        setRows(data.disagreements || []);
        setHasLoadedRows(true);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          err instanceof Error ? `${err.message} (${API_BASE})` : `Unable to reach ${API_BASE}`,
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [selectedOrg, selectedReason, sortOrder, reloadKey]);

  const hasFilters = Boolean(selectedReason || sortOrder !== 'value_desc');

  return (
    <main className="page-shell">
      <header className="header-bar">
        <div>
          <h1 className="page-title">System A and System B Disagreements</h1>
          <p className="page-subtitle">
            Reconciles imported event totals, dates, and references inside a single org boundary.
          </p>
        </div>

        <div className="org-switcher-wrap">
          <div className="segmented-control" role="group" aria-label="Select organization">
            {orgs.length === 0 ? (
              <button type="button" className="segmented-btn" disabled>
                Loading...
              </button>
            ) : (
              orgs.map((org) => (
                <button
                  key={org}
                  type="button"
                  className="segmented-btn"
                  aria-pressed={selectedOrg === org}
                  onClick={() => setSelectedOrg(org)}
                >
                  {org}
                </button>
              ))
            )}
          </div>
          <span className="scope-hint">API scoped to {selectedOrg || 'selected org'} only</span>
        </div>
      </header>

      <section className="controls-card" aria-label="Filter and sort controls">
        <div className="field-group">
          <label className="field-label" htmlFor="reason-select">
            Reason
          </label>
          <select
            id="reason-select"
            className="control-select"
            value={selectedReason}
            onChange={(e) => setSelectedReason(e.target.value)}
          >
            <option value="">All reasons</option>
            {reasons.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field-group">
          <label className="field-label" htmlFor="sort-select">
            Sort by value
          </label>
          <select
            id="sort-select"
            className="control-select"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          >
            <option value="value_desc">Highest value first</option>
            <option value="value_asc">Lowest value first</option>
            <option value="">Record ID (A-Z)</option>
          </select>
        </div>

        <div className="controls-meta">
          <span className="count-pill tabular" role="status" aria-live="polite">
            <strong>{rows.length}</strong>
            <span>disagreement{rows.length === 1 ? '' : 's'}</span>
          </span>
          {hasFilters && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setSelectedReason('');
                setSortOrder('value_desc');
              }}
            >
              Reset
            </button>
          )}
        </div>
      </section>

      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            Retry
          </button>
        </div>
      )}

      <section className="table-card" aria-label="Disagreements table">
        {!hasLoadedRows && loading ? (
          <div className="empty-state" role="status">
            Loading disagreements...
          </div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <p style={{ margin: '0 0 12px', fontWeight: 500 }}>
              No disagreements match these filters for {selectedOrg || 'this org'}.
            </p>
            {hasFilters && (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setSelectedReason('');
                  setSortOrder('value_desc');
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="table-scroll" data-refreshing={loading ? 'true' : 'false'}>
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>Record ID</th>
                  <th>Location</th>
                  <th>Reason</th>
                  <th className="num">System A Value</th>
                  <th className="num">System B Value</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const tone = getReasonTone(row.reason);
                  const rowKey = `${row.record_id}-${row.reason}-${row.system_a_raw}-${row.system_b_raw}`;
                  return (
                    <tr key={rowKey} className="ledger-row">
                      <td data-label="Record ID">
                        <code className="record-id">{row.record_id}</code>
                      </td>
                      <td data-label="Location">
                        <div className="location-primary">{row.location_name}</div>
                        <div className="location-id mono">{row.location_id}</div>
                      </td>
                      <td data-label="Reason">
                        <span className="reason-badge" data-tone={tone}>
                          {row.reason_label}
                        </span>
                      </td>
                      <ValueCell
                        label="System A Value"
                        parsed={row.system_a_value}
                        raw={row.system_a_raw}
                      />
                      <ValueCell
                        label="System B Value"
                        parsed={row.system_b_value}
                        raw={row.system_b_raw}
                      />
                      <td data-label="Detail">
                        <div className="detail-text">{row.detail}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
