'use client';

import { useMemo, useRef, useState } from 'react';
import { runAliang73Backtest, type Aliang73Settings } from './aliang-73-backtest';
import LineChart from './asset-chart';
import DrawdownChart, { DrawdownMetric } from './drawdown-chart';
import type { OhlcRow } from './price-adjustments';

type Draft = Omit<Aliang73Settings, 'rungs'> & { rungsText: string };

const defaults: Draft = {
  capitalWan: 1000,
  targetPct: 70,
  monthlyWan: 0,
  cashRatePct: 1.5,
  rungsText: '20, 40, 60',
  startDate: '',
  endDate: '',
};
const money = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const percent = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
const parseRungs = (text: string) => text.split(/[,，\s]+/).filter(Boolean).map(Number);

export default function Aliang73Strategy({ baseRows, leveragedRows }: {
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
      const { rungsText, ...rest } = applied;
      return {
        result: runAliang73Backtest(baseRows, leveragedRows, {
          ...rest,
          rungs: parseRungs(rungsText),
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
  const hasMonthly = applied.monthlyWan > 0;

  return <div className="strategy-pane">
    <section className="workspace" id="aliang-settings">
      <div className="section-heading">
        <div><h2>阿良七三配（累積期）</h2></div>
        <p>七成正二・三成現金・不再平衡・大跌才加碼</p>
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
            <label className="field"><span>正二占比</span><div className="input-shell"><input type="number" required min={1} max={100} step={1} value={draft.targetPct || ''} onChange={(event) => setDraft({ ...draft, targetPct: Number(event.target.value) })} /><b>%</b></div></label>
            <label className="field"><span>每月新資金</span><div className="input-shell"><input type="number" min={0} step={0.5} value={draft.monthlyWan} onChange={(event) => setDraft({ ...draft, monthlyWan: Number(event.target.value) })} /><b>萬元</b></div></label>
            <label className="field"><span>現金年利率</span><div className="input-shell"><input type="number" min={0} max={20} step={0.1} value={draft.cashRatePct} onChange={(event) => setDraft({ ...draft, cashRatePct: Number(event.target.value) })} /><b>%</b></div></label>
            <label className="field"><span>大跌加碼階梯（距前高）</span><div className="input-shell"><input type="text" inputMode="decimal" value={draft.rungsText} onChange={(event) => setDraft({ ...draft, rungsText: event.target.value })} /><b>%</b></div></label>
          </div>
          <p className="setting-help">新資金一樣七三配：每月第一個交易日開盤，七成買 00631L、三成進現金。00631L 從收盤前高回落到每個階梯時，投入「當下現金 ÷ 剩餘階數」，最後一階用完現金；收盤創新高後階梯重置。留空階梯＝現金永遠不動。</p>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="run-button" disabled={!earliest || !baseRows.length}><span>▶</span>執行七三配回測</button>
      </form>
    </section>

    {result && <section className="results" id="aliang-results" ref={resultRef}>
      <div className="results-head">
        <div><h2>回測結果</h2></div>
        <div className="strategy-chip">正二 {applied.targetPct}% / 現金 {100 - applied.targetPct}%<b>{hasMonthly ? `每月 ${applied.monthlyWan} 萬七三配` : '單筆投入'}</b></div>
      </div>
      <div className="metrics">
        <article className="metric primary"><span>期末資產</span><strong>{money.format(result.ending)}<small>元</small></strong><p>投入本金 {money.format(result.invested)} 元</p></article>
        <article className="metric"><span>總報酬率</span><strong className={result.totalReturn >= 0 ? 'positive' : 'negative'}>{percent(result.totalReturn)}</strong><p>相對投入本金</p></article>
        <article className="metric"><span>{hasMonthly ? '年化報酬（XIRR）' : '複合年化報酬率'}</span><strong className={result.annualized >= 0 ? 'positive' : 'negative'}>{percent(result.annualized)}</strong><p>0050 同現金流 {percent(result.benchAnnualized)}</p></article>
        <DrawdownMetric points={drawdownPoints} />
        <article className="metric"><span>大跌加碼</span><strong>{result.dipCount}<small>次</small></strong><p>期末正二占比 {result.endingRatio.toFixed(1)}%</p></article>
      </div>
      {!hasMonthly && result.endingRatio > 95 && <p className="setting-help">沒有新資金時，三成現金在前幾次大跌就會用完，之後正二占比會漂到接近 100%。這符合「累積期不做再平衡」；要維持三成現金，需要持續的新資金（可設定每月新資金），或進入退休期改成 433／333 並每年再平衡。</p>}
      <article className="panel chart-panel"><div className="panel-title"><h3>資產權益曲線</h3><span>0050 以相同現金流（起始＋每月）在開盤買進，採含息還原價並計入買進手續費</span></div><LineChart points={result.curve} benchmark={result.benchmark} /></article>
      <article className="panel drawdown-panel"><div className="panel-title"><h3>資產最大回撤</h3>{hasMonthly && <span>含每月投入，回撤會被新資金略為稀釋</span>}</div><DrawdownChart points={drawdownPoints} label="七三配策略資產回撤" /></article>
      <details className="panel trade-panel" open>
        <summary><span>交易明細</span><b>{result.trades.length} 筆</b></summary>
        <div className="table-wrap"><table>
          <thead><tr><th>日期</th><th>動作</th><th>00631L 成交價</th><th>買進金額</th><th>成交後正二占比</th></tr></thead>
          <tbody>{result.trades.map((trade, index) => <tr key={index}>
            <td>{trade.date.replaceAll('-', '/')}</td>
            <td className="buy">{trade.label}</td>
            <td>{trade.price.toFixed(2)}</td>
            <td>{money.format(trade.amount)} 元</td>
            <td>{trade.ratio.toFixed(1)}%</td>
          </tr>)}</tbody>
        </table></div>
      </details>
    </section>}

    <section className="method" id="aliang-method">
      <div><h2>計算方式</h2></div>
      <ol>
        <li><b>一次配置到位</b><p>起始日開盤，起始資金的 70% 買進 00631L，30% 留作現金（緊急預備金兼加碼金）。節目建議不要等時機，盡快配置完成。</p></li>
        <li><b>累積期不再平衡</b><p>正二漲上去就讓它漲，不賣出、不做年度再平衡；現金部位固定，只依設定的年利率計息（日複利）。</p></li>
        <li><b>新資金一樣七三配</b><p>每月第一個交易日開盤投入新資金，七成買 00631L、三成進現金。</p></li>
        <li><b>大跌才動用現金</b><p>節目只說大跌 10%～20% 時加碼。本回測量化成：00631L 距收盤前高 −20%／−40%／−60%（約等於大盤 −10%／−20%／−30%）各投入一份現金。盤中觸價以門檻價成交，開盤跳空以開盤價成交；收盤創新高後重置階梯。</p></li>
        <li><b>交易成本</b><p>買進手續費 0.1425% × 1.8 折；累積期不賣出，所以不計交易稅。</p></li>
        <li><b>未納入回測</b><p>節目建議 00631L 與 00685L 各半，這裡只用 00631L。退休期（金融資產達年開銷 20 倍）改 433 或三刀流 333（正二／00662／現金或 00865B 各三分之一、每年再平衡），因缺少 00662、00865B 價格資料，目前不做回測。信貸、房貸借款槓桿也不納入。</p></li>
      </ol>
    </section>
  </div>;
}
