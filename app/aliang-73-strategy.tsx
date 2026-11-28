'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { runAliang73Backtest, type Aliang73Prices, type Aliang73Settings } from './aliang-73-backtest';
import LineChart from './asset-chart';
import DrawdownChart, { DrawdownMetric } from './drawdown-chart';
import { adjust00662ForSplits, adjust00685LForSplits, type OhlcRow } from './price-adjustments';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

type MixPreset = '333' | '433' | '163' | '253' | 'custom';
const PRESETS: Record<Exclude<MixPreset, 'custom'>, { label: string; mix: { leveraged: number; nasdaq: number; cash: number } }> = {
  '333': { label: '三刀流 333（正二／00662／現金各 1/3）', mix: { leveraged: 100 / 3, nasdaq: 100 / 3, cash: 100 / 3 } },
  '433': { label: '433（00662 40%／正二 30%／現金 30%）', mix: { leveraged: 30, nasdaq: 40, cash: 30 } },
  '253': { label: '253 過渡（00662 20%／正二 50%／現金 30%）', mix: { leveraged: 50, nasdaq: 20, cash: 30 } },
  '163': { label: '163 過渡（00662 10%／正二 60%／現金 30%）', mix: { leveraged: 60, nasdaq: 10, cash: 30 } },
};

type Draft = {
  capitalWan: number;
  targetPct: number;
  monthlyWan: number;
  cashRatePct: number;
  rungsText: string;
  startDate: string;
  endDate: string;
  legMode: 'single' | 'half';
  retireEnabled: boolean;
  expenseWan: number;
  multiple: number;
  inflationPct: number;
  withdraw: boolean;
  preset: MixPreset;
  mixLev: number;
  mixNas: number;
  mixCash: number;
};

const defaults: Draft = {
  capitalWan: 1000,
  targetPct: 70,
  monthlyWan: 0,
  cashRatePct: 1.5,
  rungsText: '10, 20, 30, 40, 50',
  startDate: '',
  endDate: '',
  legMode: 'single',
  retireEnabled: true,
  expenseWan: 100,
  multiple: 20,
  inflationPct: 2,
  withdraw: true,
  preset: '333',
  mixLev: 33.3,
  mixNas: 33.3,
  mixCash: 33.4,
};

const money = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const percent = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
const parseRungs = (text: string) => text.split(/[,，\s]+/).filter(Boolean).map(Number);
const wan = (value: number) => `${money.format(Math.round(value / 10_000))} 萬`;

function toSettings(d: Draft, earliest: string, latest: string): Aliang73Settings {
  const mix = d.preset === 'custom' ? { leveraged: d.mixLev, nasdaq: d.mixNas, cash: d.mixCash } : PRESETS[d.preset].mix;
  return {
    capitalWan: d.capitalWan,
    targetPct: d.targetPct,
    monthlyWan: d.monthlyWan,
    cashRatePct: d.cashRatePct,
    rungs: parseRungs(d.rungsText),
    startDate: d.startDate || earliest,
    endDate: d.endDate || latest,
    legMode: d.legMode,
    retire: { enabled: d.retireEnabled, expenseWan: d.expenseWan, multiple: d.multiple, inflationPct: d.inflationPct, withdraw: d.withdraw, mix },
  };
}

