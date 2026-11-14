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

function ChevronDownIcon() {
  return (
    <svg
      className="select-chevron"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4.25 6.25 8 10l3.75-3.75"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      className="search-icon"
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="7.25" cy="7.25" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="m10.75 10.75 2.75 2.75"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function StatusIcon({ tone }: { tone: BadgeTone }) {
  if (tone === 'danger') {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M8 2.25 14 13H2L8 2.25Z"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinejoin="round"
        />
        <path d="M8 6.25v3.25" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        <circle cx="8" cy="11.25" r="0.8" fill="currentColor" />
      </svg>
    );
  }
  if (tone === 'warn') {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="5.75" stroke="currentColor" strokeWidth="1.75" />
        <path d="M8 5.25v3.25" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        <circle cx="8" cy="11" r="0.8" fill="currentColor" />
      </svg>
    );
  }
  if (tone === 'accent') {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M3 5.5h10M3 10.5h10"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2.5" y="3.25" width="11" height="10" rx="2" stroke="currentColor" strokeWidth="1.75" />
      <path d="M2.5 6.5h11" stroke="currentColor" strokeWidth="1.75" />
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
      aria-label={copied ? `Copied ${value}` : `Copy ${value}`}
      title={copied ? `Copied ${value}` : `Copy ${value}`}
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

  const drawerRef = useRef<HTMLElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const lastTriggerRef = useRef<HTMLElement | null>(null);

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
        lastTriggerRef.current?.focus();
        return;
      }
      if (e.key === 'Tab' && drawerRef.current) {
        const focusables = drawerRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
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
        r.reason_label.toLowerCase().includes(q) ||
        r.detail.toLowerCase().includes(q),
    );
  }, [rows, searchQuery]);

  const selectedOrgIndex = Math.max(0, orgs.indexOf(selectedOrg));
  const hasFilters = Boolean(selectedReason || searchQuery.trim() || sortOrder !== 'value_desc');

  const openInspector = (row: Disagreement, trigger: HTMLElement) => {
    lastTriggerRef.current = trigger;
    setActiveRow(row);
  };

  const closeInspector = () => {
    setActiveRow(null);
    lastTriggerRef.current?.focus();
  };

  const handleRowKeyDown = (e: KeyboardEvent<HTMLTableRowElement>, row: Disagreement) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openInspector(row, e.currentTarget);
    }
  };

  return (
    <main className="page-shell">
      <div className="page-content" inert={activeRow ? true : undefined}>
        <header className="header-bar">
          <div>
            <div className="eyebrow">ADOSX Reconciliation</div>
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
            <div className="input-wrap">
              <SearchIcon />
              <input
                id="search-input"
                type="search"
                name="search"
                autoComplete="off"
                className="control-input"
                placeholder="REC-1064, LOC-101..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="reason-select">
              Reason
            </label>
            <div className="select-wrap">
              <select
                id="reason-select"
                name="reason"
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
              <ChevronDownIcon />
            </div>
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="sort-select">
              Sort by value
            </label>
            <div className="select-wrap">
              <select
                id="sort-select"
                name="sort"
                className="control-select"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
              >
                <option value="value_desc">Highest value first</option>
                <option value="value_asc">Lowest value first</option>
                <option value="">Record ID (A–Z)</option>
              </select>
              <ChevronDownIcon />
            </div>
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
            <div className="skeleton-wrap" role="status" aria-label="Loading disagreements">
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
              <p className="empty-title">
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
                        aria-label={`Inspect ${row.record_id} (${row.reason_label})`}
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
                          <div className="detail-cell">
                            <span className="detail-text">{row.detail}</span>
                            <span className="inspect-cue" aria-hidden="true">
                              Inspect
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {activeRow && (
        <div
          className="drawer-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeInspector();
          }}
        >
          <aside
            ref={drawerRef}
            className="drawer-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="drawer-title"
          >
            <div className="drawer-header">
              <div>
                <div className="drawer-eyebrow mono">
                  {selectedOrg} · {activeRow.location_id}
                </div>
                <div className="drawer-title-row">
                  <h2 id="drawer-title" className="drawer-title mono">
                    {activeRow.record_id}
                  </h2>
                  <CopyIdButton value={activeRow.record_id} />
                </div>
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

            <p className="drawer-detail">{activeRow.detail}</p>

            <div className="drawer-grid">
              <div className="compare-box">
                <div className="compare-box-label">System A</div>
                <div className="compare-box-value mono tabular">
                  {activeRow.system_a_value ?? '-'}
                </div>
                <div className="val-raw mono">raw: {activeRow.system_a_raw || '(none)'}</div>
              </div>
              <div className="compare-box">
                <div className="compare-box-label">System B</div>
                <div className="compare-box-value mono tabular">
                  {activeRow.system_b_value ?? '-'}
                </div>
                <div className="val-raw mono">raw: {activeRow.system_b_raw || '(none)'}</div>
              </div>
            </div>

            <div className="compare-box">
              <div className="compare-box-label">Location and Tenant Scope</div>
              <div className="compare-box-primary">
                {activeRow.location_name} ({activeRow.location_id})
              </div>
              <div className="compare-box-note">
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
