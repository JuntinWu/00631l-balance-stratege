import type { OhlcRow } from './price-adjustments';

export type WeeklySettings = {
  capitalWan: number;
  targetPct: number;
  startDate: string;
  endDate: string;
  requireAnnualDip: boolean;
};

export type WeeklyTrade = {
  date: string;
  label: string;
  price: number;
  amount: number;
  ratio: number;
};

export type WeeklyPoint = {
  date: string;
  total: number;
  asset: number;
  cash: number;
  ratio: number;
};

const BUY_FEE = 0.1425 / 100 * 0.18;
const SELL_COST = BUY_FEE + 0.1 / 100;
const AVERAGE_WEEKS = 20;
const DIP_STEP_PCT = 10;
const DIP_TRANCHES = 6;
const ANNUAL_DAYS = 240;

function weekOf(date: string) {
  const day = new Date(date);
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString().slice(0, 10);
}

function weeklySignals(rows: OhlcRow[]) {
  const closeByWeek = new Map<string, number>();
  for (const row of rows) closeByWeek.set(weekOf(row.date), row.close);
  const closes = [...closeByWeek.values()];
  const signals = new Map<string, boolean>();
  let index = 0;
  for (const week of closeByWeek.keys()) {
    if (index >= AVERAGE_WEEKS) {
      const lastTwenty = closes.slice(index - AVERAGE_WEEKS, index);
      const average = lastTwenty.reduce((sum, close) => sum + close, 0) / AVERAGE_WEEKS;
      signals.set(week, closes[index - 1] >= average);
    }
    index += 1;
  }
  return signals;
}

export function runWeeklyBacktest(base: OhlcRow[], leveraged: OhlcRow[], settings: WeeklySettings) {
  const { capitalWan, targetPct, startDate, endDate, requireAnnualDip } = settings;
  if (!Number.isFinite(capitalWan) || capitalWan < 1) throw new Error('起始資金至少需要 1 萬元。');
  if (!Number.isFinite(targetPct) || targetPct < 1 || targetPct > 100) throw new Error('正二目標占比須介於 1% 和 100%。');

  const signals = weeklySignals(base);
  let annualSum = 0;
  const baseByDate = new Map(base.map((row, index) => {
    const belowAnnual = index >= ANNUAL_DAYS && base[index - 1].close < annualSum / ANNUAL_DAYS;
    annualSum += row.close;
    if (index >= ANNUAL_DAYS) annualSum -= base[index - ANNUAL_DAYS].close;
    return [row.date, belowAnnual] as const;
  }));
  const rows = leveraged.filter(({ date }) =>
    date >= startDate && date <= endDate && baseByDate.has(date) && signals.has(weekOf(date)),
  );
  if (rows.length < 2) throw new Error('所選期間至少需要兩個可用交易日，且 0050 須有 20 週均線資料。');

  const initial = capitalWan * 10_000;
  const target = targetPct / 100;
  let shares = 0;
  let cash = initial;
  let active = signals.get(weekOf(rows[0].date))!;
  let dip: { anchor: number; tranche: number; nextRung: number } | undefined;
  const trades: WeeklyTrade[] = [];
  const curve: WeeklyPoint[] = [];

  const record = (date: string, label: string, price: number, amount: number) => {
    const asset = shares * price;
    trades.push({ date, label, price, amount, ratio: asset / (asset + cash) * 100 });
  };
  const buy = (spend: number, price: number) => {
    shares += spend / (1 + BUY_FEE) / price;
    cash -= spend;
  };
  const sell = (quantity: number, price: number) => {
    shares -= quantity;
    const proceeds = quantity * price * (1 - SELL_COST);
    cash += proceeds;
    return proceeds;
  };
  const setTarget = (weight: number, price: number) => {
    const asset = shares * price;
    const gap = (asset + cash) * weight - asset;
    if (gap > 0) {
      const spend = Math.min(cash, gap * (1 + BUY_FEE) / (1 + weight * BUY_FEE));
      buy(spend, price);
      return spend;
    }
    if (gap < 0) return -sell(-gap / (1 - weight * SELL_COST) / price, price);
    return 0;
  };
  const startDip = (price: number) => {
    dip = { anchor: price, tranche: (shares * price + cash) * 0.05, nextRung: 1 };
  };

  const first = rows[0];
  const opened = setTarget(active ? target : target / 2, first.open);
  if (!active) startDip(first.open);
  record(first.date, active ? '初始建倉' : '起始低於週線，半部位建倉', first.open, opened);

  for (const row of rows) {
    const nextActive = signals.get(weekOf(row.date))!;
    if (active && !nextActive) {
      const proceeds = sell(shares / 2, row.open);
      startDip(row.open);
      record(row.date, '週線失守，賣出正二一半', row.open, -proceeds);
    } else if (!active && nextActive) {
      dip = undefined;
      const amount = setTarget(target, row.open);
      record(row.date, '站回週線，調整至目標占比', row.open, amount);
    }
    active = nextActive;

    const dipAllowed = !requireAnnualDip || baseByDate.get(row.date);
    while (dipAllowed && dip && dip.nextRung <= DIP_TRANCHES && cash > 0) {
      const decline = dip.nextRung * DIP_STEP_PCT;
      const trigger = dip.anchor * (100 - decline) / 100;
      if (row.low > trigger) break;
      const price = Math.min(row.open, trigger);
      const spend = Math.min(cash, dip.tranche);
      buy(spend, price);
      record(row.date, `加碼 −${decline}% 階梯`, price, spend);
      dip.nextRung += 1;
    }

    const asset = shares * row.close;
    const total = asset + cash;
    curve.push({ date: row.date, total, asset, cash, ratio: asset / total * 100 });
  }

  const last = curve.at(-1)!;
  const years = (Date.parse(last.date) - Date.parse(first.date)) / (365.25 * 86_400_000);
  return {
    curve,
    trades,
    initial,
    buyFee: BUY_FEE,
    ending: last.total,
    totalReturn: (last.total / initial - 1) * 100,
    cagr: ((last.total / initial) ** (1 / years) - 1) * 100,
    dipCount: trades.filter((trade) => trade.label.startsWith('加碼')).length,
  };
}
