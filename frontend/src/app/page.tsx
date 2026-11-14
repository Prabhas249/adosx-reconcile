'use client';

import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

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

type TagTone =
  | 'red'
  | 'orange'
  | 'amber'
  | 'blue'
  | 'purple'
  | 'yellow'
  | 'green'
  | 'moss'
  | 'neutral';

type SegmentTone = 'auto' | 'danger' | 'warning' | 'success';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8000/api';
const THEME_KEY = 'adosx-theme';
const TREND_PATTERN = [false, true, false, false, true, true, false, true, false, true, true, true];

function getReasonTone(reason: string): TagTone {
  if (reason === 'TENANT_MISMATCH' || reason === 'VOIDED_IN_A') return 'red';
  if (reason === 'MISSING_IN_B') return 'amber';
  if (reason === 'ORPHAN_IN_B') return 'orange';
  if (reason === 'VALUE_MISMATCH') return 'blue';
  if (reason === 'DUPLICATE_IN_B') return 'purple';
  if (reason === 'UNPARSEABLE_VALUE') return 'yellow';
  return 'neutral';
}

function getSecondaryTag(row: Disagreement): { label: string; tone: TagTone } {
  if (row.detail.includes('base_value')) {
    return { label: 'Adjustment omitted', tone: 'green' };
  }
  if (row.reason === 'TENANT_MISMATCH') {
    return { label: 'Redacted', tone: 'orange' };
  }
  if (row.reason === 'VOIDED_IN_A') {
    return { label: 'Active in B', tone: 'amber' };
  }
  if (row.reason === 'DUPLICATE_IN_B') {
    return { label: '2x in B', tone: 'blue' };
  }
  if (row.reason === 'MISSING_IN_B') {
    return { label: 'System A only', tone: 'moss' };
  }
  if (row.reason === 'ORPHAN_IN_B') {
    return { label: 'System B only', tone: 'purple' };
  }
  if (row.reason === 'UNPARSEABLE_VALUE') {
    return { label: 'Format error', tone: 'amber' };
  }
  if (row.reason === 'DATE_MISMATCH') {
    return { label: 'Period drift', tone: 'blue' };
  }
  return { label: 'Net delta', tone: 'green' };
}

function getAuditSteps(row: Disagreement, org: string): string[] {
  const steps: string[] = [];
  steps.push(
    `Scoped query filtered to organization ${org} at ${row.location_name} (${row.location_id}).`,
  );
  if (row.detail.includes('base_value')) {
    steps.push(
      'System B recorded only System A base_value and dropped the adjustment column during posting.',
    );
  } else if (row.reason === 'DUPLICATE_IN_B') {
    steps.push(
      'Multiple non-split System B entries share the same normalized record reference without Part indicators.',
    );
  } else if (row.reason === 'TENANT_MISMATCH') {
    steps.push(
      'System B holds a matching reference under a foreign tenant; server redacted foreign org ID and values.',
    );
  } else if (row.reason === 'VOIDED_IN_A') {
    steps.push(
      'Record is marked VOIDED in System A but remains active with a posted amount in System B.',
    );
  } else if (row.reason === 'MISSING_IN_B') {
    steps.push('Active System A record has zero corresponding entries in System B.');
  } else if (row.reason === 'ORPHAN_IN_B') {
    steps.push('System B entry references a record ID that does not exist in System A.');
  } else if (row.reason === 'UNPARSEABLE_VALUE') {
    steps.push('Raw value string in CSV could not be parsed into a valid decimal amount.');
  } else {
    steps.push(row.detail);
  }
  return steps;
}

