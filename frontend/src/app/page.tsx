'use client';

import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { InspectorDrawer } from '../components/InspectorDrawer';
import { KnowledgeBaseDrawer } from '../components/KnowledgeBaseDrawer';
import {
  BookOpenIcon,
  ChevronDownIcon,
  CopyIdButton,
  DotsHorizontalIcon,
  RefreshIcon,
  SearchIcon,
  SegmentBar,
  ShareExportIcon,
  SortIndicator,
  ValueCell,
} from '../components/ui';
import {
  API_BASE,
  buildDisagreementsCsv,
  formatMoney,
  getReasonTone,
  getSecondaryTag,
  THEME_KEY,
  toPaise,
  type Disagreement,
  type ReasonOption,
  type SortKey,
  type TagTone,
} from '../lib/reconcile';

function compareNullableAmount(
  aVal: string | null,
  bVal: string | null,
  dir: 1 | -1,
  aId: string,
  bId: string,
): number {
  const aPaise = toPaise(aVal);
  const bPaise = toPaise(bVal);
  if (aPaise === null && bPaise === null) return aId.localeCompare(bId);
  if (aPaise === null) return 1;
  if (bPaise === null) return -1;
  if (aPaise !== bPaise) return (aPaise - bPaise) * dir;
  return aId.localeCompare(bId);
}

function formatFetchError(err: unknown): string {
  return err instanceof Error ? `${err.message} (${API_BASE})` : `Unable to reach ${API_BASE}`;
}

