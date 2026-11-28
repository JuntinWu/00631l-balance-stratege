import type { OhlcRow } from './price-adjustments';
import { weekOf, weeklySignals } from './weekly-backtest.ts';

/**
 * 阿良「七三配 → 三刀流」策略（EP144《阿良濃縮再提煉的簡單正二投資法》）
 *
 * 累積期（還在工作）
 * 1. 一次到位：起始資金七成買台股正二、三成留現金（緊急預備金＋加碼金）。
 *    正二可選 00631L 單檔，或節目建議的 00631L／00685L 各半。
 * 2. 不做再平衡：正二漲上去就讓它漲，現金只計利息。
 * 3. 新資金一樣七三配：每月第一個交易日開盤，七成買正二、三成進現金。
 * 4. 大跌才動用現金：00631L 從收盤前高回落到各階梯（UI 預設 −10／−20／−30／−40／−50%）時，
 *    每階投入「當下現金 ÷ 剩餘階數」；收盤創新高後重置。（節目只說「大跌 10%、20% 加碼」，
 *    階梯數字是本回測的量化假設。）
 *
 * 4b.（選項）跌破 20 週均線出一半：0050 週收盤跌破 20 週均線，下一週首個交易日開盤賣出一半正二；
 *    賣出的錢另外記帳（不算進三成預備金），0050 週收盤站回均線後，下一週開盤全數買回正二。
 *
 * 退休期（金融資產達年開銷 N 倍，預設 20 倍）
 * 5. 觸發當天收盤：先提領一年生活費，再把剩下資產調成退休配置
 *    （預設三刀流 333：正二／00662／00865B 各三分之一；00865B 上市前以現金計息代替）。
 * 6. 之後每年最後一個交易日收盤：提領下一年生活費（依通膨調整），再平衡回目標配置。
 *    不再有每月新資金，也不再做大跌加碼。
 */
export type RetireMix = { leveraged: number; nasdaq: number; cash: number };

export type Aliang73Settings = {
  capitalWan: number;
  targetPct: number;
  monthlyWan: number;
  cashRatePct: number;
  rungs: number[];
  startDate: string;
  endDate: string;
  /** single＝只用 00631L；half＝00631L、00685L 各半 */
  legMode: 'single' | 'half';
  /** 累積期：hold＝不再平衡（節目原版）；weekly20＝0050 跌破 20 週均線時正二出一半 */
  accumMode: 'hold' | 'weekly20';
  retire: {
    enabled: boolean;
    /** 起始年度的年生活開銷（萬元），之後依通膨成長 */
    expenseWan: number;
    multiple: number;
    inflationPct: number;
    /** 是否每年提領生活費；false＝只轉配置、每年再平衡，不提領 */
    withdraw: boolean;
    /** 百分比，合計 100 */
    mix: RetireMix;
  };
};

export type Aliang73Prices = {
  base: OhlcRow[]; // 0050（對照組）
  l631: OhlcRow[]; // 00631L
  l685: OhlcRow[]; // 00685L
  nasdaq: OhlcRow[]; // 00662
  bond: OhlcRow[]; // 00865B
};

export type Aliang73Trade = {
  date: string;
  label: string;
  /** 00631L 當時價格（參考） */
  price: number;
  /** 正值＝買進／投入；負值＝賣出或提領 */
  amount: number;
  kind: 'buy' | 'sell' | 'withdraw' | 'rebalance';
  ratio: number;
};

export type Aliang73Point = {
  date: string;
  total: number;
  /** 正二部位 */
  asset: number;
  /** 現金＋00865B */
  cash: number;
  nasdaq: number;
  /** 正二部位中 00631L／00685L 各自市值 */
  l631: number;
  l685: number;
  /** 正二占總資產 % */
  ratio: number;
};

const BUY_FEE = (0.1425 / 100) * 0.18;
const SELL_COST_EQUITY = BUY_FEE + 0.1 / 100; // 股票型 ETF 證交稅 0.1%
const SELL_COST_BOND = BUY_FEE; // 債券 ETF 免證交稅
const DAY_MS = 86_400_000;

/** 依現金流算年化報酬（XIRR，二分法）。flows 金額：投入為負、取回為正。 */
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

