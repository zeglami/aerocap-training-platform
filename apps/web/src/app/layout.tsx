import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AeroCap — Pilot Training Portal',
  description: 'Multi-tenant pilot training and CBTA management platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