export default function Aliang73Strategy({ baseRows, leveragedRows }: {
  baseRows: OhlcRow[];
  leveragedRows: OhlcRow[];
}) {
  const [draft, setDraft] = useState(defaults);
  const [applied, setApplied] = useState(defaults);
  const [extra, setExtra] = useState<Pick<Aliang73Prices, 'l685' | 'nasdaq' | 'bond'> | null>(null);
  const [loadError, setLoadError] = useState('');
  const resultRef = useRef<HTMLElement>(null);

  // 00685L、00662、00865B 只有這個分頁用得到，打開時才載入
  useEffect(() => {
    let alive = true;
    Promise.all(['00685L', '00662', '00865B'].map(async (name) => {
      const response = await fetch(`${BASE_PATH}/data/${name}.json`);
      if (!response.ok) throw new Error(name);
      return response.json() as Promise<OhlcRow[]>;
    }))
      .then(([l685, nasdaq, bond]) => {
        if (alive) setExtra({ l685: adjust00685LForSplits(l685).rows, nasdaq: adjust00662ForSplits(nasdaq).rows, bond });
      })
      .catch((reason) => alive && setLoadError(`無法載入 ${reason instanceof Error ? reason.message : ''} 資料。`));
    return () => { alive = false; };
  }, []);

  const earliest = leveragedRows[0]?.date ?? '';
  const latest = leveragedRows.at(-1)?.date ?? '';
  const startDate = draft.startDate || earliest;
  const endDate = draft.endDate || latest;
  const { result, error } = useMemo(() => {
    if (!baseRows.length || !leveragedRows.length || !extra) return { result: null, error: '' };
    try {
      return {
        result: runAliang73Backtest({ base: baseRows, l631: leveragedRows, ...extra }, toSettings(applied, earliest, latest)),
        error: '',
      };
    } catch (reason) {
      return { result: null, error: reason instanceof Error ? reason.message : '回測失敗。' };
    }
  }, [applied, baseRows, leveragedRows, extra, earliest, latest]);
  const drawdownPoints = useMemo(() =>
    result?.curve.map(({ date, total }) => ({ date, value: total })) ?? [],
  [result]);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft({ ...draft, [key]: value });
  const num = (key: keyof Draft) => (event: React.ChangeEvent<HTMLInputElement>) => set(key, Number(event.target.value) as never);
  const legName = applied.legMode === 'half' ? '00631L／00685L' : '00631L';
  const appliedMix = applied.preset === 'custom' ? `${applied.mixLev}/${applied.mixNas}/${applied.mixCash}` : applied.preset;

  return <div className="strategy-pane">
    <section className="workspace" id="aliang-settings">
      <div className="section-heading">
        <div><h2>阿良七三配 → 三刀流</h2></div>
        <p>累積期七三配不再平衡・達 20 倍年開銷轉 333 每年再平衡</p>
      </div>
      <form onSubmit={(event) => {
        event.preventDefault();
        setApplied(draft);
        requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth' }));
      }}>
        <div className="setting-block">
          <h3>回測期間</h3>
          <div className="form-grid dates">
            <label className="field"><span>開始日期</span><div className="input-shell"><input type="date" required value={startDate} min={earliest} max={endDate} onChange={(event) => set('startDate', event.target.value)} /></div></label>
            <label className="field"><span>結束日期</span><div className="input-shell"><input type="date" required value={endDate} min={startDate} max={latest} onChange={(event) => set('endDate', event.target.value)} /></div></label>
          </div>
        </div>

        <div className="setting-block">
          <h3>累積期：七三配</h3>
          <div className="form-grid compact">
            <label className="field"><span>起始資金</span><div className="input-shell"><input type="number" required min={1} value={draft.capitalWan || ''} onChange={num('capitalWan')} /><b>萬元</b></div></label>
            <label className="field"><span>正二占比</span><div className="input-shell"><input type="number" required min={1} max={100} step={1} value={draft.targetPct || ''} onChange={num('targetPct')} /><b>%</b></div></label>
            <label className="field"><span>正二標的</span><div className="input-shell"><select value={draft.legMode} onChange={(event) => set('legMode', event.target.value as Draft['legMode'])}>
              <option value="single">00631L 單檔（2014/10 起）</option>
              <option value="half">00631L／00685L 各半（2017/3 起）</option>
            </select></div></label>
            <label className="field"><span>每月新資金</span><div className="input-shell"><input type="number" min={0} step={0.5} value={draft.monthlyWan} onChange={num('monthlyWan')} /><b>萬元</b></div></label>
            <label className="field"><span>現金年利率</span><div className="input-shell"><input type="number" min={0} max={20} step={0.1} value={draft.cashRatePct} onChange={num('cashRatePct')} /><b>%</b></div></label>
            <label className="field"><span>大跌加碼階梯（距前高）</span><div className="input-shell"><input type="text" inputMode="decimal" value={draft.rungsText} onChange={(event) => set('rungsText', event.target.value)} /><b>%</b></div></label>
          </div>
          <p className="setting-help">新資金一樣七三配：每月第一個交易日開盤，七成買正二、三成進現金。00631L 從收盤前高回落到每個階梯時，投入「當下現金 ÷ 剩餘階數」；收盤創新高後階梯重置。選各半時，每筆買進都平分給兩檔，起始日自動移到 00685L 上市日。</p>
        </div>

        <div className="setting-block">
          <h3>退休期：降槓桿</h3>
          <label className="weekly-filter">
            <input type="checkbox" checked={draft.retireEnabled} onChange={(event) => set('retireEnabled', event.target.checked)} />
            <span>金融資產達年開銷 N 倍時退休，轉成退休配置</span>
          </label>
          {draft.retireEnabled && <>
            <label className="weekly-filter" style={{ marginBottom: 14 }}>
              <input type="checkbox" checked={draft.withdraw} onChange={(event) => set('withdraw', event.target.checked)} />
              <span>每年提領生活費</span>
            </label>
            <div className="form-grid compact">
              <label className="field"><span>年生活開銷（起始年）</span><div className="input-shell"><input type="number" min={1} step={1} value={draft.expenseWan || ''} onChange={num('expenseWan')} /><b>萬元</b></div></label>
              <label className="field"><span>退休門檻</span><div className="input-shell"><input type="number" min={1} step={1} value={draft.multiple || ''} onChange={num('multiple')} /><b>倍</b></div></label>
              <label className="field"><span>通膨（生活費年增）</span><div className="input-shell"><input type="number" min={0} max={20} step={0.1} value={draft.inflationPct} onChange={num('inflationPct')} /><b>%</b></div></label>
              <label className="field"><span>退休配置</span><div className="input-shell"><select value={draft.preset} onChange={(event) => set('preset', event.target.value as MixPreset)}>
                {Object.entries(PRESETS).map(([key, preset]) => <option key={key} value={key}>{preset.label}</option>)}
                <option value="custom">自訂</option>
              </select></div></label>
              {draft.preset === 'custom' && <>
                <label className="field"><span>正二</span><div className="input-shell"><input type="number" min={0} max={100} step={0.1} value={draft.mixLev} onChange={num('mixLev')} /><b>%</b></div></label>
                <label className="field"><span>00662</span><div className="input-shell"><input type="number" min={0} max={100} step={0.1} value={draft.mixNas} onChange={num('mixNas')} /><b>%</b></div></label>
                <label className="field"><span>現金／00865B</span><div className="input-shell"><input type="number" min={0} max={100} step={0.1} value={draft.mixCash} onChange={num('mixCash')} /><b>%</b></div></label>
              </>}
            </div>
            <p className="setting-help">每天收盤檢查：總資產 ≥ 當年年開銷 × 門檻倍數，就在當天收盤提領第一年生活費，再把剩下資產調成退休配置。之後每年最後一個交易日收盤提領下一年生活費（依通膨成長）並再平衡。現金部位在 00865B 上市（2021/1）前以現金計息，上市後放 00865B。退休後不再投入新資金，也不做大跌加碼。不勾「每年提領生活費」時，只轉配置、每年再平衡，年開銷僅用來判斷退休門檻。</p>
          </>}
        </div>
        {(error || loadError) && <p className="error" role="alert">{error || loadError}</p>}
        <button className="run-button" disabled={!earliest || !baseRows.length || !extra}><span>▶</span>{extra ? '執行七三配回測' : '載入 00685L／00662／00865B 資料中…'}</button>
      </form>
    </section>

    {result && <section className="results" id="aliang-results" ref={resultRef}>
      <div className="results-head">
        <div><h2>回測結果</h2></div>
        <div className="strategy-chip">七三配 {legName}<b>{applied.retireEnabled ? `${applied.multiple} 倍轉 ${appliedMix}${applied.withdraw ? '' : '・不提領'}` : '只看累積期'}</b></div>
      </div>
      {applied.retireEnabled && <p className="setting-help">
        {result.retiredAt
          ? <>於 <b>{result.retiredAt.replaceAll('-', '/')}</b> 達到門檻退休（當時資產 {wan(result.retiredTotal)}），{applied.withdraw ? `之後共提領生活費 ${wan(result.withdrawn)}。` : '之後每年再平衡、不提領。'}{result.depleted && <b> 資產已用盡。</b>}</>
          : result.waitingForNasdaq
            ? <>已達門檻，但 00662 尚未上市（2016/6 起），等上市後才轉換。</>
            : <>回測期間內尚未達到 {applied.multiple} 倍年開銷，全程維持累積期。</>}
      </p>}
      <div className="metrics">
        <article className="metric primary"><span>期末資產</span><strong>{money.format(result.ending)}<small>元</small></strong><p>投入本金 {money.format(result.invested)} 元{result.withdrawn > 0 && `・已提領 ${wan(result.withdrawn)}`}</p></article>
        <article className="metric"><span>總報酬率</span><strong className={result.totalReturn >= 0 ? 'positive' : 'negative'}>{percent(result.totalReturn)}</strong><p>（期末＋已提領）÷ 投入本金</p></article>
        <article className="metric"><span>{result.simple ? '複合年化報酬率' : '年化報酬（XIRR）'}</span><strong className={result.annualized >= 0 ? 'positive' : 'negative'}>{percent(result.annualized)}</strong><p>0050 同現金流 {percent(result.benchAnnualized)}</p></article>
        <DrawdownMetric points={drawdownPoints} />
        <article className="metric"><span>大跌加碼</span><strong>{result.dipCount}<small>次</small></strong><p>期末正二占比 {result.endingRatio.toFixed(1)}%</p></article>
      </div>
      {!applied.retireEnabled && applied.monthlyWan === 0 && result.endingRatio > 95 && <p className="setting-help">沒有新資金時，三成現金在前幾次大跌就會用完，之後正二占比會漂到接近 100%。這符合「累積期不做再平衡」；要維持三成現金，需要持續的新資金，或開啟退休期改成 333／433 並每年再平衡。</p>}
      <article className="panel chart-panel"><div className="panel-title"><h3>資產權益曲線</h3><span>總資產含 00662；0050 以相同現金流（投入買進、提領賣出）計算，採含息還原價</span></div><LineChart points={result.curve} benchmark={result.benchmark} labels={{ asset: '正二部位', cash: '現金＋00865B' }} /></article>
      <article className="panel drawdown-panel"><div className="panel-title"><h3>資產最大回撤</h3>{!result.simple && <span>含投入與提領，回撤金額會受現金流影響</span>}</div><DrawdownChart points={drawdownPoints} label="七三配策略資產回撤" /></article>
      <details className="panel trade-panel" open>
        <summary><span>交易明細</span><b>{result.trades.length} 筆</b></summary>
        <div className="table-wrap"><table>
          <thead><tr><th>日期</th><th>動作</th><th>00631L 價格</th><th>金額</th><th>成交後正二占比</th></tr></thead>
          <tbody>{result.trades.map((trade, index) => <tr key={index}>
            <td>{trade.date.replaceAll('-', '/')}</td>
            <td className={trade.amount < 0 ? 'sell' : 'buy'}>{trade.label}</td>
            <td>{trade.price.toFixed(2)}</td>
            <td>{trade.amount === 0 ? '—' : `${trade.amount < 0 ? '提領 ' : '買進 '}${money.format(Math.abs(trade.amount))} 元`}</td>
            <td>{trade.ratio.toFixed(1)}%</td>
          </tr>)}</tbody>
        </table></div>
      </details>
    </section>}

    <section className="method" id="aliang-method">
      <div><h2>計算方式</h2></div>
      <ol>
        <li><b>累積期：一次七三配到位</b><p>起始日開盤，起始資金的 70% 買正二、30% 留現金（緊急預備金兼加碼金）。節目建議不要等時機，盡快配置完成。正二可選 00631L 單檔，或節目建議的 00631L／00685L 各半。</p></li>
        <li><b>累積期不再平衡</b><p>正二漲上去就讓它漲，不賣出；現金只依年利率計息（日複利）。每月新資金一樣七三配。</p></li>
        <li><b>大跌才動用現金</b><p>節目只說大跌 10%～20% 時加碼。本回測預設：00631L 距收盤前高 −10%／−20%／−30%／−40%／−50%（約等於大盤 −5%～−25%）各投入一份現金（當下現金 ÷ 剩餘階數），階梯可自行調整。盤中觸價以門檻價成交，開盤跳空以開盤價成交；收盤創新高後重置。</p></li>
        <li><b>退休門檻：20 倍年開銷</b><p>金融資產（現金＋股票）達當年年開銷的 20 倍就退休。節目提到信貸要另外算（借來的本金先扣掉），本回測不含借貸，所以直接用總資產判斷。</p></li>
        <li><b>退休期：降到 beta ≤ 100% 並每年再平衡</b><p>預設三刀流 333：正二、00662、現金各 1/3（beta = 2/3 + 1/3 = 100%）。也可選 433、過渡用的 253、163 或自訂。每年最後一個交易日收盤先提領下一年生活費（依通膨成長；可關閉提領），再賣超配、買低配，調回目標比例；選各半時，00631L 與 00685L 也各自調回正二部位的一半。現金部位在 00865B 上市前以現金計息，上市後放 00865B。</p></li>
        <li><b>交易成本</b><p>買進手續費 0.1425% × 1.8 折；賣出股票型 ETF 另計 0.1% 證交稅，債券 ETF（00865B）免證交稅。</p></li>
        <li><b>簡化與限制</b><p>00685L 的大跌加碼成交價，以 00631L 同一時點的相對漲跌估算。不模擬質押、信貸、房貸等借款槓桿。</p></li>
      </ol>
    </section>
  </div>;
}
