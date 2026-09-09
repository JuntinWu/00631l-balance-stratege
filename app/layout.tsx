import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://hengce-00631l-threshold.juntin.chatgpt.site'),
  title: '00631L 回測策略',
  description: '載入 00631L 歷史價格，以自訂價格門檻、資產比例與交易成本進行再平衡回測。',
  openGraph: {
    title: '00631L 回測策略',
    description: '價格跨越門檻，自動將 00631L 與現金調回目標比例。',
    type: 'website',
    images: [{ url: '/og.png', width: 1731, height: 909, alt: '00631L 回測策略' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '00631L 回測策略',
    description: '價格跨越門檻，自動將 00631L 與現金調回目標比例。',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant"><body>{children}</body></html>;
}
