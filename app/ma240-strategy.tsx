'use client';

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { runMa240Backtest, type Ma240CurvePoint, type Ma240Result, type Ma240Settings } from './ma240-backtest';
import type { OhlcRow } from './price-adjustments';

const defaults: Ma240Settings = {
  initialWan: 1000,
  monthlyWan: 5,
  commissionPct: 0.1425,
  discount: 1.8,
};

const money = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const signedPct = (value: number) => `${value < 0 ? '' : '+'}${value.toFixed(2)}%`;
const compactMoney = (value: number) => value >= 100_000_000
  ? `${(value / 100_000_000).toFixed(1)}億`
  : value >= 10_000 ? `${Math.round(value / 10_000)}萬` : money.format(value);

function MaField({ label, suffix, value, onChange, min = 0, step = 1 }: {
  label: string;
  suffix: string;
  value: number;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  min?: number;
  step?: number;
}) {
  return <label className="field"><span>{label}</span><div className="input-shell"><input type="number" min={min} step={step} value={value} onChange={onChange} /><b>{suffix}</b></div></label>;
}

function PortfolioChart({ points }: { points: Ma240CurvePoint[] }) {
  const width = 1080;
  const height = 310;
  const pad = { left: 66, right: 20, top: 22, bottom: 42 };
  const sampled = useMemo(() => {
    const step = Math.max(1, Math.ceil(points.length / 720));
    return points.filter((_, index) => index % step === 0 || index === points.length - 1);
  }, [points]);
  const max = Math.max(...points.flatMap((point) => [point.total, point.base, point.leveraged, point.invested]), 1);
  const x = (index: number) => pad.left + index / Math.max(1, sampled.length - 1) * (width - pad.left - pad.right);
  const y = (value: number) => pad.top + (1 - value / max) * (height - pad.top - pad.bottom);
  const path = (key: 'total' | 'base' | 'leveraged' | 'invested') => sampled
    .map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(point[key]).toFixed(1)}`).join(' ');
  const ticks = [0, .25, .5, .75, 1];
  const series = [
    { key: 'total' as const, name: '總資產', color: '#d0e73e' },
    { key: 'base' as const, name: '0050 部位', color: '#145f48' },
    { key: 'leveraged' as const, name: '00631L 部位', color: '#4786aa' },
    { key: 'invested' as const, name: '累計投入', color: '#9eaaa3' },
  ];
  return <div className="chart-wrap">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="240年線加碼策略資產曲線">
      {ticks.map((tick) => <g key={tick}>
        <line x1={pad.left} x2={width - pad.right} y1={y(max * tick)} y2={y(max * tick)} className="grid-line" />
        <text x={pad.left - 12} y={y(max * tick) + 4} textAnchor="end" className="axis-label">{compactMoney(max * tick)}</text>
      </g>)}
      {ticks.map((tick) => {
        const index = Math.round(tick * (sampled.length - 1));
        return <text key={`date-${tick}`} x={x(index)} y={height - 14} textAnchor="middle" className="axis-label">{sampled[index]?.date.slice(0, 7).replace('-', '/')}</text>;
      })}
      {series.map((item) => <path key={item.key} d={path(item.key)} fill="none" stroke={item.color} strokeWidth={item.key === 'total' ? 2.8 : 2} strokeDasharray={item.key === 'invested' ? '6 5' : undefined} />)}
    </svg>
    <div className="legend">{series.map((item) => <span key={item.key}><i style={{ background: item.color }} />{item.name}</span>)}</div>
  </div>;
}

function SignalChart({ points }: { points: Ma240CurvePoint[] }) {
  const width = 1080;
  const height = 270;
  const pad = { left: 66, right: 20, top: 22, bottom: 42 };
  const sampled = useMemo(() => {
    const step = Math.max(1, Math.ceil(points.length / 720));
    return points.filter((_, index) => index % step === 0 || index === points.length - 1);
  }, [points]);
  const min = Math.min(...points.flatMap((point) => [point.basePrice, point.movingAverage])) * .92;
  const max = Math.max(...points.flatMap((point) => [point.basePrice, point.movingAverage])) * 1.06;
  const x = (index: number) => pad.left + index / Math.max(1, sampled.length - 1) * (width - pad.left - pad.right);
  const y = (value: number) => pad.top + (1 - (value - min) / Math.max(1, max - min)) * (height - pad.top - pad.bottom);
  const path = (key: 'basePrice' | 'movingAverage') => sampled
    .map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(point[key]).toFixed(1)}`).join(' ');
  const ticks = [0, .25, .5, .75, 1];
  return <div className="chart-wrap signal-chart">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="0050與240日均線">
      {ticks.map((tick) => <g key={tick}>
        <line x1={pad.left} x2={width - pad.right} y1={y(min + (max - min) * tick)} y2={y(min + (max - min) * tick)} className="grid-line" />
        <text x={pad.left - 12} y={y(min + (max - min) * tick) + 4} textAnchor="end" className="axis-label">{(min + (max - min) * tick).toFixed(0)}</text>
      </g>)}
      <path d={path('basePrice')} fill="none" stroke="#145f48" strokeWidth="2.4" />
      <path d={path('movingAverage')} fill="none" stroke="#d0e73e" strokeWidth="2.4" />
    </svg>
    <div className="legend"><span><i style={{ background: '#145f48' }} />0050 收盤價</span><span><i style={{ background: '#d0e73e' }} />240MA</span></div>
  </div>;
}

