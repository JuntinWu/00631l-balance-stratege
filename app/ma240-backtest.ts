import type { OhlcRow } from './price-adjustments';

export type Ma240Settings = {
  initialWan: number;
  monthlyWan: number;
  commissionPct: number;
  discount: number;
  transactionTaxPct: number;
};

export type Ma240CurvePoint = {
  date: string;
  total: number;
  base: number;
  leveraged: number;
  invested: number;
  baseBenchmark: number;
  twr: number;
  basePrice: number;
  movingAverage: number;
  drawdownPct: number;
};

export type Ma240Buy = {
  date: string;
  position: 'above' | 'below';
  basePrice: number;
  movingAverage: number;
  action: '買進0050' | '買進00631L';
  amount: number;
};

export type Ma240Conversion = {
  date: string;
  triggerPct: number;
  cumulativePct: number;
  drawdownPct: number;
  basePrice: number;
  leveragedPrice: number;
  baseSharesSold: number;
  grossAmount: number;
  netAmount: number;
};

export type Ma240Annual = {
  year: string;
  returnPct: number;
  ending: number;
};

export type Ma240Result = {
  curve: Ma240CurvePoint[];
  buys: Ma240Buy[];
  conversions: Ma240Conversion[];
  annual: Ma240Annual[];
  totalInvested: number;
  ending: number;
  profit: number;
  totalReturn: number;
  cagr: number;
  mdd: number;
  baseBuys: number;
  leveragedBuys: number;
  convertedAmount: number;
  baseEndingWeight: number;
  leveragedEndingWeight: number;
};

type SignalRow = OhlcRow & { movingAverage: number; leveragedClose: number };

const CONVERSION_LADDER = [
  { triggerPct: 10, portionPct: 20, cumulativePct: 20 },
  { triggerPct: 15, portionPct: 25, cumulativePct: 45 },
  { triggerPct: 20, portionPct: 25, cumulativePct: 70 },
  { triggerPct: 25, portionPct: 30, cumulativePct: 100 },
] as const;

function buildSignals(baseRows: OhlcRow[], leveragedRows: OhlcRow[], days: number): SignalRow[] {
  const leveragedByDate = new Map(leveragedRows.map((row) => [row.date, row.close]));
  let rollingSum = 0;
  const signals: SignalRow[] = [];

  for (let index = 0; index < baseRows.length; index += 1) {
    const row = baseRows[index];
    rollingSum += row.close;
    if (index >= days) rollingSum -= baseRows[index - days].close;
    const leveragedClose = leveragedByDate.get(row.date);
    if (index < days - 1 || leveragedClose === undefined) continue;
    signals.push({ ...row, movingAverage: rollingSum / days, leveragedClose });
  }
  return signals;
}

