'use client';

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Ma240Strategy from './ma240-strategy';
import { adjust0050ForSplits, adjust00631LForSplits, type OhlcRow } from './price-adjustments';

type PriceRow = OhlcRow;
type Settings = {
  capitalWan: number;
  targetPct: number;
  commissionPct: number;
  discount: number;
  taxPct: number;
  upPct: number;
  downPct: number;
};
type CurvePoint = { date: string; total: number; asset: number; cash: number; ratio: number };
type Trade = {
  date: string;
  trigger: string;
  reference: number;
  action: string;
  amount: number;
  ratio: number;
};
type AnnualRow = { year: string; returnPct: number; ending: number };
type Result = {
  curve: CurvePoint[];
  trades: Trade[];
  annual: AnnualRow[];
  totalReturn: number;
  cagr: number;
  mdd: number;
  ending: number;
  buyFee: number;
  sellFee: number;
};

const defaultSettings: Settings = {
  capitalWan: 1000,
  targetPct: 60,
  commissionPct: 0.1425,
  discount: 1.8,
  taxPct: 0.1,
  upPct: 70,
  downPct: 30,
};

const money = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const pct = (value: number) => `${value < 0 ? '' : '+'}${value.toFixed(2)}%`;
const compactMoney = (value: number) => {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}億`;
  if (value >= 10_000) return `${Math.round(value / 10_000)}萬`;
  return money.format(value);
};

function rebalance(
  shares: number,
  cash: number,
  price: number,
  target: number,
  buyFee: number,
  sellFee: number,
) {
  const asset = shares * price;
  const total = asset + cash;
  const gap = target * total - asset;
  if (Math.abs(gap) < 0.01) return { shares, cash, action: '維持配置', amount: 0 };

  if (gap > 0) {
    const spend = Math.min(cash, (gap * (1 + buyFee)) / (1 + target * buyFee));
    const grossAsset = spend / (1 + buyFee);
    return {
      shares: shares + grossAsset / price,
      cash: cash - spend,
      action: '買進00631L',
      amount: spend,
    };
  }

  const grossSale = Math.min(asset, (asset - target * total) / (1 - target * sellFee));
  return {
    shares: shares - grossSale / price,
    cash: cash + grossSale * (1 - sellFee),
    action: '賣出00631L',
    amount: grossSale,
  };
}

function runBacktest(rows: PriceRow[], settings: Settings): Result {
  const initial = settings.capitalWan * 10_000;
  const target = Math.min(0.99, Math.max(0.01, settings.targetPct / 100));
  const buyFee = (settings.commissionPct / 100) * (settings.discount / 10);
  const sellFee = buyFee + settings.taxPct / 100;
  const up = Math.max(0.001, settings.upPct / 100);
  const down = Math.max(0.001, settings.downPct / 100);
  let shares = 0;
  let cash = initial;
  let reference = rows[0].close;
  let peak = initial;
  let mdd = 0;
  const curve: CurvePoint[] = [];
  const trades: Trade[] = [];

  const opened = rebalance(shares, cash, reference, target, buyFee, sellFee);
  shares = opened.shares;
  cash = opened.cash;
  trades.push({
    date: rows[0].date,
    trigger: '初始建倉',
    reference,
    action: '初始建倉',
    amount: initial - cash,
    ratio: target * 100,
  });

  for (const row of rows) {
    const checkpoints: Array<[string, number]> = [
      ['開盤觸發', row.open],
      ['盤中最高價', row.high],
      ['盤中最低價', row.low],
      ['收盤觸發', row.close],
    ];
    for (const [label, price] of checkpoints) {
      const isUp = price >= reference * (1 + up);
      const isDown = price <= reference * (1 - down);
      if (!isUp && !isDown) continue;
      const next = rebalance(shares, cash, price, target, buyFee, sellFee);
      shares = next.shares;
      cash = next.cash;
      reference = price;
      const total = shares * price + cash;
      trades.push({
        date: row.date,
        trigger: label,
        reference: price,
        action: next.action,
        amount: next.amount,
        ratio: total ? (shares * price * 100) / total : 0,
      });
    }
    const asset = shares * row.close;
    const total = asset + cash;
    peak = Math.max(peak, total);
    mdd = Math.max(mdd, peak ? (peak - total) / peak : 0);
    curve.push({ date: row.date, total, asset, cash, ratio: total ? (asset * 100) / total : 0 });
  }

  const annual: AnnualRow[] = [];
  let priorEnding = initial;
  const years = new Map<string, CurvePoint>();
  for (const point of curve) years.set(point.date.slice(0, 4), point);
  for (const [year, point] of years) {
    annual.push({ year, returnPct: (point.total / priorEnding - 1) * 100, ending: point.total });
    priorEnding = point.total;
  }
  const ending = curve.at(-1)?.total ?? initial;
  const startMs = new Date(rows[0].date).getTime();
  const endMs = new Date(rows.at(-1)!.date).getTime();
  const yearsElapsed = Math.max((endMs - startMs) / (365.25 * 864e5), 1 / 365.25);
  return {
    curve,
    trades,
    annual,
    totalReturn: (ending / initial - 1) * 100,
    cagr: (Math.pow(ending / initial, 1 / yearsElapsed) - 1) * 100,
    mdd: mdd * 100,
    ending,
    buyFee,
    sellFee,
  };
}

function LineChart({ points, ratio = false }: { points: CurvePoint[]; ratio?: boolean }) {
  const width = 1080;
  const height = 310;
  const pad = { left: 66, right: 20, top: 22, bottom: 42 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const sampled = useMemo(() => {
    if (points.length <= 720) return points;
    const step = Math.ceil(points.length / 720);
    return points.filter((_, i) => i % step === 0 || i === points.length - 1);
  }, [points]);
  const series = ratio
    ? [{ key: 'ratio' as const, color: '#62e6ba', name: '00631L占比' }]
    : [
        { key: 'total' as const, color: '#ffd166', name: '總資產' },
        { key: 'asset' as const, color: '#62e6ba', name: '00631L部位' },
        { key: 'cash' as const, color: '#9fb3d7', name: '現金' },
      ];
  const max = ratio ? 100 : Math.max(...points.flatMap((p) => [p.total, p.asset, p.cash]), 1);
  const x = (i: number) => pad.left + (i / Math.max(1, sampled.length - 1)) * plotW;
  const y = (value: number) => pad.top + (1 - value / Math.max(1, max)) * plotH;
  const path = (key: 'total' | 'asset' | 'cash' | 'ratio') =>
    sampled.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const dateTicks = ticks.map((n) => Math.min(sampled.length - 1, Math.round(n * (sampled.length - 1))));

  if (!points.length) return null;
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ratio ? '00631L占比走勢圖' : '資產權益曲線'}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={y(max * t)} y2={y(max * t)} className="grid-line" />
            <text x={pad.left - 12} y={y(max * t) + 4} textAnchor="end" className="axis-label">
              {ratio ? `${Math.round(t * 100)}%` : compactMoney(max * t)}
            </text>
          </g>
        ))}
        {dateTicks.map((index) => (
          <g key={`${index}-${sampled[index]?.date}`}>
            <line x1={x(index)} x2={x(index)} y1={pad.top} y2={height - pad.bottom} className="grid-line vertical" />
            <text x={x(index)} y={height - 14} textAnchor="middle" className="axis-label">
              {sampled[index]?.date.slice(0, 7).replace('-', '/')}
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
      </svg>
      <div className="legend">
        {series.map((item) => <span key={item.key}><i style={{ background: item.color }} />{item.name}</span>)}
      </div>
    </div>
  );
}

function Field({ label, suffix, children }: { label: string; suffix?: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span><div className="input-shell">{children}{suffix && <b>{suffix}</b>}</div></label>;
}

function parseCsv(text: string): PriceRow[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('CSV 至少需要標題列與一筆資料');
  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const headers = lines[0].split(delimiter).map((v) => v.trim().replace(/^"|"$/g, '').toLowerCase());
  const find = (...names: string[]) => headers.findIndex((h) => names.includes(h));
  const columns = {
    date: find('date', '日期'),
    open: find('open', '開盤', '開盤價'),
    high: find('high', '最高', '最高價'),
    low: find('low', '最低', '最低價'),
    close: find('close', '收盤', '收盤價'),
  };
  if (Object.values(columns).some((i) => i < 0)) throw new Error('需要 date、open、high、low、close 欄位');
  const clean = (value: string) => Number(value.replace(/[",]/g, ''));
  const result = lines.slice(1).map((line) => {
    const cells = line.split(delimiter).map((v) => v.trim());
    const date = cells[columns.date].replace(/^"|"$/g, '').replaceAll('/', '-');
    return { date, open: clean(cells[columns.open]), high: clean(cells[columns.high]), low: clean(cells[columns.low]), close: clean(cells[columns.close]) };
  }).filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && [row.open, row.high, row.low, row.close].every(Number.isFinite));
  if (!result.length) throw new Error('找不到可用的價格資料');
  return result.sort((a, b) => a.date.localeCompare(b.date));
}

export default function Home() {
  const [data, setData] = useState<PriceRow[]>([]);
  const [builtinData, setBuiltinData] = useState<PriceRow[]>([]);
  const [baseData, setBaseData] = useState<PriceRow[]>([]);
  const [activeStrategy, setActiveStrategy] = useState<'threshold' | 'ma240'>('threshold');
  const [dataName, setDataName] = useState('尚未選擇檔案');
  const [isCustom, setIsCustom] = useState(false);
  const [splitAdjusted, setSplitAdjusted] = useState(false);
  const [settings, setSettings] = useState(defaultSettings);
  const [startDate, setStartDate] = useState('2014-10-31');
  const [endDate, setEndDate] = useState('2026-09-09');
  const [result, setResult] = useState<Result | null>(null);
  const [status, setStatus] = useState('正在載入 00631L 歷史資料…');
  const [error, setError] = useState('');
  const resultRef = useRef<HTMLDivElement>(null);

  const execute = useCallback((source = data, scroll = true) => {
    setError('');
    const rows = source.filter((row) => row.date >= startDate && row.date <= endDate);
    if (rows.length < 2) {
      setError('所選期間至少需要 2 個交易日');
      return;
    }
    const next = runBacktest(rows, settings);
    setResult(next);
    setStatus(`已完成 ${money.format(rows.length)} 個交易日的回測`);
    if (scroll) requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [data, endDate, settings, startDate]);

  useEffect(() => {
    Promise.all([fetch('/data/00631L.json'), fetch('/data/0050.json')])
      .then(async ([leveragedResponse, baseResponse]) => {
        if (!leveragedResponse.ok || !baseResponse.ok) throw new Error('資料載入失敗');
        const [rawLeveraged, rawBase] = await Promise.all([
          leveragedResponse.json() as Promise<PriceRow[]>,
          baseResponse.json() as Promise<PriceRow[]>,
        ]);
        return {
          leveraged: adjust00631LForSplits(rawLeveraged),
          base: adjust0050ForSplits(rawBase),
        };
      })
      .then(({ leveraged, base }) => {
        const rows = leveraged.rows;
        setData(rows);
        setBuiltinData(rows);
        setBaseData(base.rows);
        setSplitAdjusted(leveraged.appliedSplits.length > 0);
        setStartDate(rows[0].date);
        setEndDate(rows.at(-1)!.date);
        setStatus(`內建 00631L，共 ${money.format(rows.length)} 筆`);
        setResult(runBacktest(rows, defaultSettings));
      })
      .catch(() => setError('無法載入內建資料，請改用 CSV 匯入。'));
  }, []);

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const normalized = adjust00631LForSplits(parseCsv(await file.text()));
      const rows = normalized.rows;
      setData(rows);
      setDataName(file.name);
      setIsCustom(true);
      setSplitAdjusted(normalized.appliedSplits.length > 0);
      setStartDate(rows[0].date);
      setEndDate(rows.at(-1)!.date);
      setResult(null);
      setError('');
      setStatus(`已載入 ${file.name}，共 ${money.format(rows.length)} 筆`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'CSV 讀取失敗');
    }
    event.target.value = '';
  };

  const useBuiltin = () => {
    if (!builtinData.length) return;
    setData(builtinData);
    setDataName('尚未選擇檔案');
    setIsCustom(false);
    setSplitAdjusted(true);
    setStartDate(builtinData[0].date);
    setEndDate(builtinData.at(-1)!.date);
    setResult(runBacktest(builtinData, settings));
    setError('');
    setStatus(`內建 00631L，共 ${money.format(builtinData.length)} 筆`);
  };

  const setNumber = (key: keyof Settings) => (event: ChangeEvent<HTMLInputElement>) => {
    setSettings((value) => ({ ...value, [key]: Number(event.target.value) }));
  };
  const filteredCount = data.filter((row) => row.date >= startDate && row.date <= endDate).length;

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="00631L 回測策略首頁"><span className="brand-mark">回</span><span>00631L 回測策略</span></a>
        <nav aria-label="頁面導覽"><a href={activeStrategy === 'threshold' ? '#settings' : '#ma-settings'}>策略設定</a><a href={activeStrategy === 'threshold' ? '#results' : '#ma-results'}>回測結果</a><a href={activeStrategy === 'threshold' ? '#method' : '#ma-method'}>計算說明</a></nav>
        <span className="status-pill"><i />本機運算，不上傳資料</span>
      </header>

      <div className="page" id="top">
        <section className="hero">
          <div>
            <p className="eyebrow">{activeStrategy === 'threshold' ? '00631L × 現金' : '0050 240MA × 每月加碼'}</p>
            <h1>00631L<br /><em>回測策略</em></h1>
            <p className="hero-copy">{activeStrategy === 'threshold' ? '當價格跨越設定門檻，自動將 00631L 與現金調回目標比例。用歷史資料快速檢視報酬、回撤與每次交易。' : '用 0050 的 240 日均線決定每月新資金的去向：年線上買 0050，年線下買 00631L。'}</p>
          </div>
          {activeStrategy === 'threshold'
            ? <div className="hero-note"><span>規則</span><strong>漲到上門檻</strong><b>賣出正二</b><hr /><strong>跌到下門檻</strong><b>買進正二</b></div>
            : <div className="hero-note ma-note"><span>240MA</span><strong>年線之上</strong><b>新資金買 0050</b><hr /><strong>年線之下</strong><b>新資金買 00631L</b></div>}
        </section>

        <div className="strategy-tabs" role="tablist" aria-label="選擇回測策略">
          <button role="tab" aria-selected={activeStrategy === 'threshold'} className={activeStrategy === 'threshold' ? 'active' : ''} onClick={() => setActiveStrategy('threshold')}><span>01</span><strong>門檻式再平衡</strong><small>價格漲跌觸發</small></button>
          <button role="tab" aria-selected={activeStrategy === 'ma240'} className={activeStrategy === 'ma240' ? 'active' : ''} onClick={() => setActiveStrategy('ma240')}><span>02</span><strong>240 年線加碼</strong><small>新資金擇標的</small></button>
        </div>

        {activeStrategy === 'threshold' ? <>
        <section className="workspace" id="settings">
          <div className="section-heading"><div><span>01</span><h2>載入價格資料</h2></div><p>支援內建資料或自行匯入 CSV</p></div>
          <div className="source-grid">
            <label className={`source-card ${!isCustom ? 'selected' : ''}`} onClick={useBuiltin}>
              <input type="radio" name="source" checked={!isCustom} readOnly />
              <span className="source-icon">↗</span>
              <span><strong>內建 00631L 歷史資料</strong><small>{!isCustom ? status : `${money.format(builtinData.length)} 筆，可隨時切回`}</small></span>
              <i>{!isCustom ? '使用中' : '切換'}</i>
            </label>
            <label className={`source-card upload ${isCustom ? 'selected' : ''}`}>
              <input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" onChange={onFile} />
              <span className="source-icon">＋</span>
              <span><strong>匯入自訂 CSV</strong><small>{isCustom ? dataName : '日期、開高低收五個欄位'}</small></span>
              <i>{isCustom ? '更換檔案' : '選擇檔案'}</i>
            </label>
          </div>
          <p className="data-footnote">
            {splitAdjusted && <span className="adjusted-badge">✓ 已還原 2026/03/31 的 22：1 分割</span>}
            資料來源：FinMind TaiwanStockPrice 公開資料集。回測結果僅供研究，不構成投資建議。
          </p>
        </section>

        <section className="workspace">
          <div className="section-heading"><div><span>02</span><h2>設定回測條件</h2></div><p>{money.format(filteredCount)} 個交易日</p></div>
          <div className="setting-block">
            <h3>回測期間</h3>
            <div className="form-grid dates">
              <Field label="起始配置日"><input type="date" value={startDate} min={data[0]?.date} max={endDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
              <Field label="回測結束日"><input type="date" value={endDate} min={startDate} max={data.at(-1)?.date} onChange={(e) => setEndDate(e.target.value)} /></Field>
            </div>
          </div>
          <div className="setting-block">
            <h3>資產配置</h3>
            <div className="form-grid">
              <Field label="起始資金" suffix="萬元"><input type="number" min="1" value={settings.capitalWan} onChange={setNumber('capitalWan')} /></Field>
              <Field label="00631L 目標比例" suffix="%"><input type="number" min="1" max="99" value={settings.targetPct} onChange={setNumber('targetPct')} /></Field>
              <Field label="現金比例" suffix="%"><input type="number" value={100 - settings.targetPct} disabled /></Field>
            </div>
          </div>
          <div className="setting-block threshold-block">
            <div><h3>價格門檻</h3><p>每次觸發後，參考價會重設為當下價格</p></div>
            <div className="threshold-visual">
              <span className="up">+{settings.upPct}%<small>上漲門檻</small></span>
              <i /><b>參考價</b><i />
              <span className="down">−{settings.downPct}%<small>下跌門檻</small></span>
            </div>
            <div className="form-grid compact">
              <Field label="上漲門檻" suffix="%"><input type="number" min="0.1" step="0.1" value={settings.upPct} onChange={setNumber('upPct')} /></Field>
              <Field label="下跌門檻" suffix="%"><input type="number" min="0.1" step="0.1" value={settings.downPct} onChange={setNumber('downPct')} /></Field>
            </div>
          </div>
          <details className="costs">
            <summary>交易成本設定 <span>買進 {(settings.commissionPct * settings.discount / 10).toFixed(4)}%・賣出 {(settings.commissionPct * settings.discount / 10 + settings.taxPct).toFixed(4)}%</span></summary>
            <div className="form-grid">
              <Field label="手續費牌告" suffix="%"><input type="number" step="0.0001" value={settings.commissionPct} onChange={setNumber('commissionPct')} /></Field>
              <Field label="手續費折數" suffix="折"><input type="number" step="0.1" value={settings.discount} onChange={setNumber('discount')} /></Field>
              <Field label="證交稅（賣出）" suffix="%"><input type="number" step="0.01" value={settings.taxPct} onChange={setNumber('taxPct')} /></Field>
            </div>
          </details>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="run-button" onClick={() => execute()} disabled={!data.length}><span>▶</span>執行門檻回測<small>以開盤 → 最高 → 最低 → 收盤順序檢查</small></button>
        </section>

        {result && <section className="results" id="results" ref={resultRef}>
          <div className="results-head"><div><p className="eyebrow">BACKTEST COMPLETE</p><h2>回測結果</h2></div><div className="strategy-chip">00631L {settings.targetPct}% / 現金 {100 - settings.targetPct}%<b>＋{settings.upPct}% / −{settings.downPct}%</b></div></div>
          <div className="metrics">
            <article className="metric primary"><span>期末資產</span><strong>{money.format(result.ending)}<small>元</small></strong><p>起始 {money.format(settings.capitalWan * 10000)} 元</p></article>
            <article className="metric"><span>總報酬率</span><strong className={result.totalReturn >= 0 ? 'positive' : 'negative'}>{pct(result.totalReturn)}</strong></article>
            <article className="metric"><span>CAGR 年化</span><strong className={result.cagr >= 0 ? 'positive' : 'negative'}>{pct(result.cagr)}</strong></article>
            <article className="metric"><span>最大回撤 MDD</span><strong className="negative">−{result.mdd.toFixed(2)}%</strong></article>
            <article className="metric"><span>再平衡次數</span><strong>{Math.max(0, result.trades.length - 1)}<small>次</small></strong></article>
          </div>

          <article className="panel chart-panel"><div className="panel-title"><h3>資產權益曲線</h3><span>總資產 / 00631L 部位 / 現金</span></div><LineChart points={result.curve} /></article>
          <div className="two-column">
            <article className="panel"><div className="panel-title"><h3>00631L 占比走勢</h3><span>觸發後回到 {settings.targetPct}%</span></div><LineChart points={result.curve} ratio /></article>
            <article className="panel annual-panel"><div className="panel-title"><h3>逐年報酬</h3><span>{result.annual.length} 個年度</span></div><div className="annual-list">{result.annual.map((row) => <div key={row.year}><b>{row.year}</b><span className={row.returnPct >= 0 ? 'positive' : 'negative'}>{pct(row.returnPct)}</span><em>{compactMoney(row.ending)}</em></div>)}</div></article>
          </div>
          <details className="panel trade-panel" open>
            <summary><span>再平衡事件明細</span><b>{result.trades.length} 筆</b></summary>
            <div className="table-wrap"><table><thead><tr><th>日期</th><th>觸發點</th><th>新參考價</th><th>動作</th><th>金額</th><th>調整後占比</th></tr></thead><tbody>{result.trades.map((trade, i) => <tr key={`${trade.date}-${i}`}><td>{trade.date.replaceAll('-', '/')}</td><td>{trade.trigger}</td><td>{trade.reference.toFixed(2)}</td><td className={trade.action.includes('買') ? 'buy' : trade.action.includes('賣') ? 'sell' : ''}>{trade.action}</td><td>{money.format(trade.amount)} 元</td><td>{trade.ratio.toFixed(1)}%</td></tr>)}</tbody></table></div>
          </details>
        </section>}

        <section className="method" id="method"><div><span>03</span><h2>計算方式</h2></div><ol><li><b>起始建倉</b><p>依目標比例買入 00631L，其餘保留現金。</p></li><li><b>逐日檢查</b><p>依開盤、最高、最低、收盤順序，比對上次觸發價。</p></li><li><b>觸發再平衡</b><p>跨越門檻就買賣至目標比例，並重設參考價。</p></li></ol></section>
        </> : <Ma240Strategy baseRows={baseData} leveragedRows={builtinData} />}
      </div>
      <footer><span>00631L 回測策略</span><p>所有計算皆在瀏覽器本機完成・歷史績效不代表未來報酬</p></footer>
    </main>
  );
}
