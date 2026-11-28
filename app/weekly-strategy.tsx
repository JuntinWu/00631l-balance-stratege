'use client';

import { useMemo, useRef, useState } from 'react';
import LineChart from './asset-chart';
import DrawdownChart, { DrawdownMetric } from './drawdown-chart';
import type { OhlcRow } from './price-adjustments';
import { runWeeklyBacktest, type WeeklySettings } from './weekly-backtest';

const defaults: WeeklySettings = {
  capitalWan: 1000,
  targetPct: 60,
  startDate: '',
  endDate: '',
  requireAnnualDip: true,
};
const money = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const percent = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

export default function WeeklyStrategy({ baseRows, leveragedRows }: {
  baseRows: OhlcRow[];
  leveragedRows: OhlcRow[];
}) {
  const [draft, setDraft] = useState(defaults);
  const [applied, setApplied] = useState(defaults);
  const resultRef = useRef<HTMLElement>(null);
  const earliest = leveragedRows[0]?.date ?? '';
  const latest = leveragedRows.at(-1)?.date ?? '';
  const startDate = draft.startDate || earliest;
  const endDate = draft.endDate || latest;
  const { result, error } = useMemo(() => {
    if (!baseRows.length || !leveragedRows.length) return { result: null, error: '' };
    try {
      return {
        result: runWeeklyBacktest(baseRows, leveragedRows, {
          ...applied,
          startDate: applied.startDate || earliest,
          endDate: applied.endDate || latest,
        }),
        error: '',
      };
    } catch (reason) {
      return { result: null, error: reason instanceof Error ? reason.message : '回測失敗。' };
    }
  }, [applied, baseRows, leveragedRows, earliest, latest]);
  const drawdownPoints = useMemo(() =>
    result?.curve.map(({ date, total }) => ({ date, value: total })) ?? [],
  [result]);

  return <div className="strategy-pane">
    <section className="workspace" id="weekly-settings">
      <div className="section-heading">
        <div><h2>20 週均線減半・階梯加碼</h2></div>
        <p>0050 判斷均線・00631L 執行買賣</p>
      </div>
      <form onSubmit={(event) => {
        event.preventDefault();
        setApplied(draft);
        requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth' }));
      }}>
        <div className="setting-block">
          <h3>回測期間</h3>
          <div className="form-grid dates">
            <label className="field"><span>開始日期</span><div className="input-shell"><input type="date" required value={startDate} min={earliest} max={endDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} /></div></label>
            <label className="field"><span>結束日期</span><div className="input-shell"><input type="date" required value={endDate} min={startDate} max={latest} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })} /></div></label>
          </div>
        </div>
        <div className="setting-block">
          <h3>資金配置</h3>
          <div className="form-grid compact">
            <label className="field"><span>起始資金</span><div className="input-shell"><input type="number" required min={1} value={draft.capitalWan || ''} onChange={(event) => setDraft({ ...draft, capitalWan: Number(event.target.value) })} /><b>萬元</b></div></label>
            <label className="field"><span>正二目標占比</span><div className="input-shell"><input type="number" required min={1} max={100} step={0.1} value={draft.targetPct || ''} onChange={(event) => setDraft({ ...draft, targetPct: Number(event.target.value) })} /><b>%</b></div></label>
          </div>
          <label className="weekly-filter">
            <input type="checkbox" checked={draft.requireAnnualDip} onChange={(event) => setDraft({ ...draft, requireAnnualDip: event.target.checked })} />
            <span>0050 低於 240 日年線才加碼 00631L</span>
          </label>
          <p className="setting-help">減半後以 00631L 賣出價為基準，每跌 10 個百分點加碼當時總資產的 5%，最多六次，且以可用現金為限。</p>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="run-button" disabled={!earliest || !baseRows.length}><span>▶</span>執行 20 週均線回測</button>
      </form>
    </section>

    {result && <section className="results" id="weekly-results" ref={resultRef}>
      <div className="results-head">
        <div><h2>回測結果</h2></div>
        <div className="strategy-chip">正二目標 {applied.targetPct}%<b>{applied.requireAnnualDip ? '週線減半＋年線下加碼' : '週線減半＋階梯加碼'}</b></div>
      </div>
      <div className="metrics">
        <article className="metric primary"><span>期末資產</span><strong>{money.format(result.ending)}<small>元</small></strong><p>起始 {money.format(result.initial)} 元</p></article>
        <article className="metric"><span>總報酬率</span><strong className={result.totalReturn >= 0 ? 'positive' : 'negative'}>{percent(result.totalReturn)}</strong></article>
        <article className="metric"><span>複合年化報酬率</span><strong className={result.cagr >= 0 ? 'positive' : 'negative'}>{percent(result.cagr)}</strong></article>
        <DrawdownMetric points={drawdownPoints} />
        <article className="metric"><span>階梯加碼</span><strong>{result.dipCount}<small>次</small></strong></article>
      </div>
      <article className="panel chart-panel"><div className="panel-title"><h3>資產權益曲線</h3></div><LineChart points={result.curve} /></article>
      <article className="panel drawdown-panel"><div className="panel-title"><h3>資產最大回撤</h3></div><DrawdownChart points={drawdownPoints} label="20 週均線策略資產回撤" /></article>
      <details className="panel trade-panel" open>
        <summary><span>交易明細</span><b>{result.trades.length} 筆</b></summary>
        <div className="table-wrap"><table>
          <thead><tr><th>日期</th><th>動作</th><th>00631L 成交價</th><th>交易金額</th><th>成交後占比</th></tr></thead>
          <tbody>{result.trades.map((trade, index) => <tr key={index}>
            <td>{trade.date.replaceAll('-', '/')}</td>
            <td className={trade.amount < 0 ? 'sell' : trade.amount > 0 ? 'buy' : ''}>{trade.label}</td>
            <td>{trade.price.toFixed(2)}</td>
            <td>{trade.amount < 0 ? '賣出 ' : trade.amount > 0 ? '買進 ' : ''}{money.format(Math.abs(trade.amount))} 元</td>
            <td>{trade.ratio.toFixed(1)}%</td>
          </tr>)}</tbody>
        </table></div>
      </details>
    </section>}

    <section className="method" id="weekly-method">
      <div><h2>計算方式</h2></div>
      <ol>
        <li><b>週收盤決定持倉</b><p>0050 用最近 20 個已完成週的收盤價計算均線。週收盤低於均線，下一週首個共同交易日開盤賣出一半的 00631L。若起始已在均線下，直接以一半目標占比建倉。</p></li>
        <li><b>防守期間只加碼 00631L</b><p>以減半成交價（或半部位建倉價）計算 −10% 到 −60% 六個階梯。每階只買一次，盤中觸價以門檻價成交，開盤跳空則以開盤價成交。若開啟年線條件，以前一交易日的 0050 收盤確認。</p></li>
        <li><b>站回週線</b><p>0050 週收盤回到均線或以上，下一週首個共同交易日開盤恢復正二目標占比，並重置加碼階梯。</p></li>
        <li><b>交易成本</b><p>買賣手續費 0.1425% × 1.8 折，賣出另計 0.1% 交易稅。</p></li>
      </ol>
    </section>
  </div>;
}
