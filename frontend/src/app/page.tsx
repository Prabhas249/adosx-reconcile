'use client';

import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

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

function StatusIcon({ tone }: { tone: BadgeTone }) {
  if (tone === 'danger') {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M8 2.25 14 13H2L8 2.25Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M8 6.25v3.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="8" cy="11.25" r="0.75" fill="currentColor" />
      </svg>
    );
  }
  if (tone === 'warn') {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="5.75" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 5.25v3.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="8" cy="11" r="0.75" fill="currentColor" />
      </svg>
    );
  }
  if (tone === 'accent') {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M3 5.5h10M3 10.5h10"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2.5" y="3.25" width="11" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.5 6.5h11" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function CopyIdButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      className="copy-btn"
      aria-label={`Copy ${value}`}
      title={`Copy ${value}`}
      onClick={handleCopy}
    >
      <span className="icon-swap" data-copied={copied ? 'true' : 'false'}>
        <svg className="icon-copy" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M10.5 3.5A1.5 1.5 0 0 0 9 2H4A1.5 1.5 0 0 0 2.5 3.5v5A1.5 1.5 0 0 0 4 10"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        <svg className="icon-check" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="m3.5 8.5 3 3 6-6.5"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </button>
  );
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
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [rows, setRows] = useState<Disagreement[]>([]);
  const [hasLoadedRows, setHasLoadedRows] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeRow, setActiveRow] = useState<Disagreement | null>(null);
  const [renderBatch, setRenderBatch] = useState<number>(0);
  const [reloadKey, setReloadKey] = useState<number>(0);

  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const lastRowTriggerRef = useRef<HTMLTableRowElement | null>(null);

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
    setActiveRow(null);

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
        setRenderBatch((n) => n + 1);
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

  useEffect(() => {
    if (!activeRow) return;
    closeBtnRef.current?.focus();

    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveRow(null);
        lastRowTriggerRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeRow]);

  const visibleRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.record_id.toLowerCase().includes(q) ||
        r.location_id.toLowerCase().includes(q) ||
        r.location_name.toLowerCase().includes(q) ||
        r.detail.toLowerCase().includes(q),
    );
  }, [rows, searchQuery]);

  const selectedOrgIndex = Math.max(0, orgs.indexOf(selectedOrg));
  const hasFilters = Boolean(selectedReason || searchQuery.trim() || sortOrder !== 'value_desc');

  const openInspector = (row: Disagreement, element: HTMLTableRowElement) => {
    lastRowTriggerRef.current = element;
    setActiveRow(row);
  };

  const closeInspector = () => {
    setActiveRow(null);
    lastRowTriggerRef.current?.focus();
  };

  const handleRowKeyDown = (e: KeyboardEvent<HTMLTableRowElement>, row: Disagreement) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openInspector(row, e.currentTarget);
    }
  };

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
            {orgs.length > 0 && (
              <span
                className="segmented-indicator"
                aria-hidden="true"
                style={{
                  width: `calc((100% - 8px) / ${orgs.length})`,
                  transform: `translateX(${selectedOrgIndex * 100}%)`,
                }}
              />
            )}
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
          <span className="scope-hint">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
              <path
                d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            API scoped to {selectedOrg || 'selected org'} only
          </span>
        </div>
      </header>

      <section className="controls-card" aria-label="Filter and sort controls">
        <div className="field-group">
          <label className="field-label" htmlFor="search-input">
            Search record or location
          </label>
          <input
            id="search-input"
            type="search"
            className="control-input"
            placeholder="REC-1064, LOC-101..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

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
            Sort
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
            <strong>{visibleRows.length}</strong>
            <span>disagreement{visibleRows.length === 1 ? '' : 's'}</span>
          </span>
          {hasFilters && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => {
                setSelectedReason('');
                setSearchQuery('');
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
          <div style={{ padding: '20px' }} aria-label="Loading disagreements">
            {[0, 1, 2, 3, 4].map((idx) => (
              <div
                key={idx}
                className="skeleton-line"
                style={{ width: `${92 - idx * 7}%`, marginBottom: idx === 4 ? 0 : '14px' }}
              />
            ))}
          </div>
        ) : visibleRows.length === 0 ? (
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
                  setSearchQuery('');
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
                {visibleRows.map((row, idx) => {
                  const tone = getReasonTone(row.reason);
                  const rowKey = `${row.record_id}-${row.reason}-${row.system_a_raw}-${row.system_b_raw}`;
                  const isSelected =
                    activeRow?.record_id === row.record_id && activeRow?.reason === row.reason;
                  const delay = Math.min(idx, 6) * 28;
                  return (
                    <tr
                      key={`${renderBatch}-${rowKey}`}
                      className="ledger-row row-stagger"
                      style={{ '--row-delay': `${delay}ms` } as CSSProperties}
                      tabIndex={0}
                      data-selected={isSelected ? 'true' : 'false'}
                      onClick={(e) => openInspector(row, e.currentTarget)}
                      onKeyDown={(e) => handleRowKeyDown(e, row)}
                    >
                      <td data-label="Record ID">
                        <div className="record-cell">
                          <code className="record-id">{row.record_id}</code>
                          <CopyIdButton value={row.record_id} />
                        </div>
                      </td>
                      <td data-label="Location">
                        <div className="location-primary">{row.location_name}</div>
                        <div className="location-id mono">{row.location_id}</div>
                      </td>
                      <td data-label="Reason">
                        <span className="reason-badge" data-tone={tone}>
                          <StatusIcon tone={tone} />
                          <span>{row.reason_label}</span>
                        </span>
                      </td>
                      <ValueCell label="System A Value" parsed={row.system_a_value} raw={row.system_a_raw} />
                      <ValueCell label="System B Value" parsed={row.system_b_value} raw={row.system_b_raw} />
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

      {activeRow && (
        <div
          className="drawer-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeInspector();
          }}
        >
          <aside
            className="drawer-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="drawer-title"
          >
            <div className="drawer-header">
              <div>
                <div className="mono" style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  {selectedOrg} · {activeRow.location_id}
                </div>
                <h2 id="drawer-title" style={{ margin: '4px 0 8px', fontSize: '20px' }}>
                  {activeRow.record_id}
                </h2>
                <span className="reason-badge" data-tone={getReasonTone(activeRow.reason)}>
                  <StatusIcon tone={getReasonTone(activeRow.reason)} />
                  <span>{activeRow.reason_label}</span>
                </span>
              </div>
              <button
                ref={closeBtnRef}
                type="button"
                className="btn-ghost"
                onClick={closeInspector}
              >
                Close
              </button>
            </div>

            <p style={{ margin: 0, color: 'var(--text-secondary)', textWrap: 'pretty' }}>
              {activeRow.detail}
            </p>

            <div className="drawer-grid">
              <div className="compare-box">
                <div className="compare-box-label">System A</div>
                <div className="val-parsed mono tabular" style={{ fontSize: '18px' }}>
                  {activeRow.system_a_value ?? '-'}
                </div>
                <div className="val-raw mono">raw: {activeRow.system_a_raw || '(none)'}</div>
              </div>
              <div className="compare-box">
                <div className="compare-box-label">System B</div>
                <div className="val-parsed mono tabular" style={{ fontSize: '18px' }}>
                  {activeRow.system_b_value ?? '-'}
                </div>
                <div className="val-raw mono">raw: {activeRow.system_b_raw || '(none)'}</div>
              </div>
            </div>

            <div className="compare-box">
              <div className="compare-box-label">Location and Tenant Scope</div>
              <div style={{ fontWeight: 500 }}>
                {activeRow.location_name} ({activeRow.location_id})
              </div>
              <div style={{ marginTop: '4px', fontSize: '12px', color: 'var(--text-muted)' }}>
                {activeRow.reason === 'TENANT_MISMATCH'
                  ? 'Foreign org identifiers and values are redacted on the server before this response leaves Django.'
                  : `Scoped strictly to ${selectedOrg}.`}
              </div>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
