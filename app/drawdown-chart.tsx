'use client';

import { useMemo } from 'react';

export type ValuePoint = { date: string; value: number };
type DrawdownPoint = ValuePoint & {
  drawdownAmount: number;
  drawdownPct: number;
  index: number;
  peak: number;
};

function getDrawdowns(points: ValuePoint[]) {
  let peak = points[0]?.value ?? 0;
  return points.map((point, index) => {
    peak = Math.max(peak, point.value);
    return {
      ...point,
      index,
      peak,
      drawdownAmount: point.value - peak,
      drawdownPct: peak > 0 ? (point.value / peak - 1) * 100 : 0,
    } satisfies DrawdownPoint;
  });
}

function getWorst(drawdowns: DrawdownPoint[]) {
  return drawdowns.reduce(
    (current, point) => point.drawdownAmount < current.drawdownAmount ? point : current,
    drawdowns[0] ?? { date: '', value: 0, peak: 0, drawdownAmount: 0, drawdownPct: 0, index: 0 },
  );
}

function formatTwd(value: number) {
  const sign = value < 0 ? '−' : '';
  return `${sign}NT$${Math.round(Math.abs(value)).toLocaleString('zh-TW')}`;
}

function formatCompactTwd(value: number) {
  const absolute = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (absolute >= 100_000_000) return `${sign}$${(absolute / 100_000_000).toFixed(1)}億`;
  if (absolute >= 10_000) return `${sign}$${Math.round(absolute / 10_000).toLocaleString('zh-TW')}萬`;
  return `${sign}$${Math.round(absolute).toLocaleString('zh-TW')}`;
}

export function DrawdownMetric({ points }: { points: ValuePoint[] }) {
  const worst = useMemo(() => getWorst(getDrawdowns(points)), [points]);
  return <article className="metric">
    <span>最大回撤金額</span>
    <strong className="negative">{formatTwd(worst.drawdownAmount)}</strong>
    <p>距當時前高 {worst.drawdownPct.toFixed(2)}% · {worst.date.replaceAll('-', '/')}</p>
  </article>;
}

export default function DrawdownChart({ points, label = '資產回撤' }: { points: ValuePoint[]; label?: string }) {
  const drawdowns = useMemo(() => getDrawdowns(points), [points]);
  const worst = useMemo(() => getWorst(drawdowns), [drawdowns]);

  const sampled = useMemo(() => {
    const step = Math.max(1, Math.ceil(drawdowns.length / 720));
    return drawdowns.filter((point) => point.index % step === 0 || point.index === drawdowns.length - 1 || point.index === worst.index);
  }, [drawdowns, worst.index]);

  if (!drawdowns.length) return null;

  const width = 1080;
  const height = 300;
  const pad = { left: 62, right: 24, top: 26, bottom: 42 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const worstLoss = Math.abs(worst.drawdownAmount);
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, worstLoss)));
  const tickSize = Math.max(1, magnitude / (worstLoss / magnitude < 2 ? 5 : 2));
  const floor = -Math.max(tickSize, Math.ceil(worstLoss / tickSize) * tickSize);
  const x = (index: number) => pad.left + index / Math.max(1, drawdowns.length - 1) * plotW;
  const y = (value: number) => pad.top + (0 - value) / Math.max(1, -floor) * plotH;
  const path = sampled.map((point, index) => `${index ? 'L' : 'M'}${x(point.index).toFixed(1)},${y(point.drawdownAmount).toFixed(1)}`).join(' ');
  const area = `${path} L${x(sampled.at(-1)?.index ?? 0).toFixed(1)},${y(0).toFixed(1)} L${x(sampled[0]?.index ?? 0).toFixed(1)},${y(0).toFixed(1)} Z`;
  const ticks = [0, .25, .5, .75, 1].map((ratio) => floor * ratio);
  const dateIndexes = [0, .25, .5, .75, 1].map((ratio) => Math.round(ratio * (drawdowns.length - 1)));

  return <div className="chart-wrap drawdown-chart">
    <div className="mdd-callout"><span>最大回撤金額</span><strong>{formatTwd(worst.drawdownAmount)}</strong><small>{worst.drawdownPct.toFixed(2)}% · {worst.date.replaceAll('-', '/')}</small></div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}曲線，最大回撤金額 ${formatTwd(worst.drawdownAmount)}，距當時前高 ${worst.drawdownPct.toFixed(2)}%`}>
      <defs>
        <linearGradient id="drawdown-area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#c34c3e" stopOpacity="0.08" />
          <stop offset="1" stopColor="#c34c3e" stopOpacity="0.34" />
        </linearGradient>
      </defs>
      {ticks.map((tick) => <g key={tick}>
        <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} className={`grid-line ${tick === 0 ? 'drawdown-zero' : ''}`} />
        <text x={pad.left - 12} y={y(tick) + 4} textAnchor="end" className="axis-label">{formatCompactTwd(tick)}</text>
      </g>)}
      {dateIndexes.map((index) => <text key={index} x={x(index)} y={height - 14} textAnchor="middle" className="axis-label">{drawdowns[index]?.date.slice(0, 7).replace('-', '/')}</text>)}
      <path d={area} fill="url(#drawdown-area)" />
      <path d={path} fill="none" stroke="#c34c3e" strokeWidth="2.4" strokeLinejoin="round" />
      <line x1={x(worst.index)} x2={x(worst.index)} y1={y(0)} y2={y(worst.drawdownAmount)} className="mdd-guide" />
      <circle cx={x(worst.index)} cy={y(worst.drawdownAmount)} r="5" className="mdd-point" />
      <text x={x(worst.index)} y={Math.min(height - pad.bottom - 10, y(worst.drawdownAmount) - 11)} textAnchor="middle" className="mdd-label">{formatCompactTwd(worst.drawdownAmount)}</text>
    </svg>
    <p className="drawdown-help">$0 代表資產創下新高；曲線越往下，表示相較當時前高少了多少資產。</p>
  </div>;
}