export default function Ma240Strategy({ baseRows, leveragedRows }: { baseRows: OhlcRow[]; leveragedRows: OhlcRow[] }) {
  const [settings, setSettings] = useState(defaults);
  const [startDate, setStartDate] = useState('2015-01-01');
  const [endDate, setEndDate] = useState('2026-09-09');
  const [result, setResult] = useState<Ma240Result | null>(null);
  const [error, setError] = useState('');
  const resultRef = useRef<HTMLDivElement>(null);

  const execute = (scroll = true) => {
    try {
      const next = runMa240Backtest(baseRows, leveragedRows, startDate, endDate, settings);
      setResult(next);
      setError('');
      if (scroll) requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (reason) {
      setResult(null);
      setError(reason instanceof Error ? reason.message : '回測失敗');
    }
  };

  useEffect(() => {
    if (!baseRows.length || !leveragedRows.length) return;
    setEndDate(baseRows.at(-1)!.date);
    try {
      setResult(runMa240Backtest(baseRows, leveragedRows, '2015-01-01', baseRows.at(-1)!.date, defaults));
    } catch { setResult(null); }
  }, [baseRows, leveragedRows]);

  const setNumber = (key: keyof Ma240Settings) => (event: ChangeEvent<HTMLInputElement>) => {
    setSettings((current) => ({ ...current, [key]: Number(event.target.value) }));
  };

  return <div className="strategy-pane ma-strategy">
    <section className="workspace" id="ma-settings">
      <div className="section-heading"><div><span>01</span><h2>240 年線加碼規則</h2></div><p>訊號使用 0050，不看正二本身</p></div>
      <div className="ma-rule">
        <article><span>0050 在 240MA 之上</span><strong>新資金買 0050</strong><p>多頭軌道先累積原型 ETF，保留較低波動。</p></article>
        <i>或</i>
        <article className="below"><span>0050 在 240MA 之下</span><strong>新資金買 00631L</strong><p>市場修正時，用同一筆定期資金增加曝險。</p></article>
      </div>
      <p className="ma-principle"><b>只決定新錢買什麼：</b>既有部位不賣出、不因穿越年線換回；每月第一個可交易日依當日收盤價與 240MA 執行。</p>
    </section>

    <section className="workspace">
      <div className="section-heading"><div><span>02</span><h2>設定投入方式</h2></div><p>0050 與 00631L 均已套用分割還原</p></div>
      <div className="setting-block">
        <h3>回測期間</h3>
        <div className="form-grid dates">
          <label className="field"><span>開始日期</span><div className="input-shell"><input type="date" value={startDate} min="2015-01-01" max={endDate} onChange={(event) => setStartDate(event.target.value)} /></div></label>
          <label className="field"><span>結束日期</span><div className="input-shell"><input type="date" value={endDate} min={startDate} max={baseRows.at(-1)?.date} onChange={(event) => setEndDate(event.target.value)} /></div></label>
        </div>
      </div>
      <div className="setting-block">
        <h3>投入金額</h3>
        <div className="form-grid">
          <MaField label="起始投入" suffix="萬元" value={settings.initialWan} onChange={setNumber('initialWan')} min={1} />
          <MaField label="每月加碼" suffix="萬元" value={settings.monthlyWan} onChange={setNumber('monthlyWan')} />
          <label className="field"><span>訊號均線</span><div className="input-shell fixed-value"><strong>240</strong><b>交易日</b></div></label>
        </div>
      </div>
      <details className="costs">
        <summary>交易成本設定 <span>買進成本 {(settings.commissionPct * settings.discount / 10).toFixed(4)}%</span></summary>
        <div className="form-grid compact">
          <MaField label="手續費牌告" suffix="%" value={settings.commissionPct} onChange={setNumber('commissionPct')} step={0.0001} />
          <MaField label="手續費折數" suffix="折" value={settings.discount} onChange={setNumber('discount')} step={0.1} />
        </div>
      </details>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="run-button" onClick={() => execute()} disabled={!baseRows.length || !leveragedRows.length}><span>▶</span>執行 240 年線回測<small>每月第一個交易日投入</small></button>
    </section>

    {result && <section className="results" id="ma-results" ref={resultRef}>
      <div className="results-head"><div><p className="eyebrow">240MA BACKTEST</p><h2>回測結果</h2></div><div className="strategy-chip">年線上買 0050<b>年線下買 00631L</b></div></div>
      <div className="metrics ma-metrics">
        <article className="metric primary"><span>期末資產</span><strong>{money.format(result.ending)}<small>元</small></strong><p>累計投入 {money.format(result.totalInvested)} 元</p></article>
        <article className="metric"><span>累計損益</span><strong className={result.profit >= 0 ? 'positive' : 'negative'}>{result.profit >= 0 ? '+' : ''}{money.format(result.profit)}</strong></article>
        <article className="metric"><span>投入報酬率</span><strong className={result.totalReturn >= 0 ? 'positive' : 'negative'}>{signedPct(result.totalReturn)}</strong></article>
        <article className="metric"><span>時間加權年化</span><strong className={result.cagr >= 0 ? 'positive' : 'negative'}>{signedPct(result.cagr)}</strong></article>
        <article className="metric"><span>最大回撤 MDD</span><strong className="negative">−{result.mdd.toFixed(2)}%</strong></article>
      </div>
      <article className="panel chart-panel"><div className="panel-title"><h3>資產成長曲線</h3><span>含每月投入；灰色虛線為累計本金</span></div><PortfolioChart points={result.curve} /></article>
      <div className="two-column ma-columns">
        <article className="panel"><div className="panel-title"><h3>0050 與 240MA</h3><span>年線下的月份改買 00631L</span></div><SignalChart points={result.curve} /></article>
        <article className="panel annual-panel"><div className="panel-title"><h3>逐年報酬</h3><span>時間加權</span></div><div className="annual-list">{result.annual.map((row) => <div key={row.year}><b>{row.year}</b><span className={row.returnPct >= 0 ? 'positive' : 'negative'}>{signedPct(row.returnPct)}</span><em>{compactMoney(row.ending)}</em></div>)}</div></article>
      </div>
      <div className="buy-summary"><span><i className="base-dot" />年線上買 0050 <b>{result.baseBuys} 次</b></span><span><i className="leveraged-dot" />年線下買 00631L <b>{result.leveragedBuys} 次</b></span></div>
      <details className="panel trade-panel" open>
        <summary><span>每月加碼紀錄</span><b>{result.buys.length} 筆</b></summary>
        <div className="table-wrap"><table><thead><tr><th>日期</th><th>年線位置</th><th>0050 收盤</th><th>240MA</th><th>動作</th><th>投入金額</th></tr></thead><tbody>{result.buys.map((buy) => <tr key={buy.date}><td>{buy.date.replaceAll('-', '/')}</td><td className={buy.position}>{buy.position === 'above' ? '年線上' : '年線下'}</td><td>{buy.basePrice.toFixed(2)}</td><td>{buy.movingAverage.toFixed(2)}</td><td className={buy.position === 'above' ? 'buy' : 'leverage-buy'}>{buy.action}</td><td>{money.format(buy.amount)} 元</td></tr>)}</tbody></table></div>
      </details>
    </section>}

    <section className="method" id="ma-method"><div><span>03</span><h2>計算方式</h2></div><ol><li><b>先算 240MA</b><p>使用 0050 最近 240 個交易日收盤價平均，作為唯一訊號。</p></li><li><b>每月投入</b><p>每月第一個共同交易日，將設定的新資金投入當月指定標的。</p></li><li><b>只買不換回</b><p>既有 0050 與 00631L 持續持有，年線只影響下一筆新資金。</p></li></ol></section>
  </div>;
}
