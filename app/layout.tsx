import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Terra · 四叉树地球',
  icons: { icon: '/terra.svg' },
  description: '旋转、缩放地球，实时观察四叉树图块的细分与合并。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="dark">
      <body>{children}</body>
    </html>
  );
}
