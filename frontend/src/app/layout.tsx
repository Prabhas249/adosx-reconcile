import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const geist = Geist({
  subsets: ['latin'],
  variable: '--font-geist',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
});

const themeScript = `try{var t=localStorage.getItem("adosx-theme")||"dark";var d=t!=="light";document.documentElement.dataset.theme=d?"dark":"light";var m=document.querySelector('meta[name="color-scheme"]');if(m)m.content=d?"dark":"light";}catch(e){}`;

export const metadata: Metadata = {
  title: 'ADOSX Disagreements',
  description: 'System A and System B org-scoped reconciliation view',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${geist.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <meta name="color-scheme" content="dark" />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
