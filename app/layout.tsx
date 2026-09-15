import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://hengce-00631l-threshold.juntin.chatgpt.site'),
  title: '00631L 回測策略',
  description: '00631L 門檻式再平衡、240 年線分批轉正二，以及納入 QQQ 跨市場訊號的 40/40/20 均線策略回測。',
  openGraph: {
    title: '00631L 回測策略',
    description: '三種 00631L 回測：門檻再平衡、240 年線分批轉正二，以及納入 QQQ 跨市場訊號的 40/40/20 均線策略。',
    type: 'website',
    images: [{ url: '/og.png', width: 1731, height: 909, alt: '00631L 回測策略' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '00631L 回測策略',
    description: '三種 00631L 回測：門檻再平衡、240 年線分批轉正二，以及納入 QQQ 跨市場訊號的 40/40/20 均線策略。',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant"><body>{children}</body></html>;
}
