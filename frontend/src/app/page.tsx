'use client';

import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

interface ProvenanceEntry {
  entry_id: string;
  row: number | null;
  raw_value: string;
  recorded_on: string | null;
}

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
  sort_value: string;
  system_a_base_value: string | null;
  system_a_adjustment: string | null;
  system_a_date: string | null;
  system_a_row: number | null;
  system_b_date: string | null;
  system_b_rows: ProvenanceEntry[];
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

type SortKey =
  | 'value_desc'
  | 'value_asc'
  | 'id_asc'
  | 'id_desc'
  | 'sys_a_desc'
  | 'sys_a_asc'
  | 'sys_b_desc'
  | 'sys_b_asc';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8000/api';
const THEME_KEY = 'adosx-theme';

function getReasonTone(reason: string): TagTone {
  if (reason === 'TENANT_MISMATCH' || reason === 'VOIDED_IN_A') return 'red';
  if (reason === 'MISSING_IN_B') return 'amber';
  if (reason === 'ORPHAN_IN_B') return 'orange';
  if (reason === 'VALUE_MISMATCH') return 'blue';
  if (reason === 'DUPLICATE_IN_B' || reason === 'MULTI_ENTRY_UNRESOLVED') return 'purple';
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
    const count = Math.max(2, row.system_b_rows.length);
    return { label: `${count}x in B`, tone: 'blue' };
  }
  if (row.reason === 'MULTI_ENTRY_UNRESOLVED') {
    return { label: `${row.system_b_rows.length} entries`, tone: 'amber' };
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
      'System B value equals System A base_value without the adjustment column (system_a.csv adjustment equals 28% of base_value).',
    );
  } else if (row.reason === 'DUPLICATE_IN_B') {
    steps.push(
      'Multiple System B entries normalize to the same record reference and repeat the posted amount.',
    );
  } else if (row.reason === 'MULTI_ENTRY_UNRESOLVED') {
    steps.push(
      'Multiple System B entries normalize to the same record reference, but their combined sum differs from System A total_value.',
    );
  } else if (row.reason === 'TENANT_MISMATCH') {
    steps.push(
      'A matching normalized reference exists under another organization; foreign identifiers and amounts were redacted on the server.',
    );
  } else if (row.reason === 'VOIDED_IN_A') {
    steps.push(
      'Record state is VOIDED in System A while System B still holds an active entry.',
    );
  } else if (row.reason === 'MISSING_IN_B') {
    steps.push('System A record has zero matching entries in System B for this organization.');
  } else if (row.reason === 'ORPHAN_IN_B') {
    steps.push('System B entry references a record ID that does not exist in System A.');
  } else if (row.reason === 'UNPARSEABLE_VALUE') {
    steps.push('Original CSV value cell was preserved with value_parse_error=True instead of being dropped.');
  } else {
    steps.push(row.detail);
  }
  return steps;
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
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

