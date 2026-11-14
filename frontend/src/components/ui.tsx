import type { MouseEvent, ReactNode, RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';
import { autoSegmentTone, formatMoney, type SegmentTone } from '../lib/reconcile';

export function SegmentBar({
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

export function ChevronDownIcon() {
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

export function SortIndicator({ dir }: { dir: 'asc' | 'desc' | null }) {
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

export function SearchIcon() {
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

export function ShareExportIcon() {
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

export function RefreshIcon() {
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

export function DotsHorizontalIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="3.5" cy="8" r="1.2" fill="currentColor" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.2" fill="currentColor" />
    </svg>
  );
}

export function BookOpenIcon() {
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

export function CopyIdButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = async (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      timerRef.current = window.setTimeout(() => setCopied(false), 1400);
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

export function ValueCell({
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

export function DrawerShell({
  titleId,
  title,
  badge,
  wide = false,
  drawerRef,
  closeBtnRef,
  onClose,
  footerLeft,
  children,
}: {
  titleId: string;
  title: string;
  badge: ReactNode;
  wide?: boolean;
  drawerRef: RefObject<HTMLElement | null>;
  closeBtnRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  footerLeft: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className="sheet-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        ref={drawerRef}
        className={wide ? 'sheet-content sheet-content-wide' : 'sheet-content'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="sheet-header">
          <div className="sheet-header-left">
            <h2 id={titleId} className="sheet-title">
              {title}
            </h2>
            {badge}
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            className="crm-btn crm-btn-secondary"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="sheet-body">{children}</div>

        <div className="sheet-footer">
          {footerLeft}
          <button type="button" className="crm-btn crm-btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </aside>
    </div>
  );
}