/** 依日期取價（當天沒成交就沿用前一筆），尚未上市回傳 undefined */
function priceBook(rows: OhlcRow[]) {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  let last: OhlcRow | undefined;
  let i = 0;
  return {
    first: rows[0]?.date,
    /** 必須依日期遞增呼叫 */
    at(date: string) {
      while (i < rows.length && rows[i].date <= date) last = rows[i++];
      return byDate.get(date) ?? last;
    },
  };
}

export function runAliang73Backtest(prices: Aliang73Prices, settings: Aliang73Settings) {
  const { capitalWan, targetPct, monthlyWan, cashRatePct, legMode, retire } = settings;
  if (!Number.isFinite(capitalWan) || capitalWan < 1) throw new Error('起始資金至少需要 1 萬元。');
  if (!Number.isFinite(targetPct) || targetPct < 1 || targetPct > 100) throw new Error('正二占比須介於 1% 和 100%。');
  if (!Number.isFinite(monthlyWan) || monthlyWan < 0) throw new Error('每月投入不能是負數。');
  if (!Number.isFinite(cashRatePct) || cashRatePct < 0 || cashRatePct > 20) throw new Error('現金年利率須介於 0% 和 20%。');
  if (retire.enabled) {
    if (!(retire.expenseWan > 0)) throw new Error('年生活開銷須大於 0。');
    if (!(retire.multiple > 0)) throw new Error('退休門檻倍數須大於 0。');
    if (!(retire.inflationPct >= 0 && retire.inflationPct <= 20)) throw new Error('通膨率須介於 0% 和 20%。');
    const { leveraged, nasdaq, cash } = retire.mix;
    if ([leveraged, nasdaq, cash].some((v) => !Number.isFinite(v) || v < 0)) throw new Error('退休配置比例不能是負數。');
    if (Math.abs(leveraged + nasdaq + cash - 100) > 0.5) throw new Error('退休配置（正二＋00662＋現金）合計須為 100%。');
  }
  const rungs = [...new Set(settings.rungs.filter((r) => Number.isFinite(r) && r > 0 && r < 100))].sort((a, b) => a - b);
  const half = legMode === 'half';

  const base = new Map(prices.base.map((r) => [r.date, r]));
  const l685ByDate = new Map(prices.l685.map((r) => [r.date, r]));
  const startDate = half && prices.l685[0] && prices.l685[0].date > settings.startDate ? prices.l685[0].date : settings.startDate;
  const rows = prices.l631.filter(({ date }) =>
    date >= startDate && date <= settings.endDate && base.has(date) && (!half || l685ByDate.has(date)));
  if (rows.length < 2) throw new Error(half
    ? '所選期間至少需要兩個 00631L、00685L、0050 共同交易日（00685L 自 2017/3/30 起）。'
    : '所選期間至少需要兩個 0050 與 00631L 共同交易日。');

  const nasdaqBook = priceBook(prices.nasdaq);
  const bondBook = priceBook(prices.bond);

  const initial = capitalWan * 10_000;
  const monthly = monthlyWan * 10_000;
  const target = targetPct / 100;
  const rate = cashRatePct / 100;

  // 部位（股數）與現金
  let s631 = 0;
  let s685 = 0;
  let sNas = 0;
  let sBond = 0;
  let cash = initial;
  let baseShares = 0;
  let invested = 0;
  let withdrawn = 0;
  let interest = 0;
  let costs = 0;
  let phase: 'accumulate' | 'retired' | 'depleted' = 'accumulate';
  let retiredAt: string | null = null;
  let retiredTotal = 0;
  let waitingForNasdaq = false;
  // 20 週均線模式：賣出一半正二得到的錢（另外記帳，站回後買回）
  const weekly20 = settings.accumMode === 'weekly20';
  const signals = weekly20 ? weeklySignals(prices.base) : new Map<string, boolean>();
  let parked = 0;
  let defending = false;
  let exitCount = 0;

  const flows: Array<{ date: string; amount: number }> = [];
  const trades: Aliang73Trade[] = [];
  const curve: Aliang73Point[] = [];
  const benchmark = new Map<string, number>();

  const first = rows[0];
  const t0 = Date.parse(first.date);
  const expenseAt = (date: string) =>
    retire.expenseWan * 10_000 * (1 + retire.inflationPct / 100) ** ((Date.parse(date) - t0) / (365.25 * DAY_MS));

  /** 某時點各部位市值；p631／p685 由呼叫端決定（開盤、觸價或收盤） */
  const values = (p631: number, p685: number, pNas: number | undefined, pBond: number | undefined) => {
    const lev = s631 * p631 + s685 * p685;
    const nas = pNas ? sNas * pNas : 0;
    const bond = pBond ? sBond * pBond : 0;
    return { lev, nas, bond, total: lev + nas + bond + cash };
  };

  const buyLev = (spend: number, p631: number, p685: number) => {
    if (half) {
      s631 += spend / 2 / (1 + BUY_FEE) / p631;
      s685 += spend / 2 / (1 + BUY_FEE) / p685;
    } else {
      s631 += spend / (1 + BUY_FEE) / p631;
    }
    costs += spend - spend / (1 + BUY_FEE);
    cash -= spend;
  };

  const record = (date: string, label: string, p631: number, p685: number, amount: number, pNas?: number, pBond?: number, kind?: Aliang73Trade['kind']) => {
    const v = values(p631, p685, pNas, pBond);
    trades.push({
      date, label, price: p631, amount,
      kind: kind ?? (amount > 0 ? 'buy' : amount < 0 ? 'withdraw' : 'rebalance'),
      ratio: v.total > 0 ? (v.lev / v.total) * 100 : 0,
    });
  };

  const baseFlow = (date: string, amount: number, price: number) => {
    // amount > 0 投入（買 0050），< 0 提領（賣 0050）
    if (amount > 0) baseShares += amount / (1 + BUY_FEE) / price;
    else baseShares = Math.max(0, baseShares - -amount / (1 - SELL_COST_EQUITY) / price);
  };

  /**
   * 收盤時提領 withdraw 元後，把資產調成退休配置。
   * 先賣出超配部位，再從現金支付提領，最後用剩下的現金買進低配部位。
   */
  const retireRebalance = (row: OhlcRow, p685: number, pNas: number, pBond: number | undefined, withdraw: number) => {
    const p631 = row.close;
    const v = values(p631, p685, pNas, pBond);
    const pay = Math.min(withdraw, v.total);
    const after = v.total - pay;
    const mix = retire.mix;
    const lev = (after * mix.leveraged) / 100;
    const want = {
      // 各半模式：00631L、00685L 各自調回正二部位的一半
      l631: half ? lev / 2 : lev,
      l685: half ? lev / 2 : 0,
      nas: (after * mix.nasdaq) / 100,
      // 00865B 上市後現金部位放 00865B；之前以現金計息
      bond: pBond ? (after * mix.cash) / 100 : 0,
    };
    const sell = (value: number, cost: number) => {
      const net = value * (1 - cost);
      costs += value - net;
      cash += net;
    };
    // 1) 賣超配
    if (s631 * p631 > want.l631) {
      sell(s631 * p631 - want.l631, SELL_COST_EQUITY);
      s631 = want.l631 / p631;
    }
    if (half && s685 * p685 > want.l685) {
      sell(s685 * p685 - want.l685, SELL_COST_EQUITY);
      s685 = want.l685 / p685;
    }
    if (v.nas > want.nas) {
      sell(v.nas - want.nas, SELL_COST_EQUITY);
      sNas = want.nas / pNas;
    }
    if (pBond && v.bond > want.bond) {
      sell(v.bond - want.bond, SELL_COST_BOND);
      sBond = want.bond / pBond;
    }
    // 2) 提領
    const paid = Math.min(pay, cash);
    cash -= paid;
    // 3) 買低配（現金不足時等比例縮小）
    const need = {
      l631: Math.max(0, want.l631 - s631 * p631),
      l685: half ? Math.max(0, want.l685 - s685 * p685) : 0,
      nas: Math.max(0, want.nas - sNas * pNas),
      bond: pBond ? Math.max(0, want.bond - sBond * pBond) : 0,
    };
    const needTotal = need.l631 + need.l685 + need.nas + need.bond;
    const cashTarget = pBond ? 0 : (after * mix.cash) / 100;
    const budget = Math.max(0, cash - cashTarget);
    const scale = needTotal > 0 ? Math.min(1, budget / (needTotal * (1 + BUY_FEE))) : 0;
    /** 買進 value 元的部位（另付手續費），回傳增加的股數 */
    const buyValue = (value: number, price: number) => {
      const spend = value * (1 + BUY_FEE);
      costs += spend - value;
      cash -= spend;
      return value / price;
    };
    if (need.l631 > 0) s631 += buyValue(need.l631 * scale, p631);
    if (need.l685 > 0) s685 += buyValue(need.l685 * scale, p685);
    if (need.nas > 0) sNas += buyValue(need.nas * scale, pNas);
    if (pBond && need.bond > 0) sBond += buyValue(need.bond * scale, pBond);
    return paid;
  };

  // ── 起始：一次七三配到位 ──
  const p685Open = (date: string) => l685ByDate.get(date)?.open ?? 0;
  invested += initial;
  flows.push({ date: first.date, amount: -initial });
  baseFlow(first.date, initial, base.get(first.date)!.open);
  const legLabel = half ? '，00631L／00685L 各半' : '';
  if (weekly20 && signals.get(weekOf(first.date)) === false) {
    // 起始就在 20 週線下：正二先買一半，另一半當出場資金保留，站回後買回
    const lev = initial * target;
    buyLev(lev / 2, first.open, p685Open(first.date));
    parked = lev / 2;
    defending = true;
    record(first.date, `起始低於 20 週均線，正二半部位建倉（目標 ${targetPct}%${legLabel}）`, first.open, p685Open(first.date), lev / 2);
  } else {
    buyLev(initial * target, first.open, p685Open(first.date));
    record(first.date, `初始七三配（正二 ${targetPct}%${legLabel}）`, first.open, p685Open(first.date), initial * target);
  }

  let peak = first.open;
  let rungIndex = 0;
  let prevDate = first.date;
  let prevMonth = first.date.slice(0, 7);

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const r685 = l685ByDate.get(row.date);
    const nasRow = nasdaqBook.at(row.date);
    const bondRow = bondBook.at(row.date);
    const baseRow = base.get(row.date)!;

    // 現金利息（日複利，依日曆天數）
    const days = (Date.parse(row.date) - Date.parse(prevDate)) / DAY_MS;
    if (days > 0 && cash > 0 && rate > 0) {
      const growth = (1 + rate) ** (days / 365) - 1;
      const gain = cash * growth;
      cash += gain;
      parked += parked * growth;
      interest += gain;
    }
    prevDate = row.date;

    if (phase === 'accumulate') {
      // 每月新資金：每月第一個交易日開盤，一樣七三配
      const month = row.date.slice(0, 7);
      if (month !== prevMonth) {
        prevMonth = month;
        if (monthly > 0) {
          invested += monthly;
          flows.push({ date: row.date, amount: -monthly });
          baseFlow(row.date, monthly, baseRow.open);
          cash += monthly;
          buyLev(monthly * target, row.open, r685?.open ?? 0);
          record(row.date, '每月新資金七三配', row.open, r685?.open ?? 0, monthly * target);
        }
      }

      // （選項）20 週均線：跌破出一半、站回買回，都在該週首個交易日開盤執行
      if (weekly20) {
        const above = signals.get(weekOf(row.date)) ?? true; // 前 20 週還沒有均線，視為線上
        if (!defending && !above) {
          const p685 = r685?.open ?? 0;
          const gross = (s631 * row.open + s685 * p685) / 2;
          const net = gross * (1 - SELL_COST_EQUITY);
          costs += gross - net;
          s631 /= 2;
          s685 /= 2;
          cash += net;
          parked += net;
          defending = true;
          exitCount += 1;
          record(row.date, '0050 跌破 20 週均線，正二出一半', row.open, p685, -net, undefined, undefined, 'sell');
        } else if (defending && above) {
          const p685 = r685?.open ?? 0;
          const spend = Math.min(parked, cash);
          if (spend > 0) buyLev(spend, row.open, p685);
          parked = 0;
          defending = false;
          record(row.date, '0050 站回 20 週均線，買回正二', row.open, p685, spend);
        }
      }

      // 大跌加碼階梯：以 00631L 距收盤前高的回落幅度觸發（只動用三成預備金，不含出場資金）
      while (rungIndex < rungs.length && cash - parked >= 1000) {
        const decline = rungs[rungIndex];
        const trigger = peak * (1 - decline / 100);
        if (row.low > trigger) break;
        const fill = Math.min(row.open, trigger);
        // 00685L 以同一時點的相對漲跌估算成交價，並限制在當日高低之間
        const fill685 = r685 ? Math.min(r685.high, Math.max(r685.low, r685.open * (fill / row.open))) : 0;
        const spend = (cash - parked) / (rungs.length - rungIndex);
        buyLev(spend, fill, fill685);
        record(row.date, `大跌加碼：00631L 距前高 −${decline}%`, fill, fill685, spend);
        rungIndex += 1;
      }
      if (row.close > peak) {
        peak = row.close;
        rungIndex = 0;
      }

      // 退休門檻：收盤金融資產 ≥ 年開銷 × N 倍
      if (retire.enabled) {
        const v = values(row.close, r685?.close ?? 0, nasRow?.close, bondRow?.close);
        const expense = expenseAt(row.date);
        if (v.total >= expense * retire.multiple) {
          if (retire.mix.nasdaq > 0 && !nasRow) {
            waitingForNasdaq = true; // 00662 尚未上市，等上市後再轉換
          } else {
            const paid = retireRebalance(row, r685?.close ?? 0, nasRow?.close ?? 1, bondRow?.close, retire.withdraw ? expense : 0);
            withdrawn += paid;
            flows.push({ date: row.date, amount: paid });
            baseFlow(row.date, -paid, baseRow.close);
            phase = 'retired';
            parked = 0;
            defending = false;
            retiredAt = row.date;
            retiredTotal = v.total;
            record(row.date, `達 ${retire.multiple} 倍年開銷，轉退休配置${retire.withdraw ? '並提領第一年生活費' : '（不提領）'}`, row.close, r685?.close ?? 0, -paid, nasRow?.close, bondRow?.close);
          }
        }
      }
    } else if (phase === 'retired') {
      // 每年最後一個交易日收盤：提領下一年生活費，再平衡
      const next = rows[index + 1];
      if (next && next.date.slice(0, 4) !== row.date.slice(0, 4)) {
        const expense = expenseAt(next.date);
        const before = values(row.close, r685?.close ?? 0, nasRow?.close, bondRow?.close).total;
        const paid = retireRebalance(row, r685?.close ?? 0, nasRow!.close, bondRow?.close, retire.withdraw ? expense : 0);
        withdrawn += paid;
        flows.push({ date: row.date, amount: paid });
        baseFlow(row.date, -paid, baseRow.close);
        record(row.date, retire.withdraw ? `年底提領 ${Math.round(paid / 10_000)} 萬＋再平衡` : '年底再平衡（不提領）', row.close, r685?.close ?? 0, -paid, nasRow?.close, bondRow?.close);
        if (retire.withdraw && (paid < expense - 1 || before - paid <= 1)) phase = 'depleted';
      }
    }

    const v = values(row.close, r685?.close ?? 0, nasRow?.close, bondRow?.close);
    curve.push({
      date: row.date,
      total: v.total,
      asset: v.lev,
      cash: cash + v.bond,
      nasdaq: v.nas,
      l631: s631 * row.close,
      l685: s685 * (r685?.close ?? 0),
      ratio: v.total > 0 ? (v.lev / v.total) * 100 : 0,
    });
    benchmark.set(row.date, baseShares * baseRow.close);
  }

  const last = curve.at(-1)!;
  const years = (Date.parse(last.date) - t0) / (365.25 * DAY_MS);
  const simple = monthly === 0 && withdrawn === 0;
  const benchEnding = benchmark.get(last.date)!;
  const annualized = simple
    ? ((last.total / initial) ** (1 / years) - 1) * 100
    : xirr([...flows, { date: last.date, amount: last.total }]) * 100;
  const benchAnnualized = simple
    ? ((benchEnding / initial) ** (1 / years) - 1) * 100
    : xirr([...flows, { date: last.date, amount: benchEnding }]) * 100;

  return {
    curve,
    trades,
    benchmark,
    initial,
    invested,
    withdrawn,
    interest,
    costs,
    startDate: first.date,
    ending: last.total,
    endingRatio: last.ratio,
    /** (期末＋已提領) ÷ 投入本金 − 1 */
    totalReturn: ((last.total + withdrawn) / invested - 1) * 100,
    /** 沒有中途現金流時為 CAGR，否則為 XIRR */
    annualized,
    benchEnding,
    benchAnnualized,
    simple,
    dipCount: trades.filter((t) => t.label.startsWith('大跌加碼')).length,
    exitCount,
    /** 期末是否仍在 20 週線下的防守狀態 */
    defending,
    retiredAt,
    retiredTotal,
    depleted: phase === 'depleted',
    waitingForNasdaq: waitingForNasdaq && !retiredAt,
  };
}
