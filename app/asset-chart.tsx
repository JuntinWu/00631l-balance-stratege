'use client';

import { useMemo } from 'react';

export type AssetCurvePoint = { date: string; total: number; asset: number; cash: number; ratio: number };
export const BASE_BENCHMARK_LABEL = '100% 持有 0050';
export const BASE_BENCHMARK_COLOR = '#145f48';

const money = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
export const compactMoney = (value: number) => {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}億`;
  if (value >= 10_000) return `${Math.round(value / 10_000)}萬`;
  return money.format(value);
};

export default function LineChart({ points, ratio = false, benchmark }: {
  points: AssetCurvePoint[];
  ratio?: boolean;
  benchmark?: ReadonlyMap<string, number>;
}) {
  const width = 1080;
  const height = 310;
  const pad = { left: 66, right: 20, top: 22, bottom: 42 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const comparison = ratio || !benchmark?.size ? undefined : benchmark;
  const sampled = useMemo(() => {
    const step = Math.max(1, Math.ceil(points.length / 720));
    const firstBenchmark = comparison?.keys().next().value;
    let lastBenchmark: string | undefined;
    for (const date of comparison?.keys() ?? []) lastBenchmark = date;
    return points
      .map((point, index) => ({ point, index }))
      .filter(({ point, index }) => index % step === 0 || index === points.length - 1
        || point.date === firstBenchmark || point.date === lastBenchmark);
  }, [points, comparison]);
  const series = ratio
    ? [{ key: 'ratio' as const, color: '#62e6ba', name: '00631L占比' }]
    : [
        { key: 'total' as const, color: '#ffd166', name: '總資產' },
        { key: 'asset' as const, color: '#62e6ba', name: '00631L部位' },
        { key: 'cash' as const, color: '#9fb3d7', name: '現金' },
      ];
  const max = ratio ? 100 : points.reduce((high, point) =>
    Math.max(high, point.total, point.asset, point.cash, comparison?.get(point.date) ?? 0), 1);
  const x = (i: number) => pad.left + (i / Math.max(1, points.length - 1)) * plotW;
  const y = (value: number) => pad.top + (1 - value / Math.max(1, max)) * plotH;
  const path = (key: 'total' | 'asset' | 'cash' | 'ratio') =>
    sampled.map(({ point, index }, i) => `${i ? 'L' : 'M'}${x(index).toFixed(1)},${y(point[key]).toFixed(1)}`).join(' ');
  const benchmarkCoordinates = comparison
    ? sampled.flatMap(({ point, index }) => {
        const value = comparison.get(point.date);
        return value === undefined ? [] : [{ x: x(index).toFixed(1), y: y(value).toFixed(1) }];
      })
    : [];
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const dateTicks = [...new Set(ticks.map((n) => Math.round(n * (points.length - 1))))];

  if (!points.length) return null;
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ratio ? '00631L占比走勢圖' : comparison ? '策略與 100% 持有 0050 的資產曲線' : '資產權益曲線'}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={y(max * t)} y2={y(max * t)} className="grid-line" />
            <text x={pad.left - 12} y={y(max * t) + 4} textAnchor="end" className="axis-label">
              {ratio ? `${Math.round(t * 100)}%` : compactMoney(max * t)}
            </text>
          </g>
        ))}
        {dateTicks.map((index) => (
          <g key={index}>
            <line x1={x(index)} x2={x(index)} y1={pad.top} y2={height - pad.bottom} className="grid-line vertical" />
            <text x={x(index)} y={height - 14} textAnchor="middle" className="axis-label">
              {points[index].date.slice(0, 7).replace('-', '/')}
            </text>
          </g>
        ))}
        {!ratio && (
          <path d={`${path('total')} L${width - pad.right},${height - pad.bottom} L${pad.left},${height - pad.bottom} Z`} fill="url(#area)" />
        )}
        <defs>
          <linearGradient id="area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#ffd166" stopOpacity="0.22" />
            <stop offset="1" stopColor="#ffd166" stopOpacity="0" />
          </linearGradient>
        </defs>
        {series.map((item) => <path key={item.key} d={path(item.key)} fill="none" stroke={item.color} strokeWidth="2.5" strokeLinejoin="round" />)}
        {benchmarkCoordinates.length === 1 && <circle cx={benchmarkCoordinates[0].x} cy={benchmarkCoordinates[0].y} r="4" fill={BASE_BENCHMARK_COLOR} />}
        {benchmarkCoordinates.length > 1 && <path d={`M${benchmarkCoordinates.map((point) => `${point.x},${point.y}`).join(' L')}`} fill="none" stroke={BASE_BENCHMARK_COLOR} strokeWidth="2.5" strokeDasharray="7 4" strokeLinejoin="round" />}
      </svg>
      <div className="legend">
        {series.map((item) => <span key={item.key}><i style={{ background: item.color }} />{item.name}</span>)}
        {comparison && <span><i className="benchmark-swatch" style={{ color: BASE_BENCHMARK_COLOR }} />{BASE_BENCHMARK_LABEL}</span>}
      </div>
    </div>
  );
}