export default function DisagreementsPage() {
  const [orgs, setOrgs] = useState<string[]>([]);
  const [reasons, setReasons] = useState<ReasonOption[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<string>('');
  const [selectedReason, setSelectedReason] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<SortKey>('value_desc');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [rows, setRows] = useState<Disagreement[]>([]);
  const [orgTotalCount, setOrgTotalCount] = useState<number>(0);
  const [orgMaxSortValue, setOrgMaxSortValue] = useState<number>(0);
  const [orgReasonCounts, setOrgReasonCounts] = useState<Record<string, number>>({});
  const [hasLoadedRows, setHasLoadedRows] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activeRow, setActiveRow] = useState<Disagreement | null>(null);
  const [kbOpen, setKbOpen] = useState<boolean>(false);
  const [renderBatch, setRenderBatch] = useState<number>(0);
  const [reloadKey, setReloadKey] = useState<number>(0);
  const [isDark, setIsDark] = useState<boolean>(true);
  const [themeMoved, setThemeMoved] = useState<boolean>(false);

  const drawerRef = useRef<HTMLElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const lastTriggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      const dark = saved !== 'light';
      setIsDark(dark);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    } catch {
      setIsDark(true);
    }
  }, []);

  const applyThemeDom = (dark: boolean) => {
    const mode = dark ? 'dark' : 'light';
    document.documentElement.dataset.theme = mode;
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.setAttribute('content', mode);
    try {
      localStorage.setItem(THEME_KEY, mode);
    } catch {}
  };

  const toggleTheme = (e: MouseEvent<HTMLButtonElement>) => {
    const nextDark = !isDark;
    setThemeMoved(true);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const docWithTransition = document as Document & {
      startViewTransition?: (cb: () => void) => { ready: Promise<void> };
    };

    if (!docWithTransition.startViewTransition || reduce) {
      applyThemeDom(nextDark);
      setIsDark(nextDark);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );

    const transition = docWithTransition.startViewTransition(() => {
      applyThemeDom(nextDark);
      flushSync(() => {
        setIsDark(nextDark);
      });
    });

    transition.ready
      .then(() => {
        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${radius}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration: 500,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            pseudoElement: '::view-transition-new(root)',
          },
        );
      })
      .catch(() => {});
  };

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
        setError(formatFetchError(err));
      });

    return () => controller.abort();
  }, [reloadKey]);

  const backendSort =
    sortOrder === 'value_desc' || sortOrder === 'value_asc' ? sortOrder : '';

  useEffect(() => {
    if (!selectedOrg) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setActiveRow(null);

    const params = new URLSearchParams({ org: selectedOrg });
    if (selectedReason) params.set('reason', selectedReason);
    if (backendSort) params.set('sort', backendSort);

    fetch(`${API_BASE}/disagreements/?${params.toString()}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`API error (${res.status})`);
        return res.json();
      })
      .then((data) => {
        const fetched: Disagreement[] = data.disagreements || [];
        setRows(fetched);
        setOrgTotalCount(
          typeof data.total_org_count === 'number' ? data.total_org_count : fetched.length,
        );
        setOrgMaxSortValue(
          data.org_max_sort_value ? Number(data.org_max_sort_value) : 0,
        );
        setOrgReasonCounts(
          data.reason_counts && typeof data.reason_counts === 'object' ? data.reason_counts : {},
        );
        setHasLoadedRows(true);
        setRenderBatch((n) => n + 1);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(formatFetchError(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [selectedOrg, selectedReason, backendSort, reloadKey]);

  useEffect(() => {
    if (!activeRow && !kbOpen) return;
    closeBtnRef.current?.focus();

    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveRow(null);
        setKbOpen(false);
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
  }, [activeRow, kbOpen]);

  const visibleRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = q
      ? rows.filter(
          (r) =>
            r.record_id.toLowerCase().includes(q) ||
            r.location_id.toLowerCase().includes(q) ||
            r.location_name.toLowerCase().includes(q) ||
            r.reason_label.toLowerCase().includes(q) ||
            r.detail.toLowerCase().includes(q),
        )
      : [...rows];

    if (sortOrder === 'id_asc') {
      filtered.sort((a, b) => a.record_id.localeCompare(b.record_id));
    } else if (sortOrder === 'id_desc') {
      filtered.sort((a, b) => b.record_id.localeCompare(a.record_id));
    } else if (sortOrder === 'sys_a_desc' || sortOrder === 'sys_a_asc') {
      const dir = sortOrder === 'sys_a_desc' ? -1 : 1;
      filtered.sort((a, b) =>
        compareNullableAmount(a.system_a_value, b.system_a_value, dir, a.record_id, b.record_id),
      );
    } else if (sortOrder === 'sys_b_desc' || sortOrder === 'sys_b_asc') {
      const dir = sortOrder === 'sys_b_desc' ? -1 : 1;
      filtered.sort((a, b) =>
        compareNullableAmount(a.system_b_value, b.system_b_value, dir, a.record_id, b.record_id),
      );
    }

    return filtered;
  }, [rows, searchQuery, sortOrder]);

  const metrics = useMemo(() => {
    const orgDenom = Math.max(1, orgTotalCount);
    const valueCount = orgReasonCounts.VALUE_MISMATCH || 0;
    const missingCount = orgReasonCounts.MISSING_IN_B || 0;
    const tenantCount = orgReasonCounts.TENANT_MISMATCH || 0;

    let sumAPaise = 0;
    let sumBPaise = 0;
    let viewMax = 0;
    for (const r of visibleRows) {
      const aPaise = toPaise(r.system_a_value);
      if (aPaise !== null) sumAPaise += aPaise;
      const bPaise = toPaise(r.system_b_value);
      if (bPaise !== null) sumBPaise += bPaise;
      const sv = Number(r.sort_value);
      if (Number.isFinite(sv) && sv > viewMax) viewMax = sv;
    }

    return {
      orgTotal: orgTotalCount,
      valueCount,
      missingCount,
      tenantCount,
      valuePct: (valueCount / orgDenom) * 100,
      missingPct: (missingCount / orgDenom) * 100,
      tenantPct: (tenantCount / orgDenom) * 100,
      sumA: sumAPaise / 100,
      sumB: sumBPaise / 100,
      magnitudeDenominator: orgMaxSortValue > 0 ? orgMaxSortValue : viewMax,
    };
  }, [visibleRows, orgTotalCount, orgMaxSortValue, orgReasonCounts]);

  const kpiCards: ReadonlyArray<{
    reason: string;
    label: string;
    tag: string;
    tone: TagTone;
    count: number;
    pct: number;
  }> = [
    {
      reason: '',
      label: 'Org Disagreements',
      tag: 'All reasons',
      tone: 'green',
      count: metrics.orgTotal,
      pct: metrics.orgTotal > 0 ? 100 : 0,
    },
    {
      reason: 'VALUE_MISMATCH',
      label: 'Value Mismatches',
      tag: 'Delta',
      tone: 'blue',
      count: metrics.valueCount,
      pct: metrics.valuePct,
    },
    {
      reason: 'MISSING_IN_B',
      label: 'Missing in System B',
      tag: 'Unmatched',
      tone: 'amber',
      count: metrics.missingCount,
      pct: metrics.missingPct,
    },
    {
      reason: 'TENANT_MISMATCH',
      label: 'Cross-Tenant Alerts',
      tag: 'Boundary',
      tone: 'red',
      count: metrics.tenantCount,
      pct: metrics.tenantPct,
    },
  ];

  const selectedOrgIndex = Math.max(0, orgs.indexOf(selectedOrg));
  const hasFilters = Boolean(selectedReason || searchQuery.trim() || sortOrder !== 'value_desc');

  const resetFilters = () => {
    setSelectedReason('');
    setSearchQuery('');
    setSortOrder('value_desc');
  };

  const toggleHeaderSort = (column: 'id' | 'sys_a' | 'sys_b' | 'magnitude') => {
    if (column === 'id') {
      setSortOrder((prev) => (prev === 'id_asc' ? 'id_desc' : 'id_asc'));
    } else if (column === 'sys_a') {
      setSortOrder((prev) => (prev === 'sys_a_desc' ? 'sys_a_asc' : 'sys_a_desc'));
    } else if (column === 'sys_b') {
      setSortOrder((prev) => (prev === 'sys_b_desc' ? 'sys_b_asc' : 'sys_b_desc'));
    } else {
      setSortOrder((prev) => (prev === 'value_desc' ? 'value_asc' : 'value_desc'));
    }
  };

  const openInspector = (row: Disagreement, trigger: HTMLElement) => {
    lastTriggerRef.current = trigger;
    setKbOpen(false);
    setActiveRow(row);
  };

  const closeInspector = () => {
    setActiveRow(null);
    lastTriggerRef.current?.focus();
  };

  const openKnowledgeBase = (trigger: HTMLElement) => {
    lastTriggerRef.current = trigger;
    setActiveRow(null);
    setKbOpen(true);
  };

  const closeKnowledgeBase = () => {
    setKbOpen(false);
    lastTriggerRef.current?.focus();
  };

  const handleRowKeyDown = (e: KeyboardEvent<HTMLTableRowElement>, row: Disagreement) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openInspector(row, e.currentTarget);
    }
  };

  const exportCsv = () => {
    const csv = buildDisagreementsCsv(selectedOrg, visibleRows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `disagreements-${selectedOrg || 'org'}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <main className="crm-shell">
      <div className="crm-main" inert={activeRow || kbOpen ? true : undefined}>
        <header className="crm-header">
          <div className="crm-header-left">
            <div className="crm-title-row">
              <h1 className="crm-title">System A and System B Disagreements</h1>
              <span className="crm-status-pill">
                <span className="crm-status-dot" aria-hidden="true" />
                <span>Active</span>
              </span>
            </div>
            <p className="crm-subtitle">
              Reconciles imported event totals (INR ₹), dates, and references strictly inside the selected org boundary.
            </p>
          </div>

          <div className="crm-header-right">
            <span className="scope-badge">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                <path
                  d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              <span>Scoped to</span>
              <strong>{selectedOrg || '...'}</strong>
            </span>

            <div className="org-segmented" role="group" aria-label="Select organization">
              {orgs.length > 0 && (
                <span
                  className="org-segmented-indicator"
                  aria-hidden="true"
                  style={{
                    width: `calc((100% - 6px) / ${orgs.length})`,
                    transform: `translateX(${selectedOrgIndex * 100}%)`,
                  }}
                />
              )}
              {orgs.length === 0 ? (
                <button type="button" className="org-segmented-btn" disabled>
                  Loading...
                </button>
              ) : (
                orgs.map((org) => (
                  <button
                    key={org}
                    type="button"
                    className="org-segmented-btn"
                    aria-pressed={selectedOrg === org}
                    onClick={() => setSelectedOrg(org)}
                  >
                    {org}
                  </button>
                ))
              )}
            </div>

            <button
              type="button"
              className="theme-toggle"
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              onClick={toggleTheme}
            >
              <svg
                className={`${isDark ? 'theme-icon hide' : 'theme-icon'}${themeMoved ? ' anim' : ''}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
              </svg>
              <svg
                className={`${isDark ? 'theme-icon' : 'theme-icon hide'}${themeMoved ? ' anim' : ''}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
              </svg>
            </button>
          </div>
        </header>

        <section className="kpi-strip" aria-label="Disagreement summary metrics">
          {kpiCards.map((card) => (
            <button
              key={card.label}
              type="button"
              className="kpi-cell"
              data-active={selectedReason === card.reason ? 'true' : 'false'}
              onClick={() =>
                setSelectedReason((prev) => (card.reason && prev === card.reason ? '' : card.reason))
              }
            >
              <div className="kpi-top">
                <span className="kpi-label">{card.label}</span>
                <span className="crm-tag crm-tag-sm" data-tone={card.tone}>
                  {card.tag}
                </span>
              </div>
              <div className="kpi-bottom">
                <span className="kpi-value tabular">{card.count}</span>
                <SegmentBar percent={card.pct} tone="auto" />
              </div>
            </button>
          ))}
        </section>

        <section className="crm-toolbar" aria-label="Filter and sort controls">
          <div className="toolbar-filters">
            <div className="filter-pill">
              <label className="filter-pill-label" htmlFor="sort-select">
                Sort by
              </label>
              <span className="filter-pill-divider" aria-hidden="true" />
              <div className="filter-pill-select-wrap">
                <select
                  id="sort-select"
                  name="sort"
                  className="filter-pill-select"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value as SortKey)}
                >
                  <option value="value_desc">Highest Value</option>
                  <option value="value_asc">Lowest Value</option>
                  <option value="id_asc">Record ID (A-Z)</option>
                  <option value="id_desc">Record ID (Z-A)</option>
                  <option value="sys_a_desc">System A (High-Low)</option>
                  <option value="sys_a_asc">System A (Low-High)</option>
                  <option value="sys_b_desc">System B (High-Low)</option>
                  <option value="sys_b_asc">System B (Low-High)</option>
                </select>
                <ChevronDownIcon />
              </div>
            </div>

            <div className="filter-pill">
              <label className="filter-pill-label" htmlFor="reason-select">
                Reason
              </label>
              <span className="filter-pill-divider" aria-hidden="true" />
              <div className="filter-pill-select-wrap">
                <select
                  id="reason-select"
                  name="reason"
                  className="filter-pill-select"
                  value={selectedReason}
                  onChange={(e) => setSelectedReason(e.target.value)}
                >
                  <option value="">All Reasons</option>
                  {reasons.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <ChevronDownIcon />
              </div>
            </div>

            <div className="search-pill">
              <SearchIcon />
              <input
                id="search-input"
                type="search"
                name="search"
                aria-label="Search record or location"
                autoComplete="off"
                className="search-pill-input"
                placeholder="Filter REC-1064, LOC-101..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="search-clear-btn"
                  aria-label="Clear search query"
                  onClick={() => setSearchQuery('')}
                >
                  ×
                </button>
              )}
            </div>

            {hasFilters && (
              <button type="button" className="crm-btn crm-btn-ghost" onClick={resetFilters}>
                Reset
              </button>
            )}
          </div>

          <div className="toolbar-actions">
            <button
              type="button"
              className="crm-btn crm-btn-secondary"
              onClick={(e) => openKnowledgeBase(e.currentTarget)}
            >
              <BookOpenIcon />
              <span>Knowledge Base</span>
            </button>
            <button
              type="button"
              className="crm-btn crm-btn-secondary"
              onClick={exportCsv}
              disabled={visibleRows.length === 0}
            >
              <ShareExportIcon />
              <span>Export</span>
            </button>
            <button
              type="button"
              className="crm-btn crm-btn-primary"
              onClick={() => setReloadKey((k) => k + 1)}
            >
              <RefreshIcon />
              <span>Refresh Data</span>
            </button>
          </div>
        </section>

        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button
              type="button"
              className="crm-btn crm-btn-secondary"
              onClick={() => setReloadKey((k) => k + 1)}
            >
              Retry
            </button>
          </div>
        )}

        <section className="table-region" aria-label="Disagreements table">
          {!hasLoadedRows && loading ? (
            <div className="skeleton-wrap" role="status" aria-label="Loading disagreements">
              {[0, 1, 2, 3, 4, 5].map((idx) => (
                <div
                  key={idx}
                  className="skeleton-line"
                  style={{ width: `${96 - idx * 6}%` }}
                />
              ))}
            </div>
          ) : visibleRows.length === 0 ? (
            <div className="empty-state">
              <p className="empty-title">
                No disagreements match the current filters for {selectedOrg || 'this org'}.
              </p>
              {hasFilters && (
                <button type="button" className="crm-btn crm-btn-secondary" onClick={resetFilters}>
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <div className="table-scroll" data-refreshing={loading ? 'true' : 'false'}>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>
                      <button
                        type="button"
                        className="th-sort-btn"
                        data-active={sortOrder === 'id_asc' || sortOrder === 'id_desc' ? 'true' : 'false'}
                        onClick={() => toggleHeaderSort('id')}
                      >
                        <span>Record ID</span>
                        <SortIndicator
                          dir={sortOrder === 'id_asc' ? 'asc' : sortOrder === 'id_desc' ? 'desc' : null}
                        />
                      </button>
                    </th>
                    <th>Location</th>
                    <th>Reason &amp; Stage</th>
                    <th className="num">
                      <button
                        type="button"
                        className="th-sort-btn th-sort-btn-num"
                        data-active={
                          sortOrder === 'sys_a_asc' || sortOrder === 'sys_a_desc' ? 'true' : 'false'
                        }
                        onClick={() => toggleHeaderSort('sys_a')}
                      >
                        <span>System A Value</span>
                        <SortIndicator
                          dir={
                            sortOrder === 'sys_a_asc'
                              ? 'asc'
                              : sortOrder === 'sys_a_desc'
                                ? 'desc'
                                : null
                          }
                        />
                      </button>
                    </th>
                    <th className="num">
                      <button
                        type="button"
                        className="th-sort-btn th-sort-btn-num"
                        data-active={
                          sortOrder === 'sys_b_asc' || sortOrder === 'sys_b_desc' ? 'true' : 'false'
                        }
                        onClick={() => toggleHeaderSort('sys_b')}
                      >
                        <span>System B Value</span>
                        <SortIndicator
                          dir={
                            sortOrder === 'sys_b_asc'
                              ? 'asc'
                              : sortOrder === 'sys_b_desc'
                                ? 'desc'
                                : null
                          }
                        />
                      </button>
                    </th>
                    <th className="num">
                      <button
                        type="button"
                        className="th-sort-btn th-sort-btn-num"
                        data-active={
                          sortOrder === 'value_desc' || sortOrder === 'value_asc' ? 'true' : 'false'
                        }
                        onClick={() => toggleHeaderSort('magnitude')}
                      >
                        <span>Relative Magnitude</span>
                        <SortIndicator
                          dir={
                            sortOrder === 'value_asc'
                              ? 'asc'
                              : sortOrder === 'value_desc'
                                ? 'desc'
                                : null
                          }
                        />
                      </button>
                    </th>
                    <th>Diagnostic Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row, idx) => {
                    const tone = getReasonTone(row.reason);
                    const secondary = getSecondaryTag(row);
                    const bEntryKey = row.system_b_rows.map((e) => e.entry_id).join(',');
                    const rowKey = `${row.record_id}-${row.reason}-${row.system_a_row ?? 'na'}-${bEntryKey || row.system_b_raw}`;
                    const isSelected =
                      activeRow?.record_id === row.record_id &&
                      activeRow?.reason === row.reason &&
                      activeRow?.system_a_row === row.system_a_row &&
                      activeRow?.system_b_raw === row.system_b_raw;
                    const delay = Math.min(idx, 8) * 24;
                    const rowSortNum = Number(row.sort_value) || 0;
                    const exposurePct =
                      metrics.magnitudeDenominator > 0
                        ? Math.round((rowSortNum / metrics.magnitudeDenominator) * 100)
                        : 0;

                    return (
                      <tr
                        key={`${renderBatch}-${rowKey}`}
                        className="crm-row row-stagger"
                        style={{ '--row-delay': `${delay}ms` } as CSSProperties}
                        tabIndex={0}
                        aria-label={`Inspect ${row.record_id} (${row.reason_label})`}
                        data-selected={isSelected ? 'true' : 'false'}
                        onClick={(e) => openInspector(row, e.currentTarget)}
                        onKeyDown={(e) => handleRowKeyDown(e, row)}
                      >
                        <td data-label="Record ID">
                          <div className="record-cell">
                            <span className="record-id">{row.record_id}</span>
                            <CopyIdButton value={row.record_id} />
                          </div>
                        </td>
                        <td data-label="Location">
                          <div className="location-cell">
                            <span className="location-name">{row.location_name}</span>
                            <span className="crm-tag crm-tag-sm" data-tone="neutral">
                              {row.location_id}
                            </span>
                          </div>
                        </td>
                        <td data-label="Reason & Stage">
                          <span className="crm-tag-row">
                            <span className="crm-tag" data-tone={tone}>
                              {row.reason_label}
                            </span>
                            <span className="crm-tag" data-tone={secondary.tone}>
                              {secondary.label}
                            </span>
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
                        <td className="num tabular" data-label="Relative Magnitude">
                          <span className="exposure-cell">
                            <SegmentBar percent={exposurePct} tone="auto" />
                            <span className="exposure-pct">{exposurePct}%</span>
                          </span>
                        </td>
                        <td data-label="Diagnostic Detail">
                          <div className="detail-cell">
                            <span className="detail-text">{row.detail}</span>
                            <button
                              type="button"
                              className="action-dots-btn"
                              tabIndex={-1}
                              aria-label={`Open ${row.record_id} inspector`}
                              onClick={(e) => {
                                e.stopPropagation();
                                openInspector(row, e.currentTarget);
                              }}
                            >
                              <DotsHorizontalIcon />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <footer className="table-footer" role="status" aria-live="polite">
            <div className="footer-cell tabular">
              <strong>{visibleRows.length}</strong>
              <span>
                of {metrics.orgTotal} Disagreement{metrics.orgTotal === 1 ? '' : 's'}
              </span>
            </div>
            <div className="footer-cell tabular">
              <span>+ Sum of System A</span>
              <strong>₹{formatMoney(metrics.sumA)}</strong>
            </div>
            <div className="footer-cell tabular">
              <span>+ Sum of System B</span>
              <strong>₹{formatMoney(metrics.sumB)}</strong>
            </div>
            <div className="footer-cell tabular">
              <span>+ Org Max Magnitude</span>
              <strong>₹{formatMoney(metrics.magnitudeDenominator)}</strong>
            </div>
          </footer>
        </section>
      </div>

      {activeRow && (
        <InspectorDrawer
          row={activeRow}
          selectedOrg={selectedOrg}
          drawerRef={drawerRef}
          closeBtnRef={closeBtnRef}
          onClose={closeInspector}
        />
      )}

      {kbOpen && (
        <KnowledgeBaseDrawer
          selectedOrg={selectedOrg}
          drawerRef={drawerRef}
          closeBtnRef={closeBtnRef}
          onClose={closeKnowledgeBase}
        />
      )}
    </main>
  );
}
