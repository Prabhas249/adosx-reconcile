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

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8000/api';

export default function DisagreementsPage() {
  const [orgs, setOrgs] = useState<string[]>(['ORG-A', 'ORG-B']);
  const [reasons, setReasons] = useState<ReasonOption[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<string>('ORG-A');
  const [selectedReason, setSelectedReason] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<string>('value_desc');
  const [rows, setRows] = useState<Disagreement[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/orgs/`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load orgs (${res.status})`);
        return res.json();
      })
      .then((data) => {
        if (Array.isArray(data.orgs) && data.orgs.length > 0) {
          setOrgs(data.orgs);
          setSelectedOrg((prev) => (data.orgs.includes(prev) ? prev : data.orgs[0]));
        }
        if (Array.isArray(data.reasons)) {
          setReasons(data.reasons);
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Unable to connect to Django API');
      });
  }, []);

  useEffect(() => {
    if (!selectedOrg) return;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ org: selectedOrg });
    if (selectedReason) params.set('reason', selectedReason);
    if (sortOrder) params.set('sort', sortOrder);

    fetch(`${API_BASE}/disagreements/?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error(`API error (${res.status})`);
        return res.json();
      })
      .then((data) => {
        setRows(data.disagreements || []);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to fetch disagreements');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [selectedOrg, selectedReason, sortOrder]);

  return (
    <main>
      <h1 style={{ marginBottom: '4px' }}>System A vs System B Disagreements</h1>
      <p style={{ color: '#4b5563', marginTop: 0 }}>
        Strictly scoped per tenant (org). Switching tenants queries only that org&apos;s records.
      </p>

      <div
        style={{
          display: 'flex',
          gap: '16px',
          flexWrap: 'wrap',
          alignItems: 'center',
          margin: '16px 0',
          padding: '12px',
          border: '1px solid #d1d5db',
          background: '#f9fafb',
        }}
      >
        <label>
          <strong>Tenant (Org): </strong>
          <select
            value={selectedOrg}
            onChange={(e) => setSelectedOrg(e.target.value)}
            style={{ padding: '4px 8px' }}
          >
            {orgs.map((org) => (
              <option key={org} value={org}>
                {org}
              </option>
            ))}
          </select>
        </label>

        <label>
          <strong>Filter by Reason: </strong>
          <select
            value={selectedReason}
            onChange={(e) => setSelectedReason(e.target.value)}
            style={{ padding: '4px 8px' }}
          >
            <option value="">All reasons</option>
            {reasons.map((r) => (
              <option key={r.code} value={r.code}>
                {r.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <strong>Sort by Value: </strong>
          <select
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            style={{ padding: '4px 8px' }}
          >
            <option value="value_desc">Highest value first</option>
            <option value="value_asc">Lowest value first</option>
            <option value="">Record ID (A-Z)</option>
          </select>
        </label>

        <span style={{ marginLeft: 'auto', fontSize: '14px', color: '#374151' }}>
          Showing <strong>{rows.length}</strong> disagreement{rows.length === 1 ? '' : 's'}
        </span>
      </div>

      {error && (
        <div
          style={{
            padding: '12px',
            marginBottom: '16px',
            border: '1px solid #ef4444',
            background: '#fef2f2',
            color: '#991b1b',
          }}
        >
          {error}. Make sure the Django server is running on <code>127.0.0.1:8000</code>.
        </div>
      )}

      {loading ? (
        <p>Loading disagreements...</p>
      ) : rows.length === 0 ? (
        <p>No disagreements match the selected filters for {selectedOrg}.</p>
      ) : (
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '14px',
          }}
        >
          <thead>
            <tr style={{ background: '#f3f4f6', textAlign: 'left' }}>
              <th style={thStyle}>Record ID</th>
              <th style={thStyle}>Location</th>
              <th style={thStyle}>Reason</th>
              <th style={thStyle}>System A Value</th>
              <th style={thStyle}>System B Value</th>
              <th style={thStyle}>Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={`${row.record_id}-${row.reason}-${idx}`} style={{ borderTop: '1px solid #e5e7eb' }}>
                <td style={tdStyle}>
                  <code>{row.record_id}</code>
                </td>
                <td style={tdStyle}>
                  {row.location_name} <span style={{ color: '#6b7280' }}>({row.location_id})</span>
                </td>
                <td style={tdStyle}>
                  <strong>{row.reason_label}</strong>
                </td>
                <td style={tdStyle}>
                  {row.system_a_value ?? '—'}
                  {row.system_a_raw && row.system_a_raw !== row.system_a_value && (
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>raw: {row.system_a_raw}</div>
                  )}
                </td>
                <td style={tdStyle}>
                  {row.system_b_value ?? '—'}
                  {row.system_b_raw && row.system_b_raw !== row.system_b_value && (
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>raw: {row.system_b_raw}</div>
                  )}
                </td>
                <td style={tdStyle}>{row.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

const thStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '2px solid #d1d5db',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  verticalAlign: 'top',
};
