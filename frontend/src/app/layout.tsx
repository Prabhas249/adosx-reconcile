import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'ADOSX Reconciliation — Disagreements',
  description: 'System A vs System B tenant-scoped reconciliation view',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          margin: '24px auto',
          maxWidth: '1080px',
          padding: '0 16px',
          color: '#111827',
        }}
      >
        {children}
      </body>
    </html>
  );
}