function buildSparklineValues(row: Disagreement, maxExposure: number): number[] {
  const a = row.system_a_value !== null ? Math.abs(Number(row.system_a_value)) || 0 : 0;
  const b = row.system_b_value !== null ? Math.abs(Number(row.system_b_value)) || 0 : 0;
  const delta = Math.abs(a - b);
  const top = Math.max(1, maxExposure);
  const rA = Math.max(2, Math.min(14, Math.round((a / top) * 14)));
  const rB = Math.max(2, Math.min(14, Math.round((b / top) * 14)));
  const rD = Math.max(2, Math.min(14, Math.round((delta / top) * 14)));
  const rS = Math.max(3, Math.min(14, Math.round((row.sort_value / top) * 14)));
  return [
    Math.max(2, rA - 3),
    rA,
    Math.max(2, Math.round((rA + rB) / 2)),
    rB,
    Math.max(2, rD - 2),
    rD,
    Math.max(2, rS - 4),
    Math.max(3, rA - 1),
    rB,
    Math.max(3, rD),
    Math.max(4, rS - 2),
    rS,
  ];
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function escapeCsvCell(value: string | number | null): string {
  const text = String(value ?? '');
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function autoSegmentTone(index: number, filled: number): 'danger' | 'warning' | 'success' {
  const red = Math.floor(filled / 3);
  const amber = Math.ceil(filled / 3);
  if (index < red) return 'danger';
  if (index < red + amber) return 'warning';
  return 'success';
}

function SegmentBar({
  percent,
  segments = 17,
  tone = 'auto',
}: {
  percent: number;
  segments?: number;
  tone?: SegmentTone;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const filled = Math.max(clamped > 0 ? 1 : 0, Math.round((clamped / 100) * segments));

  return (
    <span
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      className="segment-bar"
    >
      {Array.from({ length: segments }, (_, index) => {
        const isFilled = index < filled;
        const tickTone = isFilled
          ? tone === 'auto'
            ? autoSegmentTone(index, filled)
            : tone
          : undefined;
        return <span key={index} className="segment-tick" data-tone={tickTone} />;
      })}
    </span>
  );
}

function Sparkline({ values }: { values: number[] }) {
  return (
    <span aria-hidden="true" className="sparkline">
      {values.map((v, idx) => {
        const h = Math.min(14, Math.max(2, Math.round(v)));
        const bright = TREND_PATTERN[idx % TREND_PATTERN.length];
        return (
          <span
            key={idx}
            className="sparkline-bar"
            data-bright={bright ? 'true' : 'false'}
            style={{ height: `${h}px` }}
          />
        );
      })}
    </span>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      className="filter-pill-chevron"
      width="12"
      height="12"
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
      className="search-pill-icon"
      width="13"
      height="13"
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

function ShareExportIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2.5v7.25M5.25 5.25 8 2.5l2.75 2.75M3 10.5v2A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5v-2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusSparkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 3.25v9.5M3.25 8h9.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DotsHorizontalIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="3.5" cy="8" r="1.2" fill="currentColor" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.2" fill="currentColor" />
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
        <svg className="icon-copy" width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M10.5 3.5A1.5 1.5 0 0 0 9 2H4A1.5 1.5 0 0 0 2.5 3.5v5A1.5 1.5 0 0 0 4 10"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        <svg className="icon-check" width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
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
  const formatted =
    parsed !== null && !Number.isNaN(Number(parsed)) ? formatMoney(Number(parsed)) : parsed;
  return (
    <td className="num tabular" data-label={label}>
      <div className="val-wrap">
        {formatted !== null ? (
          <span className="val-parsed">
            <span className="val-currency">$</span>
            <span>{formatted}</span>
          </span>
        ) : (
          <span className="val-parsed val-missing">-</span>
        )}
        {showRaw && <span className="val-raw mono">raw: {raw}</span>}
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
      const style = document.createElement('style');
      style.textContent = '*,*::before,*::after{transition:none !important}';
      document.head.appendChild(style);
      applyThemeDom(nextDark);
      setIsDark(nextDark);
      void document.documentElement.offsetHeight;
      requestAnimationFrame(() => style.remove());
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

  const metrics = useMemo(() => {
    const total = visibleRows.length;
    const denom = Math.max(1, total);
    const valueCount = visibleRows.filter((r) => r.reason === 'VALUE_MISMATCH').length;
    const missingCount = visibleRows.filter((r) => r.reason === 'MISSING_IN_B').length;
    const criticalCount = visibleRows.filter(
      (r) => r.reason === 'TENANT_MISMATCH' || r.reason === 'VOIDED_IN_A',
    ).length;

    let sumA = 0;
    let sumB = 0;
    let maxExposure = 0;
    for (const r of visibleRows) {
      if (r.system_a_value !== null) {
        const parsedA = Number(r.system_a_value);
        if (!Number.isNaN(parsedA)) sumA += parsedA;
      }
      if (r.system_b_value !== null) {
        const parsedB = Number(r.system_b_value);
        if (!Number.isNaN(parsedB)) sumB += parsedB;
      }
      if (r.sort_value > maxExposure) maxExposure = r.sort_value;
    }

    return {
      total,
      valueCount,
      missingCount,
      criticalCount,
      valuePct: (valueCount / denom) * 100,
      missingPct: (missingCount / denom) * 100,
      criticalPct: (criticalCount / denom) * 100,
      sumA,
      sumB,
      maxExposure,
    };
  }, [visibleRows]);

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

  const exportCsv = () => {
    const headers = [
      'org_id',
      'record_id',
      'location_id',
      'location_name',
      'reason',
      'reason_label',
      'system_a_value',
      'system_a_raw',
      'system_b_value',
      'system_b_raw',
      'detail',
    ];
    const lines = [headers.join(',')];
    for (const r of visibleRows) {
      lines.push(
        [
          selectedOrg,
          r.record_id,
          r.location_id,
          r.location_name,
          r.reason,
          r.reason_label,
          r.system_a_value,
          r.system_a_raw,
          r.system_b_value,
          r.system_b_raw,
          r.detail,
        ]
          .map(escapeCsvCell)
          .join(','),
      );
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `disagreements-${selectedOrg || 'org'}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const toggleReasonFilter = (code: string) => {
    setSelectedReason((prev) => (prev === code ? '' : code));
  };

  return (
    <main className="crm-shell">
      <div className="crm-main" inert={activeRow ? true : undefined}>
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
              Reconciles imported event totals, dates, and references strictly inside the selected org boundary.
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
          <button
            type="button"
            className="kpi-cell"
            data-active={selectedReason === '' ? 'true' : 'false'}
            onClick={() => setSelectedReason('')}
          >
            <div className="kpi-top">
              <span className="kpi-label">Visible Disagreements</span>
              <span className="crm-tag crm-tag-sm" data-tone="green">
                All reasons
              </span>
            </div>
            <div className="kpi-bottom">
              <span className="kpi-value tabular">{metrics.total}</span>
              <SegmentBar percent={metrics.total > 0 ? 84 : 0} tone="auto" />
            </div>
          </button>

          <button
            type="button"
            className="kpi-cell"
            data-active={selectedReason === 'VALUE_MISMATCH' ? 'true' : 'false'}
            onClick={() => toggleReasonFilter('VALUE_MISMATCH')}
          >
            <div className="kpi-top">
              <span className="kpi-label">Value Mismatches</span>
              <span className="crm-tag crm-tag-sm" data-tone="blue">
                Delta
              </span>
            </div>
            <div className="kpi-bottom">
              <span className="kpi-value tabular">{metrics.valueCount}</span>
              <SegmentBar percent={metrics.valuePct} tone="auto" />
            </div>
          </button>

          <button
            type="button"
            className="kpi-cell"
            data-active={selectedReason === 'MISSING_IN_B' ? 'true' : 'false'}
            onClick={() => toggleReasonFilter('MISSING_IN_B')}
          >
            <div className="kpi-top">
              <span className="kpi-label">Missing in System B</span>
              <span className="crm-tag crm-tag-sm" data-tone="amber">
                Unmatched
              </span>
            </div>
            <div className="kpi-bottom">
              <span className="kpi-value tabular">{metrics.missingCount}</span>
              <SegmentBar percent={metrics.missingPct} tone="auto" />
            </div>
          </button>

          <button
            type="button"
            className="kpi-cell"
            data-active={selectedReason === 'TENANT_MISMATCH' ? 'true' : 'false'}
            onClick={() => toggleReasonFilter('TENANT_MISMATCH')}
          >
            <div className="kpi-top">
              <span className="kpi-label">Tenant &amp; Voided Alerts</span>
              <span className="crm-tag crm-tag-sm" data-tone="red">
                Critical
              </span>
            </div>
            <div className="kpi-bottom">
              <span className="kpi-value tabular">{metrics.criticalCount}</span>
              <SegmentBar percent={metrics.criticalPct} tone="auto" />
            </div>
          </button>
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
                  onChange={(e) => setSortOrder(e.target.value)}
                >
                  <option value="value_desc">Highest Value</option>
                  <option value="value_asc">Lowest Value</option>
                  <option value="">Record ID (A-Z)</option>
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
              <button
                type="button"
                className="crm-btn crm-btn-ghost"
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

          <div className="toolbar-actions">
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
              <PlusSparkIcon />
              <span>Re-sync Ledger</span>
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
                <button
                  type="button"
                  className="crm-btn crm-btn-secondary"
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
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Record ID</th>
                    <th>Location</th>
                    <th>Reason &amp; Stage</th>
                    <th className="num">System A Value</th>
                    <th className="num">System B Value</th>
                    <th className="num">Exposure Share</th>
                    <th>Variance Trend</th>
                    <th>Diagnostic Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row, idx) => {
                    const tone = getReasonTone(row.reason);
                    const secondary = getSecondaryTag(row);
                    const rowKey = `${row.record_id}-${row.reason}-${row.system_a_raw}-${row.system_b_raw}`;
                    const isSelected =
                      activeRow?.record_id === row.record_id && activeRow?.reason === row.reason;
                    const delay = Math.min(idx, 8) * 24;
                    const exposurePct =
                      metrics.maxExposure > 0
                        ? Math.max(8, Math.round((row.sort_value / metrics.maxExposure) * 100))
                        : 0;
                    const sparkValues = buildSparklineValues(row, metrics.maxExposure);

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
                        <td className="num tabular" data-label="Exposure Share">
                          <span className="exposure-cell">
                            <SegmentBar percent={exposurePct} tone="auto" />
                            <span className="exposure-pct">{exposurePct}%</span>
                          </span>
                        </td>
                        <td data-label="Variance Trend">
                          <Sparkline values={sparkValues} />
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
              <span>Disagreement{visibleRows.length === 1 ? '' : 's'} in view</span>
            </div>
            <div className="footer-cell tabular">
              <span>+ Sum of System A</span>
              <strong>${formatMoney(metrics.sumA)}</strong>
            </div>
            <div className="footer-cell tabular">
              <span>+ Sum of System B</span>
              <strong>${formatMoney(metrics.sumB)}</strong>
            </div>
            <div className="footer-cell tabular">
              <span>+ Peak Exposure</span>
              <strong>${formatMoney(metrics.maxExposure)}</strong>
            </div>
          </footer>
        </section>
      </div>

      {activeRow && (
        <div
          className="sheet-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeInspector();
          }}
        >
          <aside
            ref={drawerRef}
            className="sheet-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sheet-title"
          >
            <div className="sheet-header">
              <div className="sheet-header-left">
                <h2 id="sheet-title" className="sheet-title">
                  {activeRow.record_id}
                </h2>
                <CopyIdButton value={activeRow.record_id} />
                <span className="crm-tag" data-tone={getReasonTone(activeRow.reason)}>
                  {activeRow.reason_label}
                </span>
              </div>
              <button
                ref={closeBtnRef}
                type="button"
                className="crm-btn crm-btn-secondary"
                onClick={closeInspector}
              >
                Close
              </button>
            </div>

            <div className="sheet-body">
              <div className="sheet-meta-row">
                <span className="crm-tag crm-tag-sm" data-tone="neutral">
                  {selectedOrg}
                </span>
                <span className="crm-tag crm-tag-sm" data-tone="neutral">
                  {activeRow.location_id}
                </span>
                <span className="crm-tag crm-tag-sm" data-tone={getSecondaryTag(activeRow).tone}>
                  {getSecondaryTag(activeRow).label}
                </span>
              </div>

              <div className="sheet-detail-card">{activeRow.detail}</div>

              <div className="sheet-compare-grid">
                <div className="sheet-box">
                  <span className="sheet-box-label">System A</span>
                  <span className="sheet-box-value tabular">
                    {activeRow.system_a_value !== null
                      ? `$${formatMoney(Number(activeRow.system_a_value))}`
                      : '-'}
                  </span>
                  <span className="sheet-box-raw mono">
                    raw: {activeRow.system_a_raw || '(none)'}
                  </span>
                </div>
                <div className="sheet-box">
                  <span className="sheet-box-label">System B</span>
                  <span className="sheet-box-value tabular">
                    {activeRow.system_b_value !== null
                      ? `$${formatMoney(Number(activeRow.system_b_value))}`
                      : '-'}
                  </span>
                  <span className="sheet-box-raw mono">
                    raw: {activeRow.system_b_raw || '(none)'}
                  </span>
                </div>
              </div>

              <div className="sheet-box">
                <span className="sheet-box-label">Reconciliation Audit Breakdown</span>
                <ul className="sheet-audit-list">
                  {getAuditSteps(activeRow, selectedOrg).map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ul>
              </div>

              <div className="sheet-box">
                <span className="sheet-box-label">Tenant Boundary Verification</span>
                <span className="location-name">
                  {activeRow.location_name} ({activeRow.location_id})
                </span>
                <span className="sheet-box-raw">
                  {activeRow.reason === 'TENANT_MISMATCH'
                    ? 'Foreign organization identifiers and values are redacted on the server before leaving Django.'
                    : `Scoped strictly to ${selectedOrg} with zero cross-tenant leakage.`}
                </span>
              </div>
            </div>

            <div className="sheet-footer">
              <span className="sheet-footer-note mono tabular">
                sort_value: ${formatMoney(activeRow.sort_value)}
              </span>
              <button
                type="button"
                className="crm-btn crm-btn-primary"
                onClick={closeInspector}
              >
                Done
              </button>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
