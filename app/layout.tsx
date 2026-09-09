import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://hengce-00631l-threshold.juntin.chatgpt.site'),
  title: '00631L 回測策略',
  description: '00631L 門檻式再平衡與 0050 240 年線加碼策略回測。',
  openGraph: {
    title: '00631L 回測策略',
    description: '回測門檻式再平衡，以及年線上買 0050、年線下買 00631L 的每月加碼策略。',
    type: 'website',
    images: [{ url: '/og.png', width: 1731, height: 909, alt: '00631L 回測策略' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '00631L 回測策略',
    description: '回測門檻式再平衡，以及年線上買 0050、年線下買 00631L 的每月加碼策略。',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant"><body>{children}</body></html>;
}
