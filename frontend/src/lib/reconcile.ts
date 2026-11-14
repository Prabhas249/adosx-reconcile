export interface ProvenanceEntry {
  entry_id: string;
  row: number | null;
  raw_value: string;
  recorded_on: string | null;
}

export interface Disagreement {
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

export interface ReasonOption {
  code: string;
  label: string;
}

export type TagTone =
  | 'red'
  | 'orange'
  | 'amber'
  | 'blue'
  | 'purple'
  | 'yellow'
  | 'green'
  | 'moss'
  | 'neutral';

export type SegmentTone = 'auto' | 'danger' | 'warning' | 'success';

export type SortKey =
  | 'value_desc'
  | 'value_asc'
  | 'id_asc'
  | 'id_desc'
  | 'sys_a_desc'
  | 'sys_a_asc'
  | 'sys_b_desc'
  | 'sys_b_asc';

export type CopilotTopic = 'why' | 'math' | 'tenant' | 'fix';

export const COPILOT_TABS: ReadonlyArray<{ id: CopilotTopic; label: string }> = [
  { id: 'why', label: 'Why did this disagree?' },
  { id: 'math', label: 'Amount & Adjustment Math' },
  { id: 'tenant', label: 'Tenant Guard' },
  { id: 'fix', label: 'Verification Step' },
];

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8000/api';
export const THEME_KEY = 'adosx-theme';

export function toPaise(val: string | null): number | null {
  if (val === null) return null;
  const parsed = Number(val);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
}

export function absDiffAmount(a: string | null, b: string | null): number | null {
  const aPaise = toPaise(a);
  const bPaise = toPaise(b);
  if (aPaise === null || bPaise === null) return null;
  return Math.abs(aPaise - bPaise) / 100;
}

export function formatMoney(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatSystemDisplay(
  val: string | null,
  raw: string,
  reason: string,
  emptyLabel = 'Not present',
): string {
  if (val !== null) {
    const parsed = Number(val);
    if (Number.isFinite(parsed)) {
      return `₹${formatMoney(parsed)}`;
    }
  }
  if (reason === 'TENANT_MISMATCH' && raw === 'Redacted (other org)') {
    return 'Redacted (other org)';
  }
  if (raw && raw !== '-') {
    return `Unavailable (raw: ${raw})`;
  }
  return emptyLabel;
}

export function isBaseValueMatch(row: Disagreement): boolean {
  return (
    row.reason === 'VALUE_MISMATCH' &&
    row.system_a_base_value !== null &&
    row.system_b_value !== null &&
    toPaise(row.system_b_value) === toPaise(row.system_a_base_value)
  );
}

export function getReasonTone(reason: string): TagTone {
  if (reason === 'TENANT_MISMATCH' || reason === 'VOIDED_IN_A') return 'red';
  if (reason === 'MISSING_IN_B' || reason === 'LOCATION_MISMATCH') return 'amber';
  if (reason === 'ORPHAN_IN_B') return 'orange';
  if (reason === 'VALUE_MISMATCH' || reason === 'DATE_MISMATCH') return 'blue';
  if (reason === 'DUPLICATE_IN_B' || reason === 'MULTI_ENTRY_UNRESOLVED') return 'purple';
  if (reason === 'UNPARSEABLE_VALUE') return 'yellow';
  return 'neutral';
}

export function getSecondaryTag(row: Disagreement): { label: string; tone: TagTone } {
  if (isBaseValueMatch(row)) {
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
    return {
      label: row.system_b_rows.length > 0 ? `${row.system_b_rows.length} entries` : 'Duplicate in A',
      tone: 'amber',
    };
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
  if (row.reason === 'LOCATION_MISMATCH') {
    return { label: 'Location drift', tone: 'amber' };
  }
  if (row.reason === 'DATE_MISMATCH') {
    return { label: 'Period drift', tone: 'blue' };
  }
  return { label: 'Net delta', tone: 'green' };
}

export function getAuditSteps(row: Disagreement, org: string): string[] {
  const steps = [`Scoped query filtered to organization ${org} at ${row.location_name} (${row.location_id}).`];
  if (isBaseValueMatch(row)) {
    steps.push('System B value equals System A base_value without the adjustment column.');
  } else if (row.reason === 'DUPLICATE_IN_B') {
    steps.push('Multiple System B entries normalize to the same record reference and repeat System A full amount at least twice.');
  } else if (row.reason === 'MULTI_ENTRY_UNRESOLVED') {
    steps.push(row.detail);
  } else if (row.reason === 'TENANT_MISMATCH') {
    steps.push('A matching normalized reference exists under another organization; foreign identifiers and amounts were redacted on the server.');
  } else if (row.reason === 'VOIDED_IN_A') {
    steps.push('Record state is VOIDED in System A while System B still holds an active entry.');
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

function formatUnparseableSource(row: Disagreement): string {
  const parts: string[] = [];
  if (row.system_a_value === null) {
    parts.push(`System A: ${row.system_a_raw || 'blank'}`);
  }
  if (row.system_b_value === null) {
    parts.push(`System B: ${row.system_b_raw || 'blank'}`);
  }
  if (parts.length > 0) {
    return parts.join('; ');
  }
  return row.system_b_raw || row.system_a_raw || 'blank';
}

export function getCopilotAnswer(row: Disagreement, org: string, topic: CopilotTopic): string {
  const aFormatted = formatSystemDisplay(row.system_a_value, row.system_a_raw, row.reason);
  const bFormatted = formatSystemDisplay(row.system_b_value, row.system_b_raw, row.reason);
  const diff = absDiffAmount(row.system_a_value, row.system_b_value);

  const unavailableVarianceReason =
    row.reason === 'TENANT_MISMATCH'
      ? `Unavailable (${row.system_a_value === null ? 'System A' : 'System B'} redacted for cross-tenant isolation)`
      : row.reason === 'UNPARSEABLE_VALUE'
        ? 'Unavailable (blank or unparseable value)'
        : 'Unavailable (no comparable value on both sides)';

  if (topic === 'why') {
    if (isBaseValueMatch(row)) {
      const adjText =
        row.system_a_adjustment !== null
          ? ` of ₹${formatMoney(Number(row.system_a_adjustment))}`
          : diff !== null
            ? ` of ₹${formatMoney(diff)}`
            : '';
      return `System B's recorded value (${bFormatted}) matches System A's base_value, while System A's total_value (${aFormatted}) includes an adjustment${adjText}. The CSV exports show the exact difference but do not specify which system is authoritative.`;
    }
    if (row.reason === 'DUPLICATE_IN_B') {
      return `System B contains ${row.system_b_rows.length || 2} entries for ${row.record_id} totaling ${bFormatted}, repeating System A's full amount (${aFormatted}) at least twice.`;
    }
    if (row.reason === 'MULTI_ENTRY_UNRESOLVED') {
      return row.detail;
    }
    if (row.reason === 'TENANT_MISMATCH') {
      return `${row.record_id} is mapped to ${row.location_name} (${row.location_id}) in ${org}, while a matching normalized reference exists under a location belonging to another organization.`;
    }
    if (row.reason === 'VOIDED_IN_A') {
      return `${row.record_id} has state VOIDED in System A, while System B still holds an active entry (${bFormatted}).`;
    }
    if (row.reason === 'UNPARSEABLE_VALUE') {
      return `The CSV row was preserved during ingestion with value_parse_error=True because the raw value cell was blank or malformed (${formatUnparseableSource(row)}).`;
    }
    return row.detail;
  }

  if (topic === 'math') {
    const varianceDisplay =
      diff !== null ? `Absolute variance: ₹${formatMoney(diff)}` : `Variance: ${unavailableVarianceReason}`;
    if (row.system_a_base_value !== null && row.system_a_adjustment !== null) {
      const baseFmt = `₹${formatMoney(Number(row.system_a_base_value))}`;
      const adjFmt = `₹${formatMoney(Number(row.system_a_adjustment))}`;
      return `System A base_value: ${baseFmt} + adjustment: ${adjFmt} = total_value: ${aFormatted} | System B: ${bFormatted} | ${varianceDisplay}.`;
    }
    return `System A: ${aFormatted} | System B: ${bFormatted} | ${varianceDisplay} | Sort magnitude: ₹${formatMoney(Number(row.sort_value))}.`;
  }

  if (topic === 'tenant') {
    if (row.reason === 'TENANT_MISMATCH') {
      return `Isolation active: comparator.py checked cross-org IDs via values_list('normalized_record_ref', flat=True) with location__isnull=False and redacted foreign org IDs, row numbers, locations, and amounts before serialization.`;
    }
    return `Scoped to ${org} (${row.location_id} - ${row.location_name}) via .filter(location__org_id='${org}'). In production, ?org= would be replaced by an authenticated tenant session.`;
  }

  if (isBaseValueMatch(row)) {
    return `Verify the source documentation for ${row.record_id} at ${row.location_id} to confirm whether the adjustment should be included or excluded before updating either system.`;
  }
  if (row.reason === 'DUPLICATE_IN_B') {
    return `Inspect the System B source entries (${row.system_b_raw}) against source records to confirm whether one posting is an unintended duplicate before taking action.`;
  }
  if (row.reason === 'MULTI_ENTRY_UNRESOLVED') {
    return `Verify source records for ${row.record_id} across both systems to confirm why the entries do not reconcile.`;
  }
  if (row.reason === 'UNPARSEABLE_VALUE') {
    return `Inspect the source CSV row for ${row.record_id} (${formatUnparseableSource(row)}) and correct the missing or malformed amount before re-importing.`;
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

export function autoSegmentTone(index: number, filled: number): 'danger' | 'warning' | 'success' {
  const red = Math.floor(filled / 3);
  const amber = Math.ceil(filled / 3);
  if (index < red) return 'danger';
  if (index < red + amber) return 'warning';
  return 'success';
}

function escapeCsvCell(value: string | number | null): string {
  const text = String(value ?? '');
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function buildDisagreementsCsv(org: string, rows: Disagreement[]): string {
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
  for (const r of rows) {
    lines.push(
      [
        org,
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
  return lines.join('\n');
}
