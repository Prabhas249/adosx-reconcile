import type { RefObject } from 'react';
import { useState } from 'react';
import { DrawerShell } from './ui';

type KbTab = 'domain' | 'non_errors';

const KB_TABS: ReadonlyArray<{ id: KbTab; label: string }> = [
  { id: 'domain', label: 'Source Rules & Guardrails' },
  { id: 'non_errors', label: 'Non-Error Normalization' },
];

export function KnowledgeBaseDrawer({
  selectedOrg,
  drawerRef,
  closeBtnRef,
  onClose,
}: {
  selectedOrg: string;
  drawerRef: RefObject<HTMLElement | null>;
  closeBtnRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const [kbTab, setKbTab] = useState<KbTab>('domain');

  return (
    <DrawerShell
      titleId="kb-title"
      title="Reconciliation Rules & Guardrails"
      badge={
        <span className="crm-tag crm-tag-sm" data-tone="green">
          CSV-Grounded
        </span>
      }
      wide
      drawerRef={drawerRef}
      closeBtnRef={closeBtnRef}
      onClose={onClose}
      footerLeft={
        <span className="sheet-footer-note mono">
          Active scope: {selectedOrg || 'None'} · Fixed-point Decimal math
        </span>
      }
    >
      <div className="kb-chip-row" role="tablist" aria-label="Knowledge Base sections">
        {KB_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={kbTab === tab.id}
            className="kb-chip"
            data-active={kbTab === tab.id ? 'true' : 'false'}
            onClick={() => setKbTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {kbTab === 'domain' && (
        <>
          <div className="sheet-box">
            <span className="sheet-box-label">1. Source CSV Parsing &amp; Row Preservation</span>
            <p className="kb-answer-text">
              Both exports are preserved row-for-row with original CSV line numbers (<code>source_row</code>) and raw
              strings alongside parsed <code>Decimal(14, 2)</code> and <code>Date</code> values. Indian lakh comma
              grouping (such as <code>1,25,400.00</code>) parses cleanly while blank or malformed cells keep{' '}
              <code>value_parse_error=True</code> so no broken row is dropped silently.
            </p>
          </div>

          <div className="sheet-box">
            <span className="sheet-box-label">2. Base-Value vs Adjustment Detection</span>
            <p className="kb-answer-text">
              System A stores <code>base_value</code>, <code>adjustment</code>, and <code>total_value</code>. When a
              single System B entry disagrees with <code>total_value</code> but equals System A&apos;s{' '}
              <code>base_value</code>, the comparator preserves the numeric observation without inventing an external
              business label so reviewers can check the source record.
            </p>
          </div>

          <div className="sheet-box">
            <span className="sheet-box-label">3. Multi-Tenant Isolation &amp; Redaction</span>
            <ul className="sheet-audit-list">
              <li>
                <strong>Org Scoping:</strong> Every API query filters both systems by{' '}
                <code>location__org_id = {selectedOrg || 'org'}</code> and rejects missing or unknown{' '}
                <code>?org=</code> parameters with HTTP 400.
              </li>
              <li>
                <strong>Cross-Tenant Redaction:</strong> When an unmatched ID exists under another org, Django checks
                membership via <code>values_list(&apos;normalized_record_ref&apos;, flat=True)</code> with{' '}
                <code>location__isnull=False</code> and returns <code>Redacted (other org)</code> without exposing
                foreign org IDs, row numbers, locations, or amounts.
              </li>
            </ul>
          </div>
        </>
      )}

      {kbTab === 'non_errors' && (
        <div className="kb-list-grid">
          <div className="sheet-box">
            <span className="sheet-box-label">Why Dirty Formats &amp; Valid Splits Are Not Flagged</span>
            <p className="kb-answer-text">
              A naive string comparison raises false positives on formatting noise and split settlements. Normalization
              and multi-entry arithmetic prevent false alarms without masking real mismatches:
            </p>
          </div>

          <div className="sheet-box">
            <div className="sheet-meta-row">
              <span className="crm-tag crm-tag-sm" data-tone="green">
                Split Settlement
              </span>
              <code className="mono">Exact Decimal Sum Check</code>
            </div>
            <p className="kb-answer-text">
              Multiple System B entries pointing to one System A record pass when their exact <code>Decimal</code> sum
              matches System A&apos;s <code>total_value</code> and every entry shares the same location and date. When
              at least two entries repeat the full <code>total_value</code>, it flags <code>DUPLICATE_IN_B</code>;
              ambiguous partial sums flag <code>MULTI_ENTRY_UNRESOLVED</code>.
            </p>
          </div>

          <div className="sheet-box">
            <div className="sheet-meta-row">
              <span className="crm-tag crm-tag-sm" data-tone="blue">
                Normalized Ref
              </span>
              <code className="mono">normalize_record_ref()</code>
            </div>
            <p className="kb-answer-text">
              Variations such as lowercase without a hyphen (<code>rec1034</code>), interior spacing around the hyphen (
              <code>&apos; REC - 1070 &apos;</code>), and bare numeric refs (<code>1112</code>) canonicalize to{' '}
              <code>REC-XXXX</code> before matching.
            </p>
          </div>
        </div>
      )}
    </DrawerShell>
  );
}
