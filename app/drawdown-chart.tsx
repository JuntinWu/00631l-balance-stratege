'use client';

import { useMemo } from 'react';

type ValuePoint = { date: string; value: number };
type DrawdownPoint = ValuePoint & { drawdown: number; index: number };

export default function DrawdownChart({ points, label = '資產回撤' }: { points: ValuePoint[]; label?: string }) {
  const drawdowns = useMemo(() => {
    let peak = points[0]?.value ?? 0;
    return points.map((point, index) => {
      peak = Math.max(peak, point.value);
      return {
        ...point,
        index,
        drawdown: peak > 0 ? (point.value / peak - 1) * 100 : 0,
      } satisfies DrawdownPoint;
    });
  }, [points]);

  const worst = useMemo(() => drawdowns.reduce(
    (current, point) => point.drawdown < current.drawdown ? point : current,
    drawdowns[0] ?? { date: '', value: 0, drawdown: 0, index: 0 },
  ), [drawdowns]);

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
  const floor = Math.min(-5, Math.floor(worst.drawdown / 10) * 10);
  const x = (index: number) => pad.left + index / Math.max(1, drawdowns.length - 1) * plotW;
  const y = (value: number) => pad.top + (0 - value) / Math.max(1, -floor) * plotH;
  const path = sampled.map((point, index) => `${index ? 'L' : 'M'}${x(point.index).toFixed(1)},${y(point.drawdown).toFixed(1)}`).join(' ');
  const area = `${path} L${x(sampled.at(-1)?.index ?? 0).toFixed(1)},${y(0).toFixed(1)} L${x(sampled[0]?.index ?? 0).toFixed(1)},${y(0).toFixed(1)} Z`;
  const ticks = [0, .25, .5, .75, 1].map((ratio) => floor * ratio);
  const dateIndexes = [0, .25, .5, .75, 1].map((ratio) => Math.round(ratio * (drawdowns.length - 1)));

  return <div className="chart-wrap drawdown-chart">
    <div className="mdd-callout"><span>歷史最深回撤</span><strong>{worst.drawdown.toFixed(2)}%</strong><small>{worst.date.replaceAll('-', '/')}</small></div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}曲線，最大回撤 ${worst.drawdown.toFixed(2)}%`}>
      <defs>
        <linearGradient id="drawdown-area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#c34c3e" stopOpacity="0.08" />
          <stop offset="1" stopColor="#c34c3e" stopOpacity="0.34" />
        </linearGradient>
      </defs>
      {ticks.map((tick) => <g key={tick}>
        <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} className={`grid-line ${tick === 0 ? 'drawdown-zero' : ''}`} />
        <text x={pad.left - 12} y={y(tick) + 4} textAnchor="end" className="axis-label">{tick.toFixed(0)}%</text>
      </g>)}
      {dateIndexes.map((index) => <text key={index} x={x(index)} y={height - 14} textAnchor="middle" className="axis-label">{drawdowns[index]?.date.slice(0, 7).replace('-', '/')}</text>)}
      <path d={area} fill="url(#drawdown-area)" />
      <path d={path} fill="none" stroke="#c34c3e" strokeWidth="2.4" strokeLinejoin="round" />
      <line x1={x(worst.index)} x2={x(worst.index)} y1={y(0)} y2={y(worst.drawdown)} className="mdd-guide" />
      <circle cx={x(worst.index)} cy={y(worst.drawdown)} r="5" className="mdd-point" />
      <text x={x(worst.index)} y={Math.min(height - pad.bottom - 10, y(worst.drawdown) - 11)} textAnchor="middle" className="mdd-label">{worst.drawdown.toFixed(2)}%</text>
    </svg>
    <p className="drawdown-help">0% 代表資產創下新高；曲線越往下，表示距離當時前高越遠。</p>
  </div>;
}
