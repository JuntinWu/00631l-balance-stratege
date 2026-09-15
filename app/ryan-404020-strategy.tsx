'use client';

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  runRyan404020Backtest,
  type RyanCurvePoint,
  type RyanResult,
  type RyanSettings,
} from './ryan-404020-backtest';
import type { OhlcRow } from './price-adjustments';

const defaults: RyanSettings = {
  initialWan: 1000,
  commissionPct: 0.1425,
  discount: 1.8,
  transactionTaxPct: 0.1,
};

const money = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const signedPct = (value: number) => `${value < 0 ? '' : '+'}${value.toFixed(2)}%`;
const compactMoney = (value: number) => value >= 100_000_000
  ? `${(value / 100_000_000).toFixed(1)}億`
  : value >= 10_000 ? `${Math.round(value / 10_000)}萬` : money.format(value);

function RyanField({ label, suffix, value, onChange, min = 0, step = 1 }: {
  label: string;
  suffix: string;
  value: number;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  min?: number;
  step?: number;
}) {
  return <label className="field"><span>{label}</span><div className="input-shell"><input type="number" min={min} step={step} value={value} onChange={onChange} /><b>{suffix}</b></div></label>;
}

function ComparisonChart({ points }: { points: RyanCurvePoint[] }) {
  const width = 1080;
  const height = 330;
  const pad = { left: 66, right: 20, top: 22, bottom: 42 };
  const sampled = useMemo(() => {
    const step = Math.max(1, Math.ceil(points.length / 720));
    return points.filter((_, index) => index % step === 0 || index === points.length - 1);
  }, [points]);
  const max = Math.max(...points.flatMap((point) => [point.total, point.baseBenchmark, point.leveragedBenchmark, point.halfBenchmark]), 1);
  const x = (index: number) => pad.left + index / Math.max(1, sampled.length - 1) * (width - pad.left - pad.right);
  const y = (value: number) => pad.top + (1 - value / max) * (height - pad.top - pad.bottom);
  const path = (key: 'total' | 'baseBenchmark' | 'leveragedBenchmark' | 'halfBenchmark') => sampled
    .map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(point[key]).toFixed(1)}`).join(' ');
  const ticks = [0, .25, .5, .75, 1];
  const series = [
    { key: 'total' as const, name: '40/40/20 均線策略', color: '#d0e73e', width: 3 },
    { key: 'baseBenchmark' as const, name: '100% 0050', color: '#145f48', width: 2 },
    { key: 'leveragedBenchmark' as const, name: '100% 00631L', color: '#d06b45', width: 2 },
    { key: 'halfBenchmark' as const, name: '正二/現金 50/50', color: '#4786aa', width: 2 },
  ];
  return <div className="chart-wrap">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="40 40 20 均線策略與三種基準的資產曲線">
      {ticks.map((tick) => <g key={tick}>
        <line x1={pad.left} x2={width - pad.right} y1={y(max * tick)} y2={y(max * tick)} className="grid-line" />
        <text x={pad.left - 12} y={y(max * tick) + 4} textAnchor="end" className="axis-label">{compactMoney(max * tick)}</text>
      </g>)}
      {ticks.map((tick) => {
        const index = Math.round(tick * (sampled.length - 1));
        return <text key={`date-${tick}`} x={x(index)} y={height - 14} textAnchor="middle" className="axis-label">{sampled[index]?.date.slice(0, 7).replace('-', '/')}</text>;
      })}
      {series.map((item) => <path key={item.key} d={path(item.key)} fill="none" stroke={item.color} strokeWidth={item.width} strokeLinejoin="round" />)}
    </svg>
    <div className="legend">{series.map((item) => <span key={item.key}><i style={{ background: item.color }} />{item.name}</span>)}</div>
  </div>;
}

function SignalChart({ points }: { points: RyanCurvePoint[] }) {
  const width = 1080;
  const height = 270;
  const pad = { left: 66, right: 20, top: 22, bottom: 42 };
  const sampled = useMemo(() => {
    const step = Math.max(1, Math.ceil(points.length / 720));
    return points.filter((_, index) => index % step === 0 || index === points.length - 1);
  }, [points]);
  const min = Math.min(...points.flatMap((point) => [point.deviationPct, point.qqqDeviationPct]), -30) - 3;
  const max = Math.max(...points.flatMap((point) => [point.deviationPct, point.qqqDeviationPct]), 5) + 3;
  const x = (index: number) => pad.left + index / Math.max(1, sampled.length - 1) * (width - pad.left - pad.right);
  const y = (value: number) => pad.top + (1 - (value - min) / Math.max(1, max - min)) * (height - pad.top - pad.bottom);
  const path = (key: 'deviationPct' | 'qqqDeviationPct') => sampled.map((point, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(point[key]).toFixed(1)}`).join(' ');
  const levels = [-30, -20, -10, -5, -3, 0, 3, 5];
  return <div className="chart-wrap signal-chart ryan-signal-chart">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="0050 與 QQQ 相對各自 240 日均線的乖離率">
      {levels.filter((level) => level >= min && level <= max).map((level) => <g key={level}>
        <line x1={pad.left} x2={width - pad.right} y1={y(level)} y2={y(level)} className={`grid-line ${level === 0 ? 'zero-line' : ''}`} />
        <text x={pad.left - 12} y={y(level) + 4} textAnchor="end" className="axis-label">{level > 0 ? '+' : ''}{level}%</text>
      </g>)}
      <path d={path('deviationPct')} fill="none" stroke="#145f48" strokeWidth="2.4" />
      <path d={path('qqqDeviationPct')} fill="none" stroke="#d06b45" strokeWidth="2" />
    </svg>
    <div className="legend"><span><i style={{ background: '#145f48' }} />0050 對 240MA</span><span><i style={{ background: '#d06b45' }} />QQQ 對 240MA</span><span><i style={{ background: '#d0e73e' }} />+3% / +5% 反攻區</span></div>
  </div>;
}