export function runMa240Backtest(
  baseRows: OhlcRow[],
  leveragedRows: OhlcRow[],
  startDate: string,
  endDate: string,
  settings: Ma240Settings,
): Ma240Result {
  const signals = buildSignals(baseRows, leveragedRows, 240)
    .filter((row) => row.date >= startDate && row.date <= endDate);
  if (signals.length < 2) throw new Error('所選期間沒有足夠資料計算 240 日均線');

  const buyFee = (settings.commissionPct / 100) * (settings.discount / 10);
  const sellCost = buyFee + Math.max(0, settings.transactionTaxPct) / 100;
  const initial = Math.max(0, settings.initialWan) * 10_000;
  const monthly = Math.max(0, settings.monthlyWan) * 10_000;
  let baseShares = 0;
  let benchmarkShares = 0;
  let leveragedShares = 0;
  let highWater = 0;
  let cycleBaseShares = 0;
  let triggeredRungs = new Set<number>();
  let totalInvested = 0;
  let previousTotal = 0;
  let timeWeightedIndex = 1;
  let peak = 1;
  let mdd = 0;
  let previousMonth = '';
  const curve: Ma240CurvePoint[] = [];
  const buys: Ma240Buy[] = [];
  const conversions: Ma240Conversion[] = [];

  for (const row of signals) {
    const month = row.date.slice(0, 7);
    const firstObservation = curve.length === 0;
    let contribution = 0;
    if (firstObservation) contribution = initial;
    else if (month !== previousMonth) contribution = monthly;
    previousMonth = month;

    const isAbove = row.close >= row.movingAverage;
    if (contribution > 0) {
      const investable = contribution / (1 + buyFee);
      benchmarkShares += investable / row.close;
      if (isAbove) baseShares += investable / row.close;
      else leveragedShares += investable / row.leveragedClose;
      totalInvested += contribution;
      buys.push({
        date: row.date,
        position: isAbove ? 'above' : 'below',
        basePrice: row.close,
        movingAverage: row.movingAverage,
        action: isAbove ? '買進0050' : '買進00631L',
        amount: contribution,
      });
    }

    if (row.close >= highWater) {
      highWater = row.close;
      cycleBaseShares = baseShares;
      triggeredRungs = new Set<number>();
    }
    const drawdownPct = highWater > 0 ? (highWater - row.close) / highWater * 100 : 0;

    for (const rung of CONVERSION_LADDER) {
      if (drawdownPct + 1e-9 < rung.triggerPct || triggeredRungs.has(rung.triggerPct)) continue;
      triggeredRungs.add(rung.triggerPct);
      const sharesToSell = Math.min(baseShares, cycleBaseShares * rung.portionPct / 100);
      if (sharesToSell <= 0) continue;
      const grossAmount = sharesToSell * row.close;
      const netAmount = grossAmount * (1 - sellCost);
      baseShares -= sharesToSell;
      leveragedShares += (netAmount / (1 + buyFee)) / row.leveragedClose;
      conversions.push({
        date: row.date,
        triggerPct: rung.triggerPct,
        cumulativePct: rung.cumulativePct,
        drawdownPct,
        basePrice: row.close,
        leveragedPrice: row.leveragedClose,
        baseSharesSold: sharesToSell,
        grossAmount,
        netAmount,
      });
    }

    const base = baseShares * row.close;
    const leveraged = leveragedShares * row.leveragedClose;
    const total = base + leveraged;
    if (firstObservation) timeWeightedIndex = contribution > 0 ? total / contribution : 1;
    else if (previousTotal > 0) timeWeightedIndex *= (total - contribution) / previousTotal;
    peak = Math.max(peak, timeWeightedIndex);
    mdd = Math.max(mdd, peak ? (peak - timeWeightedIndex) / peak : 0);
    curve.push({
      date: row.date,
      total,
      base,
      leveraged,
      invested: totalInvested,
      baseBenchmark: benchmarkShares * row.close,
      twr: timeWeightedIndex,
      basePrice: row.close,
      movingAverage: row.movingAverage,
      drawdownPct,
    });
    previousTotal = total;
  }

  const annual: Ma240Annual[] = [];
  let priorIndex = 1;
  const yearEnds = new Map<string, Ma240CurvePoint>();
  for (const point of curve) yearEnds.set(point.date.slice(0, 4), point);
  for (const [year, point] of yearEnds) {
    annual.push({ year, returnPct: (point.twr / priorIndex - 1) * 100, ending: point.total });
    priorIndex = point.twr;
  }

  const ending = curve.at(-1)?.total ?? 0;
  const endingPoint = curve.at(-1);
  const yearsElapsed = Math.max(
    (new Date(signals.at(-1)!.date).getTime() - new Date(signals[0].date).getTime()) / (365.25 * 864e5),
    1 / 365.25,
  );
  return {
    curve,
    buys,
    conversions,
    annual,
    totalInvested,
    ending,
    profit: ending - totalInvested,
    totalReturn: totalInvested ? (ending / totalInvested - 1) * 100 : 0,
    cagr: (Math.pow(Math.max(timeWeightedIndex, 0.000001), 1 / yearsElapsed) - 1) * 100,
    mdd: mdd * 100,
    baseBuys: buys.filter((buy) => buy.position === 'above').length,
    leveragedBuys: buys.filter((buy) => buy.position === 'below').length,
    convertedAmount: conversions.reduce((sum, conversion) => sum + conversion.grossAmount, 0),
    baseEndingWeight: ending && endingPoint ? endingPoint.base / ending * 100 : 0,
    leveragedEndingWeight: ending && endingPoint ? endingPoint.leveraged / ending * 100 : 0,
  };
}
