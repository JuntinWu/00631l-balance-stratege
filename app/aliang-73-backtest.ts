import type { OhlcRow } from './price-adjustments';

/**
 * 阿良「七三配」累積期策略（EP144《阿良濃縮再提煉的簡單正二投資法》）
 *
 * 1. 一次到位：起始資金七成買正二（00631L），三成留現金（緊急預備金＋加碼金）。
 * 2. 累積期不做再平衡：正二漲上去就讓它漲，現金部位不動（可設定利息）。
 * 3. 新資金一樣七三配：每月投入的錢，七成買正二、三成進現金。
 * 4. 大跌才動用現金：00631L 從前高回落到各階梯（預設 −20／−40／−60%）時，
 *    每階投入「當下現金 ÷ 剩餘階數」，最後一階用完現金；收盤創新高後階梯重置。
 *    （節目只說「大跌 10%、20% 加碼」，階梯數字是本回測的量化假設。）
 */
export type Aliang73Settings = {
  capitalWan: number;
  targetPct: number;
  monthlyWan: number;
  cashRatePct: number;
  rungs: number[];
  startDate: string;
  endDate: string;
};

export type Aliang73Trade = {
  date: string;
  label: string;
  price: number;
  amount: number;
  ratio: number;
};

export type Aliang73Point = {
  date: string;
  total: number;
  asset: number;
  cash: number;
  ratio: number;
};

const BUY_FEE = (0.1425 / 100) * 0.18;
const DAY_MS = 86_400_000;

/** 依現金流算年化報酬（XIRR，二分法） */
export function xirr(flows: Array<{ date: string; amount: number }>) {
  const t0 = Date.parse(flows[0].date);
  const npv = (rate: number) =>
    flows.reduce((sum, f) => sum + f.amount / (1 + rate) ** ((Date.parse(f.date) - t0) / (365.25 * DAY_MS)), 0);
  let lo = -0.99;
  let hi = 10;
  if (npv(lo) * npv(hi) > 0) return NaN;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

export function runAliang73Backtest(base: OhlcRow[], leveraged: OhlcRow[], settings: Aliang73Settings) {
  const { capitalWan, targetPct, monthlyWan, cashRatePct, startDate, endDate } = settings;
  if (!Number.isFinite(capitalWan) || capitalWan < 1) throw new Error('起始資金至少需要 1 萬元。');
  if (!Number.isFinite(targetPct) || targetPct < 1 || targetPct > 100) throw new Error('正二占比須介於 1% 和 100%。');
  if (!Number.isFinite(monthlyWan) || monthlyWan < 0) throw new Error('每月投入不能是負數。');
  if (!Number.isFinite(cashRatePct) || cashRatePct < 0 || cashRatePct > 20) throw new Error('現金年利率須介於 0% 和 20%。');
  const rungs = [...new Set(settings.rungs.filter((r) => Number.isFinite(r) && r > 0 && r < 100))].sort((a, b) => a - b);

  const baseByDate = new Map(base.map((row) => [row.date, row]));
  const rows = leveraged.filter(({ date }) => date >= startDate && date <= endDate && baseByDate.has(date));
  if (rows.length < 2) throw new Error('所選期間至少需要兩個 0050 與 00631L 共同交易日。');

  const initial = capitalWan * 10_000;
  const monthly = monthlyWan * 10_000;
  const target = targetPct / 100;
  const dailyRate = cashRatePct / 100;

  let shares = 0;
  let cash = initial;
  let baseShares = 0; // 0050 對照：相同現金流全數買 0050
  let invested = 0;
  let interest = 0;
  const flows: Array<{ date: string; amount: number }> = [];
  const trades: Aliang73Trade[] = [];
  const curve: Aliang73Point[] = [];
  const benchmark = new Map<string, number>();

  const buy = (spend: number, price: number) => {
    shares += spend / (1 + BUY_FEE) / price;
    cash -= spend;
  };
  const record = (date: string, label: string, price: number, amount: number) => {
    const asset = shares * price;
    trades.push({ date, label, price, amount, ratio: (asset / (asset + cash)) * 100 });
  };
  const contribute = (row: OhlcRow, amount: number) => {
    invested += amount;
    flows.push({ date: row.date, amount: -amount });
    baseShares += amount / (1 + BUY_FEE) / baseByDate.get(row.date)!.open;
  };

  // ── 起始：一次七三配到位 ──
  const first = rows[0];
  contribute(first, initial);
  buy(initial * target, first.open);
  record(first.date, `初始七三配（正二 ${targetPct}%）`, first.open, initial * target);

  let peak = first.open;
  let rungIndex = 0;
  let prevDate = first.date;
  let prevMonth = first.date.slice(0, 7);

  for (const row of rows) {
    // 現金利息（日複利，依日曆天數）
    const days = (Date.parse(row.date) - Date.parse(prevDate)) / DAY_MS;
    if (days > 0 && cash > 0 && dailyRate > 0) {
      const gain = cash * ((1 + dailyRate) ** (days / 365) - 1);
      cash += gain;
      interest += gain;
    }
    prevDate = row.date;

    // 每月新資金：每月第一個交易日開盤，一樣七三配
    const month = row.date.slice(0, 7);
    if (month !== prevMonth) {
      prevMonth = month;
      if (monthly > 0) {
        contribute(row, monthly);
        cash += monthly;
        buy(monthly * target, row.open);
        record(row.date, '每月新資金七三配', row.open, monthly * target);
      }
    }

    // 大跌加碼階梯：以前高回落幅度觸發
    while (rungIndex < rungs.length && cash >= 1000) {
      const decline = rungs[rungIndex];
      const trigger = peak * (1 - decline / 100);
      if (row.low > trigger) break;
      const price = Math.min(row.open, trigger);
      const spend = cash / (rungs.length - rungIndex);
      buy(spend, price);
      record(row.date, `大跌加碼：正二距前高 −${decline}%`, price, spend);
      rungIndex += 1;
    }

    // 收盤創新高 → 階梯重置
    if (row.close > peak) {
      peak = row.close;
      rungIndex = 0;
    }

    const asset = shares * row.close;
    const total = asset + cash;
    curve.push({ date: row.date, total, asset, cash, ratio: (asset / total) * 100 });
    benchmark.set(row.date, baseShares * baseByDate.get(row.date)!.close);
  }

  const last = curve.at(-1)!;
  const years = (Date.parse(last.date) - Date.parse(first.date)) / (365.25 * DAY_MS);
  const irr = xirr([...flows, { date: last.date, amount: last.total }]);
  const benchEnding = benchmark.get(last.date)!;
  const benchIrr = xirr([...flows, { date: last.date, amount: benchEnding }]);

  const annual: Array<{ year: string; ending: number }> = [];
  const byYear = new Map<string, number>();
  for (const p of curve) byYear.set(p.date.slice(0, 4), p.total);
  for (const [year, ending] of byYear) annual.push({ year, ending });

  return {
    curve,
    trades,
    benchmark,
    annual,
    initial,
    invested,
    interest,
    ending: last.total,
    endingRatio: last.ratio,
    totalReturn: (last.total / invested - 1) * 100,
    /** 有每月投入時用 XIRR；沒有時等同 CAGR */
    annualized: monthly > 0 ? irr * 100 : ((last.total / initial) ** (1 / years) - 1) * 100,
    benchEnding,
    benchAnnualized: monthly > 0 ? benchIrr * 100 : ((benchEnding / initial) ** (1 / years) - 1) * 100,
    dipCount: trades.filter((t) => t.label.startsWith('大跌加碼')).length,
  };
}
