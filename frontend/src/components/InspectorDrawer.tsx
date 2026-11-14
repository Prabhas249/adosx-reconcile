import type { RefObject } from 'react';
import { useEffect, useState } from 'react';
import {
  absDiffAmount,
  COPILOT_TABS,
  formatMoney,
  formatSystemDisplay,
  getAuditSteps,
  getCopilotAnswer,
  getReasonTone,
  getSecondaryTag,
  type CopilotTopic,
  type Disagreement,
} from '../lib/reconcile';
import { DrawerShell } from './ui';

export function InspectorDrawer({
  row,
  selectedOrg,
  drawerRef,
  closeBtnRef,
  onClose,
}: {
  row: Disagreement;
  selectedOrg: string;
  drawerRef: RefObject<HTMLElement | null>;
  closeBtnRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const [copilotTopic, setCopilotTopic] = useState<CopilotTopic>('why');

  useEffect(() => {
    setCopilotTopic('why');
  }, [row.record_id, row.reason, row.system_a_row, row.system_b_raw]);

  const diff = absDiffAmount(row.system_a_value, row.system_b_value);
  const secondary = getSecondaryTag(row);

  return (
    <DrawerShell
      titleId="sheet-title"
      title={row.record_id}
      badge={
        <span className="crm-tag crm-tag-sm" data-tone={getReasonTone(row.reason)}>
          {row.reason_label}
        </span>
      }
      drawerRef={drawerRef}
      closeBtnRef={closeBtnRef}
      onClose={onClose}
      footerLeft={
        <span className="sheet-footer-note mono tabular">
          sort_value: ₹{formatMoney(Number(row.sort_value))}
        </span>
      }
    >
      <div className="sheet-meta-row">
        <span className="crm-tag crm-tag-sm" data-tone="neutral">
          {selectedOrg}
        </span>
        <span className="crm-tag crm-tag-sm" data-tone="neutral">
          {row.location_id}
        </span>
        <span className="crm-tag crm-tag-sm" data-tone={secondary.tone}>
          {secondary.label}
        </span>
      </div>

      <div className="sheet-detail-card">{row.detail}</div>

      <div className="sheet-compare-grid">
        <div className="sheet-box">
          <span className="sheet-box-label">System A</span>
          <span className="sheet-box-value tabular">
            {formatSystemDisplay(row.system_a_value, row.system_a_raw, row.reason, '-')}
          </span>
          <span className="sheet-box-raw mono">raw: {row.system_a_raw || '(none)'}</span>
        </div>
        <div className="sheet-box">
          <span className="sheet-box-label">System B</span>
          <span className="sheet-box-value tabular">
            {formatSystemDisplay(row.system_b_value, row.system_b_raw, row.reason, '-')}
          </span>
          <span className="sheet-box-raw mono">raw: {row.system_b_raw || '(none)'}</span>
        </div>
      </div>

      <div className="sheet-box">
        <span className="sheet-box-label">Source Provenance &amp; Evidence</span>
        <div className="evidence-grid">
          <div className="evidence-row">
            <span className="evidence-key">System A Source</span>
            <span className="evidence-val mono">
              {row.system_a_row !== null
                ? `system_a.csv row #${row.system_a_row}${row.system_a_date ? ` (${row.system_a_date})` : ''}`
                : row.reason === 'TENANT_MISMATCH'
                  ? 'Redacted (other org)'
                  : 'Not present in system_a.csv'}
            </span>
          </div>
          <div className="evidence-row">
            <span className="evidence-key">System B Source</span>
            <span className="evidence-val mono">
              {row.system_b_rows.length > 0
                ? row.system_b_rows
                    .map((entry) =>
                      `${entry.entry_id}${entry.row !== null ? ` (row #${entry.row})` : ''}`,
                    )
                    .join(', ')
                : row.reason === 'TENANT_MISMATCH'
                  ? 'Redacted (other org)'
                  : 'No entry in system_b.csv'}
            </span>
          </div>
          {row.system_a_base_value !== null && row.system_a_adjustment !== null && (
            <div className="evidence-row">
              <span className="evidence-key">System A Breakdown</span>
              <span className="evidence-val tabular">
                ₹{formatMoney(Number(row.system_a_base_value))} + ₹
                {formatMoney(Number(row.system_a_adjustment))}
              </span>
            </div>
          )}
          <div className="evidence-row">
            <span className="evidence-key">Absolute Variance</span>
            <span className="evidence-val tabular">
              {diff !== null ? `₹${formatMoney(diff)}` : '-'}
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
          {COPILOT_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={copilotTopic === tab.id}
              className="kb-chip"
              data-active={copilotTopic === tab.id ? 'true' : 'false'}
              onClick={() => setCopilotTopic(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <p className="kb-answer-text">{getCopilotAnswer(row, selectedOrg, copilotTopic)}</p>
      </div>

      <div className="sheet-box">
        <span className="sheet-box-label">Reconciliation Audit Breakdown</span>
        <ul className="sheet-audit-list">
          {getAuditSteps(row, selectedOrg).map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ul>
      </div>

      <div className="sheet-box">
        <span className="sheet-box-label">Tenant Boundary Verification</span>
        <span className="location-name">
          {row.location_name} ({row.location_id})
        </span>
        <span className="sheet-box-raw">
          {row.reason === 'TENANT_MISMATCH'
            ? 'Foreign organization identifiers, row numbers, and amounts are redacted on the server before leaving Django.'
            : `Scoped to ${selectedOrg} via ?org= (prototype boundary; production requires authenticated tenant context).`}
        </span>
      </div>
    </DrawerShell>
  );
}