const eventLabel = (kind: RyanResult['events'][number]['kind']) => ({
  initial: '初始配置',
  exit: '正二撤退',
  'left-buy': '左側加碼',
  'right-buy': '右側加碼',
  reentry: '重啟正二',
}[kind]);

export default function Ryan404020Strategy({ baseRows, leveragedRows, qqqRows }: { baseRows: OhlcRow[]; leveragedRows: OhlcRow[]; qqqRows: OhlcRow[] }) {
  const [settings, setSettings] = useState(defaults);
  const [startDate, setStartDate] = useState('2015-01-01');
  const [endDate, setEndDate] = useState('2026-09-09');
  const [result, setResult] = useState<RyanResult | null>(null);
  const [error, setError] = useState('');
  const resultRef = useRef<HTMLDivElement>(null);

  const execute = (scroll = true) => {
    try {
      const next = runRyan404020Backtest(baseRows, leveragedRows, qqqRows, startDate, endDate, settings);
      setResult(next);
      setError('');
      if (scroll) requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (reason) {
      setResult(null);
      setError(reason instanceof Error ? reason.message : '回測失敗');
    }
  };

  useEffect(() => {
    if (!baseRows.length || !leveragedRows.length || !qqqRows.length) return;
    const lastDate = baseRows.at(-1)!.date;
    setEndDate(lastDate);
    try {
      setResult(runRyan404020Backtest(baseRows, leveragedRows, qqqRows, '2015-01-01', lastDate, defaults));
    } catch { setResult(null); }
  }, [baseRows, leveragedRows, qqqRows]);

  const setNumber = (key: keyof RyanSettings) => (event: ChangeEvent<HTMLInputElement>) => {
    setSettings((current) => ({ ...current, [key]: Number(event.target.value) }));
  };

  return <div className="strategy-pane ryan-strategy">
    <section className="workspace" id="ryan-settings">
      <div className="section-heading"><div><span>01</span><h2>40 / 40 / 20 作戰配置</h2></div><p>底倉長抱・正二進退・現金保命</p></div>
      <div className="allocation-rule">
        <article><span>40%</span><strong>0050 原形底倉</strong><p>跟隨市場長期成長，策略期間不主動賣出。</p></article>
        <article className="attack"><span>40%</span><strong>00631L 攻擊部隊</strong><p>多頭放大資金效率，跌破年線時依 SOP 撤退。</p></article>
        <article className="reserve"><span>20%</span><strong>保命現金</strong><p>全程鎖定不投入，也不計入任何現金利息。</p></article>
      </div>

      <div className="sop-grid">
        <article className="sop-card danger"><b>撤退</b><h3>−3% 連 3 日，或單日 −5%</h3><p>0050 連續三日收在 240MA 下方 3%，次日開盤出清正二；單日收盤低於 5% 則當日出清。</p></article>
        <article className="sop-card smile"><b>承接</b><h3>年線下只買 0050</h3><p>向下穿越 −8 / −10 / −15 / −20 / −25 / −30%，各投入 5%；反彈向上收復同階梯，各投入 2%。</p></article>
        <article className="sop-card rally"><b>反攻</b><h3>+3% 連 3 日，或單日 +5%</h3><p>賣出底部承接的 0050，連同剩餘備戰金全數買回 00631L；40% 底倉與 20% 保命金不動。</p></article>
      </div>
      <div className="global-signal"><span>跨市場保險</span><strong>QQQ 跌破自身 240MA −10%</strong><p>無論 0050 當下位置，00631L 一律清倉；QQQ 訊號解除前不重啟正二。台股交易日只讀取當時已公布的最近一筆 QQQ 收盤，不使用 QLD。</p></div>
      <p className="ma-principle"><b>防禦 W 底：</b>每個循環中，每個左側與右側階梯各只觸發一次；跌破 −30% 後不再新增更深的加碼點。</p>
    </section>

    <section className="workspace">
      <div className="section-heading"><div><span>02</span><h2>設定回測條件</h2></div><p>0050 與 00631L 均已套用分割還原</p></div>
      <div className="setting-block">
        <h3>回測期間</h3>
        <div className="form-grid dates">
          <label className="field"><span>開始日期</span><div className="input-shell"><input type="date" value={startDate} min="2015-01-01" max={endDate} onChange={(event) => setStartDate(event.target.value)} /></div></label>
          <label className="field"><span>結束日期</span><div className="input-shell"><input type="date" value={endDate} min={startDate} max={baseRows.at(-1)?.date} onChange={(event) => setEndDate(event.target.value)} /></div></label>
        </div>
      </div>
      <div className="setting-block">
        <h3>起始資金</h3>
        <div className="form-grid">
          <RyanField label="投入金額" suffix="萬元" value={settings.initialWan} onChange={setNumber('initialWan')} min={1} />
          <label className="field"><span>初始投資部位</span><div className="input-shell fixed-value"><strong>80</strong><b>%</b></div></label>
          <label className="field"><span>鎖定保命現金</span><div className="input-shell fixed-value"><strong>20</strong><b>%</b></div></label>
        </div>
      </div>
      <details className="costs">
        <summary>交易成本設定 <span>買進 {(settings.commissionPct * settings.discount / 10).toFixed(4)}%・賣出另計 ETF 稅 {settings.transactionTaxPct}%</span></summary>
        <div className="form-grid compact">
          <RyanField label="手續費牌告" suffix="%" value={settings.commissionPct} onChange={setNumber('commissionPct')} step={0.0001} />
          <RyanField label="手續費折數" suffix="折" value={settings.discount} onChange={setNumber('discount')} step={0.1} />
          <RyanField label="ETF 交易稅（賣出）" suffix="%" value={settings.transactionTaxPct} onChange={setNumber('transactionTaxPct')} step={0.01} />
        </div>
      </details>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="run-button" onClick={() => execute()} disabled={!baseRows.length || !leveragedRows.length || !qqqRows.length}><span>▶</span>執行 40 / 40 / 20 回測<small>0050／00631L 交易，QQQ 只作跨市場訊號</small></button>
    </section>

    {result && <section className="results" id="ryan-results" ref={resultRef}>
      <div className="results-head"><div><p className="eyebrow">40 / 40 / 20 × 240 SMA</p><h2>回測結果</h2></div><div className="strategy-chip">40% 0050・40% 00631L<b>20% 保命現金</b></div></div>
      <div className="metrics ryan-metrics">
        <article className="metric primary"><span>期末資產</span><strong>{money.format(result.ending)}<small>元</small></strong><p>起始 {money.format(settings.initialWan * 10_000)} 元</p></article>
        <article className="metric"><span>總報酬率</span><strong className={result.totalReturn >= 0 ? 'positive' : 'negative'}>{signedPct(result.totalReturn)}</strong></article>
        <article className="metric"><span>CAGR 年化</span><strong className={result.cagr >= 0 ? 'positive' : 'negative'}>{signedPct(result.cagr)}</strong></article>
        <article className="metric"><span>最大回撤 MDD</span><strong className="negative">−{result.mdd.toFixed(2)}%</strong></article>
        <article className="metric"><span>上漲年度</span><strong>{result.positiveYears}<small> / {result.annual.length}</small></strong></article>
      </div>

      <article className="panel chart-panel"><div className="panel-title"><h3>策略與基準資產曲線</h3><span>相同起始資金；50/50 基準每年首個交易日再平衡</span></div><ComparisonChart points={result.curve} /></article>
      <div className="benchmark-grid">
        <article className="benchmark-card featured"><span>40 / 40 / 20</span><strong>{signedPct(result.cagr)}</strong><p>CAGR・MDD −{result.mdd.toFixed(2)}%</p></article>
        <article className="benchmark-card"><span>100% 0050</span><strong>{signedPct(result.comparisons.base.cagr)}</strong><p>CAGR・MDD −{result.comparisons.base.mdd.toFixed(2)}%</p></article>
        <article className="benchmark-card"><span>100% 00631L</span><strong>{signedPct(result.comparisons.leveraged.cagr)}</strong><p>CAGR・MDD −{result.comparisons.leveraged.mdd.toFixed(2)}%</p></article>
        <article className="benchmark-card"><span>50% 正二＋50% 現金</span><strong>{signedPct(result.comparisons.half.cagr)}</strong><p>CAGR・MDD −{result.comparisons.half.mdd.toFixed(2)}%</p></article>
      </div>

      <div className="two-column ryan-columns">
        <article className="panel"><div className="panel-title"><h3>0050／QQQ 對年線乖離</h3><span>QQQ −10% 時強制撤退正二</span></div><SignalChart points={result.curve} /></article>
        <article className="panel annual-panel"><div className="panel-title"><h3>逐年報酬</h3><span>{result.positiveYears} 年上漲</span></div><div className="annual-list">{result.annual.map((row) => <div key={row.year}><b>{row.year}</b><span className={row.returnPct >= 0 ? 'positive' : 'negative'}>{signedPct(row.returnPct)}</span><em>{compactMoney(row.ending)}</em></div>)}</div></article>
      </div>

      <div className="allocation-summary">
        <span>撤退 <b>{result.exitCount} 次</b></span><span>其中 QQQ 強制撤退 <b>{result.qqqExitCount} 次</b></span><span>重啟正二 <b>{result.reentryCount} 次</b></span><span>左側加碼 <b>{result.leftBuyCount} 次</b></span><span>右側加碼 <b>{result.rightBuyCount} 次</b></span>
        <span>期末：0050 底倉 <b>{result.endingWeights.core.toFixed(1)}%</b>・底部 0050 <b>{result.endingWeights.tacticalBase.toFixed(1)}%</b>・00631L <b>{result.endingWeights.leveraged.toFixed(1)}%</b>・現金 <b>{(result.endingWeights.reserve + result.endingWeights.tacticalCash).toFixed(1)}%</b></span>
      </div>

      <details className="panel trade-panel" open>
        <summary><span>策略事件明細</span><b>{result.events.length} 筆</b></summary>
        <div className="table-wrap"><table><thead><tr><th>日期</th><th>事件</th><th>訊號</th><th>0050 乖離</th><th>0050</th><th>00631L</th><th>交易金額</th></tr></thead><tbody>{result.events.map((event, index) => <tr key={`${event.date}-${event.kind}-${index}`}><td>{event.date.replaceAll('-', '/')}</td><td className={event.kind === 'exit' ? 'sell' : event.kind === 'reentry' ? 'leverage-buy' : 'buy'}>{eventLabel(event.kind)}</td><td>{event.signal}</td><td className={event.deviationPct >= 0 ? 'positive' : 'negative'}>{signedPct(event.deviationPct)}</td><td>{event.basePrice.toFixed(2)}</td><td>{event.leveragedPrice.toFixed(2)}</td><td>{money.format(event.amount)} 元</td></tr>)}</tbody></table></div>
      </details>
      <p className="backtest-note">資料範圍受 00631L 上市日限制；0050 與 00631L 價格已還原 ETF 分割，QQQ 日線來自 Yahoo Finance。未納入股息再投入、匯率、現金利息與滑價。歷史績效不代表未來報酬。</p>
    </section>}

    <section className="method" id="ryan-method"><div><span>03</span><h2>回測口徑</h2></div><ol><li><b>固定底倉與保命金</b><p>起始以 40% 買 0050、40% 買 00631L、20% 留現金；底倉與保命金不參與換倉。</p></li><li><b>收盤確認、次日成交</b><p>單日 ±5% 訊號以當日收盤成交；連續三日 ±3% 訊號於下一個共同交易日開盤成交，避免偷看未來。</p></li><li><b>QQQ 採已知資訊</b><p>每個台股交易日使用日期早於該日、最近一筆可得的 QQQ 收盤與 240MA；低於 −10% 時清空 00631L，未解除時不重新進場。</p></li><li><b>微笑曲線按循環控管</b><p>正二撤退後，以撤退當下總資產為階梯金額基準；左側每階 5%、右側每階 2%，各方向同一階只買一次，且以可用備戰金為上限。</p></li><li><b>基準保持可比較</b><p>0050 與 00631L 基準皆為起始一次買進；50/50 基準每年首個交易日調回正二與現金各半，三者均計入相同交易成本。</p></li></ol></section>
    <p className="video-source">策略規則整理自 YouTube 頻道「上班靠工資下班靠投資」：<a href="https://www.youtube.com/watch?v=gHrSgY-fUp4" target="_blank" rel="noreferrer">觀看原始影片 ↗</a></p>
  </div>;
}