function SortIndicator({ dir }: { dir: 'asc' | 'desc' | null }) {
  return (
    <svg
      className="th-sort-icon"
      data-active={dir ? 'true' : 'false'}
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      {dir === 'asc' ? (
        <path
          d="M8 12.5V3.5M4.5 7 8 3.5 11.5 7"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : dir === 'desc' ? (
        <path
          d="M8 3.5v9M4.5 9 8 12.5 11.5 9"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M5.5 6 8 3.5 10.5 6M5.5 10 8 12.5 10.5 10"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
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

function RefreshIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13.25 8a5.25 5.25 0 1 1-1.3-3.46M13.25 2.5v2.75H10.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
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

function BookOpenIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.25 3.5A1.25 1.25 0 0 1 3.5 2.25h3.25A1.25 1.25 0 0 1 8 3.5v9.75a1 1 0 0 0-1-1H3.5a1.25 1.25 0 0 1-1.25-1.25V3.5ZM13.75 3.5a1.25 1.25 0 0 0-1.25-1.25H9.25A1.25 1.25 0 0 0 8 3.5v9.75a1 1 0 0 1 1-1h3.5a1.25 1.25 0 0 0 1.25-1.25V3.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type CopilotTopic = 'why' | 'math' | 'tenant' | 'fix';

function getCopilotAnswer(row: Disagreement, org: string, topic: CopilotTopic): string {
  const aFormatted =
    row.system_a_value !== null ? `₹${formatMoney(Number(row.system_a_value))}` : 'None';
  const bFormatted =
    row.system_b_value !== null ? `₹${formatMoney(Number(row.system_b_value))}` : 'None';
  const aNum = row.system_a_value !== null ? Number(row.system_a_value) : 0;
  const bNum = row.system_b_value !== null ? Number(row.system_b_value) : 0;
  const diff = Math.abs(aNum - bNum);

  if (topic === 'why') {
    if (row.detail.includes('base_value')) {
      return `System B's recorded value (${bFormatted}) matches System A's base_value, while System A's total_value (${aFormatted}) includes an adjustment of ₹${formatMoney(diff)} (28% of base_value). The CSV exports show the exact difference but do not specify which system is authoritative.`;
    }
    if (row.reason === 'DUPLICATE_IN_B') {
      return `System B contains ${row.system_b_rows.length || 2} entries for ${row.record_id} that repeat ${aFormatted} (summing to ${bFormatted}), unlike REC-1055 where two distinct partial amounts sum to System A's total.`;
    }
    if (row.reason === 'MULTI_ENTRY_UNRESOLVED') {
      return `System B contains ${row.system_b_rows.length} entries summing to ${bFormatted} against System A's ${aFormatted}; because the partial sum neither matches total_value nor repeats an identical posting, the relationship is flagged as unresolved.`;
    }
    if (row.reason === 'TENANT_MISMATCH') {
      return `${row.record_id} is mapped to ${row.location_name} (${row.location_id}) in ${org}, while a matching normalized reference exists under a location belonging to another organization.`;
    }
    if (row.reason === 'VOIDED_IN_A') {
      return `${row.record_id} has state VOIDED in System A, while System B still holds an active entry for ${bFormatted}.`;
    }
    if (row.reason === 'UNPARSEABLE_VALUE') {
      return `The CSV row was preserved during ingestion with value_parse_error=True because the raw value cell was blank or malformed (${row.system_b_raw || 'blank'}).`;
    }
    return row.detail;
  }

  if (topic === 'math') {
    if (row.system_a_base_value !== null && row.system_a_adjustment !== null) {
      const baseFmt = `₹${formatMoney(Number(row.system_a_base_value))}`;
      const adjFmt = `₹${formatMoney(Number(row.system_a_adjustment))}`;
      return `System A base_value: ${baseFmt} + adjustment: ${adjFmt} = total_value: ${aFormatted} | System B: ${bFormatted} | Absolute variance: ₹${formatMoney(diff)}.`;
    }
    return `System A: ${aFormatted} | System B: ${bFormatted} | Absolute variance: ₹${formatMoney(diff)} | Sort magnitude: ₹${formatMoney(Number(row.sort_value))}.`;
  }

  if (topic === 'tenant') {
    if (row.reason === 'TENANT_MISMATCH') {
      return `Isolation active: comparator.py checked cross-org IDs via values_list('normalized_record_ref', flat=True) with location__isnull=False and redacted foreign org IDs, row numbers, locations, and amounts before serialization.`;
    }
    return `Scoped to ${org} (${row.location_id} - ${row.location_name}) via .filter(location__org_id='${org}'). In production, ?org= would be replaced by an authenticated tenant session.`;
  }

  if (row.detail.includes('base_value')) {
    return `Verify the source documentation for ${row.record_id} at ${row.location_id} to confirm whether the adjustment should be included or excluded before updating either system.`;
  }
  if (row.reason === 'DUPLICATE_IN_B') {
    return `Inspect both System B source entries (${row.system_b_raw}) against source records to confirm whether one posting is an unintended duplicate before taking action.`;
  }
  if (row.reason === 'MULTI_ENTRY_UNRESOLVED') {
    return `Verify whether additional split entries for ${row.record_id} are missing from System B or whether one of the partial postings is inaccurate.`;
  }
  if (row.reason === 'VOIDED_IN_A') {
    return `Confirm whether ${row.record_id} was intentionally voided in System A or whether System B's active entry should be updated.`;
  }
  if (row.reason === 'MISSING_IN_B') {
    return `Check whether ${row.record_id} (${aFormatted}) failed to export to System B or was recorded in System A in error.`;
  }
  if (row.reason === 'ORPHAN_IN_B') {
    return `Inspect System B entry (${row.system_b_raw}) to check whether its record_ref was mistyped or whether the corresponding System A row is missing.`;
  }
  if (row.reason === 'DATE_MISMATCH') {
    return `Compare the event timestamp in System A (${row.system_a_date || 'unknown'}) against System B (${row.system_b_date || 'unknown'}) to confirm whether ${row.record_id} crossed a period boundary.`;
  }
  if (row.reason === 'TENANT_MISMATCH') {
    return `Escalate ${row.record_id} to an administrator authorized across organizations to verify location ownership (cross-org matching assumes record_id is globally unique).`;
  }
  return `Compare source records for both systems before modifying ${row.record_id} (neither system is treated as authoritative).`;
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
  const rawParts = showRaw ? raw.split(' + ').map((part) => part.trim()) : [];

  return (
    <td className="num tabular" data-label={label}>
      <div className="val-wrap">
        {formatted !== null ? (
          <span className="val-parsed">
            <span className="val-currency">₹</span>
            <span>{formatted}</span>
          </span>
        ) : (
          <span className="val-parsed val-missing">-</span>
        )}
        {showRaw && (
          <div className="val-raw mono">
            {rawParts.map((part, idx) => (
              <span key={idx} className="val-raw-line">
                {idx === 0 ? `raw: ${part}` : `+ ${part}`}
              </span>
            ))}
          </div>
        )}
      </div>
    </td>
  );
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
  const [copilotTopic, setCopilotTopic] = useState<CopilotTopic>('why');
  const [kbOpen, setKbOpen] = useState<boolean>(false);
  const [kbTab, setKbTab] = useState<'domain' | 'non_errors' | 'catalog'>('domain');
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
      filtered.sort((a, b) => {
        const av = a.system_a_value !== null ? Number(a.system_a_value) : -1;
        const bv = b.system_a_value !== null ? Number(b.system_a_value) : -1;
        if (av !== bv) return (av - bv) * dir;
        return a.record_id.localeCompare(b.record_id);
      });
    } else if (sortOrder === 'sys_b_desc' || sortOrder === 'sys_b_asc') {
      const dir = sortOrder === 'sys_b_desc' ? -1 : 1;
      filtered.sort((a, b) => {
        const av = a.system_b_value !== null ? Number(a.system_b_value) : -1;
        const bv = b.system_b_value !== null ? Number(b.system_b_value) : -1;
        if (av !== bv) return (av - bv) * dir;
        return a.record_id.localeCompare(b.record_id);
      });
    }

    return filtered;
  }, [rows, searchQuery, sortOrder]);

  const metrics = useMemo(() => {
    const orgDenom = Math.max(1, orgTotalCount);
    const valueCount = orgReasonCounts.VALUE_MISMATCH || 0;
    const missingCount = orgReasonCounts.MISSING_IN_B || 0;
    const tenantCount = orgReasonCounts.TENANT_MISMATCH || 0;

    let sumA = 0;
    let sumB = 0;
    let viewMax = 0;
    for (const r of visibleRows) {
      if (r.system_a_value !== null) {
        const parsedA = Number(r.system_a_value);
        if (!Number.isNaN(parsedA)) sumA += parsedA;
      }
      if (r.system_b_value !== null) {
        const parsedB = Number(r.system_b_value);
        if (!Number.isNaN(parsedB)) sumB += parsedB;
      }
      const sv = Number(r.sort_value);
      if (!Number.isNaN(sv) && sv > viewMax) viewMax = sv;
    }

    return {
      orgTotal: orgTotalCount,
      valueCount,
      missingCount,
      tenantCount,
      valuePct: (valueCount / orgDenom) * 100,
      missingPct: (missingCount / orgDenom) * 100,
      tenantPct: (tenantCount / orgDenom) * 100,
      sumA,
      sumB,
      viewMax,
      magnitudeDenominator: orgMaxSortValue > 0 ? orgMaxSortValue : viewMax,
    };
  }, [visibleRows, orgTotalCount, orgMaxSortValue, orgReasonCounts]);

  const selectedOrgIndex = Math.max(0, orgs.indexOf(selectedOrg));
  const hasFilters = Boolean(selectedReason || searchQuery.trim() || sortOrder !== 'value_desc');

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
    setCopilotTopic('why');
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
    const headers = [
      'org_id',
      'record_id',
      'location_id',
      'location_name',
      'reason',
      'reason_label',
      'system_a_row',
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
          r.system_a_row,
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
          <button
            type="button"
            className="kpi-cell"
            data-active={selectedReason === '' ? 'true' : 'false'}
            onClick={() => setSelectedReason('')}
          >
            <div className="kpi-top">
              <span className="kpi-label">Org Disagreements</span>
              <span className="crm-tag crm-tag-sm" data-tone="green">
                All reasons
              </span>
            </div>
            <div className="kpi-bottom">
              <span className="kpi-value tabular">{metrics.orgTotal}</span>
              <SegmentBar percent={metrics.orgTotal > 0 ? 84 : 0} tone="auto" />
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
              <span className="kpi-label">Cross-Tenant Alerts</span>
              <span className="crm-tag crm-tag-sm" data-tone="red">
                Boundary
              </span>
            </div>
            <div className="kpi-bottom">
              <span className="kpi-value tabular">{metrics.tenantCount}</span>
              <SegmentBar percent={metrics.tenantPct} tone="auto" />
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
                    const rowKey = `${row.record_id}-${row.reason}-${row.system_a_raw}-${row.system_b_raw}`;
                    const isSelected =
                      activeRow?.record_id === row.record_id && activeRow?.reason === row.reason;
                    const delay = Math.min(idx, 8) * 24;
                    const rowSortNum = Number(row.sort_value) || 0;
                    const exposurePct =
                      metrics.magnitudeDenominator > 0
                        ? Math.max(
                            rowSortNum > 0 ? 8 : 0,
                            Math.round((rowSortNum / metrics.magnitudeDenominator) * 100),
                          )
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
                      ? `₹${formatMoney(Number(activeRow.system_a_value))}`
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
                      ? `₹${formatMoney(Number(activeRow.system_b_value))}`
                      : '-'}
                  </span>
                  <span className="sheet-box-raw mono">
                    raw: {activeRow.system_b_raw || '(none)'}
                  </span>
                </div>
              </div>

              <div className="sheet-box">
                <span className="sheet-box-label">Source Provenance &amp; Evidence</span>
                <div className="evidence-grid">
                  <div className="evidence-row">
                    <span className="evidence-key">System A Source</span>
                    <span className="evidence-val mono">
                      {activeRow.system_a_row !== null
                        ? `system_a.csv row #${activeRow.system_a_row}${activeRow.system_a_date ? ` (${activeRow.system_a_date})` : ''}`
                        : activeRow.reason === 'TENANT_MISMATCH'
                          ? 'Redacted (other org)'
                          : 'Not present in system_a.csv'}
                    </span>
                  </div>
                  <div className="evidence-row">
                    <span className="evidence-key">System B Source</span>
                    <span className="evidence-val mono">
                      {activeRow.system_b_rows.length > 0
                        ? activeRow.system_b_rows
                            .map((entry) =>
                              `${entry.entry_id}${entry.row !== null ? ` (row #${entry.row})` : ''}`,
                            )
                            .join(', ')
                        : activeRow.reason === 'TENANT_MISMATCH'
                          ? 'Redacted (other org)'
                          : 'No entry in system_b.csv'}
                    </span>
                  </div>
                  {activeRow.system_a_base_value !== null && activeRow.system_a_adjustment !== null && (
                    <div className="evidence-row">
                      <span className="evidence-key">System A Breakdown</span>
                      <span className="evidence-val tabular">
                        ₹{formatMoney(Number(activeRow.system_a_base_value))} + ₹
                        {formatMoney(Number(activeRow.system_a_adjustment))}
                      </span>
                    </div>
                  )}
                  <div className="evidence-row">
                    <span className="evidence-key">Absolute Variance</span>
                    <span className="evidence-val tabular">
                      {activeRow.system_a_value !== null && activeRow.system_b_value !== null
                        ? `₹${formatMoney(
                            Math.abs(
                              Number(activeRow.system_a_value) - Number(activeRow.system_b_value),
                            ),
                          )}`
                        : '-'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="sheet-box">
                <div className="sheet-box-head">
                  <span className="sheet-box-label">Rule-Based Audit Q&amp;A</span>
                  <span className="crm-tag crm-tag-sm" data-tone="neutral">
                    Deterministic
                  </span>
                </div>
                <div className="kb-chip-row" role="tablist" aria-label="Audit questions">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={copilotTopic === 'why'}
                    className="kb-chip"
                    data-active={copilotTopic === 'why' ? 'true' : 'false'}
                    onClick={() => setCopilotTopic('why')}
                  >
                    Why did this disagree?
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={copilotTopic === 'math'}
                    className="kb-chip"
                    data-active={copilotTopic === 'math' ? 'true' : 'false'}
                    onClick={() => setCopilotTopic('math')}
                  >
                    Amount &amp; Adjustment Math
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={copilotTopic === 'tenant'}
                    className="kb-chip"
                    data-active={copilotTopic === 'tenant' ? 'true' : 'false'}
                    onClick={() => setCopilotTopic('tenant')}
                  >
                    Tenant Guard
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={copilotTopic === 'fix'}
                    className="kb-chip"
                    data-active={copilotTopic === 'fix' ? 'true' : 'false'}
                    onClick={() => setCopilotTopic('fix')}
                  >
                    Verification Step
                  </button>
                </div>
                <p className="kb-answer-text">
                  {getCopilotAnswer(activeRow, selectedOrg, copilotTopic)}
                </p>
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
                    ? 'Foreign organization identifiers, row numbers, and amounts are redacted on the server before leaving Django.'
                    : `Scoped to ${selectedOrg} via ?org= (prototype boundary; production requires authenticated tenant context).`}
                </span>
              </div>
            </div>

            <div className="sheet-footer">
              <span className="sheet-footer-note mono tabular">
                sort_value: ₹{formatMoney(Number(activeRow.sort_value))}
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

      {kbOpen && (
        <div
          className="sheet-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeKnowledgeBase();
          }}
        >
          <aside
            ref={drawerRef}
            className="sheet-content sheet-content-wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="kb-title"
          >
            <div className="sheet-header">
              <div className="sheet-header-left">
                <h2 id="kb-title" className="sheet-title">
                  System &amp; Data Knowledge Base
                </h2>
                <span className="crm-tag crm-tag-sm" data-tone="green">
                  CSV-Grounded Notes
                </span>
              </div>
              <button
                ref={closeBtnRef}
                type="button"
                className="crm-btn crm-btn-secondary"
                onClick={closeKnowledgeBase}
              >
                Close
              </button>
            </div>

            <div className="sheet-body">
              <div className="kb-chip-row" role="tablist" aria-label="Knowledge Base sections">
                <button
                  type="button"
                  role="tab"
                  aria-selected={kbTab === 'domain'}
                  className="kb-chip"
                  data-active={kbTab === 'domain' ? 'true' : 'false'}
                  onClick={() => setKbTab('domain')}
                >
                  Source Data Notes
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={kbTab === 'non_errors'}
                  className="kb-chip"
                  data-active={kbTab === 'non_errors' ? 'true' : 'false'}
                  onClick={() => setKbTab('non_errors')}
                >
                  4 Non-Error Cases
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={kbTab === 'catalog'}
                  className="kb-chip"
                  data-active={kbTab === 'catalog' ? 'true' : 'false'}
                  onClick={() => setKbTab('catalog')}
                >
                  All 13 Disagreements
                </button>
              </div>

              {kbTab === 'domain' && (
                <>
                  <div className="sheet-box">
                    <span className="sheet-box-label">1. Source CSV Structure &amp; Numeric Observations</span>
                    <p className="kb-answer-text">
                      Across all 120 rows in <code>system_a.csv</code>,{' '}
                      <code>adjustment = round(base_value * 0.28, 2)</code> and{' '}
                      <code>total_value = base_value + adjustment</code>. In <code>system_b.csv</code>,{' '}
                      <code>REC-1064</code> uses Indian lakh comma grouping (<code>1,25,400.00</code>), indicating
                      INR (<code>₹</code>) amounts. The CSVs do not state which business rule the 28% adjustment
                      represents, so the engine reports only the observed math.
                    </p>
                  </div>

                  <div className="sheet-box">
                    <span className="sheet-box-label">2. Base-Value Matches (REC-1003, REC-1027, REC-1088)</span>
                    <p className="kb-answer-text">
                      In three records (<code>REC-1027</code> and <code>REC-1088</code> in <code>ORG-A</code>, plus{' '}
                      <code>REC-1003</code> in <code>ORG-B</code>), System B&apos;s recorded <code>value</code> exactly
                      matches System A&apos;s <code>base_value</code> (<code>₹61,921.12</code>,{' '}
                      <code>₹1,08,553.36</code>, and <code>₹94,834.38</code>) without the <code>adjustment</code> column
                      (<code>₹17,337.91</code>, <code>₹30,394.94</code>, and <code>₹26,553.63</code>). Our comparator
                      detects <code>entry.value == rec.base_value</code> and tags these with{' '}
                      <strong>Adjustment omitted</strong> so operators can verify the source voucher.
                    </p>
                  </div>

                  <div className="sheet-box">
                    <span className="sheet-box-label">3. Multi-Tenant Isolation &amp; Reference Assumptions</span>
                    <ul className="sheet-audit-list">
                      <li>
                        <strong>Locations Boundary:</strong> <code>LOC-101</code>, <code>LOC-102</code>, and{' '}
                        <code>LOC-103</code> belong to <code>ORG-A</code>. <code>LOC-201</code> and <code>LOC-202</code>{' '}
                        belong to <code>ORG-B</code>.
                      </li>
                      <li>
                        <strong>Global Record ID Assumption:</strong> Assuming normalized <code>record_id</code> values
                        are globally unique across exports, <code>comparator.py</code> checks cross-org membership on
                        unmatched references with <code>location__isnull=False</code> and returns{' '}
                        <code>Redacted (other org)</code> for <code>REC-1077</code> without exposing foreign org IDs,
                        row numbers, locations, or amounts.
                      </li>
                    </ul>
                  </div>
                </>
              )}

              {kbTab === 'non_errors' && (
                <>
                  <div className="sheet-box">
                    <span className="sheet-box-label">Why 4 Messy CSV Rows Are Valid Matches (Not Flagged)</span>
                    <p className="kb-answer-text">
                      A naive string or row-count diff would flag 17 rows. Our ingestion and reconciliation pipeline
                      normalizes formatting noise and recognizes split settlements so only the 13 true discrepancies
                      surface:
                    </p>
                  </div>

                  <div className="kb-list-grid">
                    <div className="sheet-box">
                      <div className="sheet-meta-row">
                        <span className="crm-tag crm-tag-sm" data-tone="green">
                          Split Settlement
                        </span>
                        <code className="mono">REC-1055 (ORG-A, LOC-103)</code>
                      </div>
                      <p className="kb-answer-text">
                        System A has one record for <code>₹1,79,877.32</code>. System B has two entries:{' '}
                        <code>ENT/2026/4055</code> (<code>₹71,950.93</code>) and <code>ENT/2026/4903</code> (
                        <code>₹1,07,926.39</code>). Because their exact <code>Decimal</code> sum equals{' '}
                        <code>₹1,79,877.32</code> and both share <code>LOC-103</code> and date <code>2026-03-19</code>,
                        it is a valid two-part payment rather than a duplicate.
                      </p>
                    </div>

                    <div className="sheet-box">
                      <div className="sheet-meta-row">
                        <span className="crm-tag crm-tag-sm" data-tone="blue">
                          Normalized Ref
                        </span>
                        <code className="mono">REC-1034 / REC-1070 / REC-1112</code>
                      </div>
                      <p className="kb-answer-text">
                        System B wrote <code>rec1034</code> (lowercase, no hyphen), <code>&apos; REC - 1070 &apos;</code>{' '}
                        (interior whitespace), and <code>1112</code> (bare digits). <code>normalize_record_ref()</code>{' '}
                        canonicalizes all three to <code>REC-1034</code> (<code>₹84,939.99</code>),{' '}
                        <code>REC-1070</code> (<code>₹1,608.95</code>), and <code>REC-1112</code> (
                        <code>₹52,028.74</code>), matching System A cleanly.
                      </p>
                    </div>
                  </div>
                </>
              )}

              {kbTab === 'catalog' && (
                <div className="kb-list-grid">
                  <div className="sheet-box">
                    <span className="sheet-box-label">ORG-A Disagreements (7 Records)</span>
                    <ul className="sheet-audit-list">
                      <li>
                        <strong>REC-1042 (LOC-101, Duplicate):</strong> System A is <code>₹1,12,837.06</code>; System B
                        booked <code>₹1,12,837.06</code> twice (<code>ENT/2026/4042</code> + <code>ENT/2026/4902</code> ={' '}
                        <code>₹2,25,674.12</code>).
                      </li>
                      <li>
                        <strong>REC-1064 (LOC-101, Different values):</strong> System A is <code>₹1,83,244.16</code>;
                        System B has Indian lakh string <code>&quot;1,25,400.00&quot;</code> (<code>₹1,25,400.00</code>).
                      </li>
                      <li>
                        <strong>REC-1088 (LOC-103, Adjustment omitted):</strong> System A is <code>₹1,38,948.30</code>;
                        System B matches <code>base_value</code> <code>₹1,08,553.36</code> without adjustment{' '}
                        <code>₹30,394.94</code>.
                      </li>
                      <li>
                        <strong>REC-1077 (LOC-102, Cross-tenant):</strong> System A is in <code>LOC-102</code> (
                        <code>ORG-A</code>, <code>₹83,361.40</code>), while System B <code>ENT/2026/4077</code> is in{' '}
                        <code>LOC-201</code> (<code>ORG-B</code>).
                      </li>
                      <li>
                        <strong>REC-1027 (LOC-102, Adjustment omitted):</strong> System A is <code>₹79,259.03</code>;
                        System B matches <code>base_value</code> <code>₹61,921.12</code> without adjustment{' '}
                        <code>₹17,337.91</code>.
                      </li>
                      <li>
                        <strong>REC-1999 (LOC-102, Orphan in B):</strong> System B <code>ENT/2026/4901</code> (
                        <code>₹41,250.00</code>) references <code>REC-1999</code>, which does not exist in System A.
                      </li>
                      <li>
                        <strong>REC-1015 (LOC-103, Missing in B):</strong> System A has <code>₹41,095.33</code>; zero
                        entries in System B.
                      </li>
                    </ul>
                  </div>

                  <div className="sheet-box">
                    <span className="sheet-box-label">ORG-B Disagreements (6 Records)</span>
                    <ul className="sheet-audit-list">
                      <li>
                        <strong>REC-1050 (LOC-202, Blank value):</strong> System A is <code>₹1,60,405.85</code>; System B{' '}
                        <code>ENT/2026/4050</code> has a blank value cell preserved via <code>value_parse_error=True</code>.
                      </li>
                      <li>
                        <strong>REC-1003 (LOC-202, Adjustment omitted):</strong> System A is <code>₹1,21,388.01</code>;
                        System B matches <code>base_value</code> <code>₹94,834.38</code> without adjustment{' '}
                        <code>₹26,553.63</code>.
                      </li>
                      <li>
                        <strong>REC-1009 (LOC-201, Date mismatch):</strong> Both have <code>₹1,11,699.30</code>, but
                        System A date is <code>2026-03-31</code> vs System B <code>2026-04-02</code>.
                      </li>
                      <li>
                        <strong>REC-1061 (LOC-202, Missing in B):</strong> System A has <code>₹87,615.49</code>; zero
                        entries in System B.
                      </li>
                      <li>
                        <strong>REC-1077 (LOC-201, Cross-tenant):</strong> System B booked <code>ENT/2026/4077</code> (
                        <code>₹83,361.40</code>) in <code>LOC-201</code> (<code>ORG-B</code>); System A record belongs to
                        another tenant (redacted).
                      </li>
                      <li>
                        <strong>REC-1019 (LOC-202, Voided in A):</strong> System A marked <code>REC-1019</code> (
                        <code>₹57,092.35</code>) as <code>VOIDED</code>, while System B still holds an active entry.
                      </li>
                    </ul>
                  </div>
                </div>
              )}
            </div>

            <div className="sheet-footer">
              <span className="sheet-footer-note mono">
                120 System A rows · 121 System B rows · 5 Locations · 2 Orgs
              </span>
              <button
                type="button"
                className="crm-btn crm-btn-primary"
                onClick={closeKnowledgeBase}
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
