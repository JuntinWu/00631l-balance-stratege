import type { OhlcRow } from './price-adjustments';

export type RyanSettings = {
  initialWan: number;
  rebalanceUpPct: number;
  rebalanceDownPct: number;
  commissionPct: number;
  discount: number;
  transactionTaxPct: number;
};

export type RyanEvent = {
  date: string;
  kind: 'initial' | 'exit' | 'left-buy' | 'right-buy' | 'reentry' | 'rebalance-buy' | 'rebalance-sell';
  signal: string;
  action: string;
  deviationPct: number;
  basePrice: number;
  leveragedPrice: number;
  amount: number;
};

export type RyanCurvePoint = {
  date: string;
  total: number;
  coreBase: number;
  tacticalBase: number;
  leveraged: number;
  reserve: number;
  tacticalCash: number;
  basePrice: number;
  movingAverage: number;
  deviationPct: number;
  qqqClose: number;
  qqqMovingAverage: number;
  qqqDeviationPct: number;
  baseBenchmark: number;
  leveragedBenchmark: number;
  halfBenchmark: number;
};

export type RyanAnnual = {
  year: string;
  returnPct: number;
  ending: number;
};

export type RyanResult = {
  curve: RyanCurvePoint[];
  events: RyanEvent[];
  annual: RyanAnnual[];
  ending: number;
  totalReturn: number;
  cagr: number;
  mdd: number;
  positiveYears: number;
  exitCount: number;
  reentryCount: number;
  leftBuyCount: number;
  rightBuyCount: number;
  qqqExitCount: number;
  rebalanceCount: number;
  endingWeights: { core: number; tacticalBase: number; leveraged: number; reserve: number; tacticalCash: number };
  comparisons: {
    base: { ending: number; cagr: number; mdd: number };
    leveraged: { ending: number; cagr: number; mdd: number };
    half: { ending: number; cagr: number; mdd: number };
  };
};

type SignalRow = OhlcRow & {
  movingAverage: number;
  leveragedOpen: number;
  leveragedHigh: number;
  leveragedLow: number;
  leveragedClose: number;
  qqqClose: number;
  qqqMovingAverage: number;
  qqqDate: string;
};

const LADDER = [8, 10, 15, 20, 25, 30] as const;

function movingAverageRows(rows: OhlcRow[]) {
  let rollingSum = 0;
  return rows.flatMap((row, index) => {
    rollingSum += row.close;
    if (index >= 240) rollingSum -= rows[index - 240].close;
    return index < 239 ? [] : [{ date: row.date, close: row.close, movingAverage: rollingSum / 240 }];
  });
}

function buildSignals(baseRows: OhlcRow[], leveragedRows: OhlcRow[], qqqRows: OhlcRow[]): SignalRow[] {
  const leveragedByDate = new Map(leveragedRows.map((row) => [row.date, row]));
  const qqqSignals = movingAverageRows(qqqRows);
  let qqqIndex = -1;
  let rollingSum = 0;
  const signals: SignalRow[] = [];
  for (let index = 0; index < baseRows.length; index += 1) {
    const base = baseRows[index];
    rollingSum += base.close;
    if (index >= 240) rollingSum -= baseRows[index - 240].close;
    const leveraged = leveragedByDate.get(base.date);
    while (qqqIndex + 1 < qqqSignals.length && qqqSignals[qqqIndex + 1].date < base.date) qqqIndex += 1;
    const qqq = qqqSignals[qqqIndex];
    if (index < 239 || !leveraged || !qqq) continue;
    signals.push({
      ...base,
      movingAverage: rollingSum / 240,
      leveragedOpen: leveraged.open,
      leveragedHigh: leveraged.high,
      leveragedLow: leveraged.low,
      leveragedClose: leveraged.close,
      qqqClose: qqq.close,
      qqqMovingAverage: qqq.movingAverage,
      qqqDate: qqq.date,
    });
  }
  return signals;
}

const elapsedYears = (start: string, end: string) => Math.max(
  (new Date(end).getTime() - new Date(start).getTime()) / (365.25 * 864e5),
  1 / 365.25,
);

const summarize = (values: number[], initial: number, years: number) => {
  const ending = values.at(-1) ?? initial;
  let peak = initial;
  let mdd = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    mdd = Math.max(mdd, peak ? (peak - value) / peak : 0);
  }
  return {
    ending,
    cagr: (Math.pow(Math.max(ending / initial, 0.000001), 1 / years) - 1) * 100,
    mdd: mdd * 100,
  };
};

export function runRyan404020Backtest(
  baseRows: OhlcRow[],
  leveragedRows: OhlcRow[],
  qqqRows: OhlcRow[],
  startDate: string,
  endDate: string,
  settings: RyanSettings,
): RyanResult {
  const signals = buildSignals(baseRows, leveragedRows, qqqRows)
    .filter((row) => row.date >= startDate && row.date <= endDate);
  if (signals.length < 2) throw new Error('所選期間沒有足夠的共同交易日可供回測');

  const initial = Math.max(1, settings.initialWan) * 10_000;
  const buyFee = Math.max(0, settings.commissionPct) / 100 * Math.max(0, settings.discount) / 10;
  const sellCost = buyFee + Math.max(0, settings.transactionTaxPct) / 100;
  const first = signals[0];
  const buyShares = (spend: number, price: number) => spend / (1 + buyFee) / price;
  const saleProceeds = (shares: number, price: number) => shares * price * (1 - sellCost);

  let coreShares = buyShares(initial * 0.4, first.close);
  let leveragedShares = buyShares(initial * 0.4, first.leveragedClose);
  let tacticalBaseShares = 0;
  const reserve = initial * 0.2;
  let tacticalCash = 0;
  let mode: 'leveraged' | 'defensive' = 'leveraged';
  let leveragedReference = first.leveragedClose;
  let cycleAnchor = initial;
  let previousDeviation = (first.close / first.movingAverage - 1) * 100;
  let belowThreeStreak = 0;
  let aboveThreeStreak = 0;
  let pendingExit = false;
  let pendingReentry = false;
  let usedLeft = new Set<number>();
  let usedRight = new Set<number>();
  const events: RyanEvent[] = [{
    date: first.date,
    kind: 'initial',
    signal: '40 / 40 / 20 初始配置',
    action: '0050 底倉 40%＋00631L 40%＋保命現金 20%',
    deviationPct: previousDeviation,
    basePrice: first.close,
    leveragedPrice: first.leveragedClose,
    amount: initial,
  }];

  const baseBenchmarkShares = buyShares(initial, first.close);
  const leveragedBenchmarkShares = buyShares(initial, first.leveragedClose);
  let halfShares = buyShares(initial * 0.5, first.leveragedClose);
  let halfCash = initial * 0.5;
  let halfYear = first.date.slice(0, 4);
  const curve: RyanCurvePoint[] = [];

  const exitLeveraged = (row: SignalRow, price: number, signal: string) => {
    const amount = saleProceeds(leveragedShares, price);
    tacticalCash += amount;
    leveragedShares = 0;
    mode = 'defensive';
    cycleAnchor = coreShares * row.close + reserve + tacticalCash;
    usedLeft = new Set<number>();
    usedRight = new Set<number>();
    aboveThreeStreak = 0;
    pendingExit = false;
    events.push({
      date: row.date,
      kind: 'exit',
      signal,
      action: '00631L 全數出清，轉為備戰現金',
      deviationPct: (row.close / row.movingAverage - 1) * 100,
      basePrice: row.close,
      leveragedPrice: price,
      amount,
    });
  };

  const reenterLeveraged = (row: SignalRow, basePrice: number, leveragedPrice: number, signal: string) => {
    const sold = saleProceeds(tacticalBaseShares, basePrice);
    tacticalBaseShares = 0;
    tacticalCash += sold;
    const spend = tacticalCash;
    leveragedShares += buyShares(spend, leveragedPrice);
    tacticalCash = 0;
    mode = 'leveraged';
    leveragedReference = leveragedPrice;
    belowThreeStreak = 0;
    pendingReentry = false;
    events.push({
      date: row.date,
      kind: 'reentry',
      signal,
      action: '底部 0050 全數換回 00631L',
      deviationPct: (row.close / row.movingAverage - 1) * 100,
      basePrice,
      leveragedPrice,
      amount: spend,
    });
  };

  const rebalanceLeveraged = (row: SignalRow, basePrice: number, leveragedPrice: number, checkpoint: string) => {
    const leveragedValue = leveragedShares * leveragedPrice;
    const total = coreShares * basePrice + tacticalBaseShares * basePrice + leveragedValue + reserve + tacticalCash;
    const targetValue = total * 0.4;
    let kind: RyanEvent['kind'] | null = null;
    let action = '';
    let amount = 0;

    if (leveragedValue > targetValue) {
      const grossSale = Math.min(leveragedValue, (leveragedValue - targetValue) / (1 - 0.4 * sellCost));
      const sharesToSell = grossSale / leveragedPrice;
      leveragedShares -= sharesToSell;
      tacticalCash += saleProceeds(sharesToSell, leveragedPrice);
      kind = 'rebalance-sell';
      action = '賣出 00631L，獲利轉入備戰現金';
      amount = grossSale;
    } else if (leveragedValue < targetValue && tacticalCash > 0) {
      const gap = targetValue - leveragedValue;
      const spend = Math.min(tacticalCash, gap * (1 + buyFee) / (1 + 0.4 * buyFee));
      leveragedShares += buyShares(spend, leveragedPrice);
      tacticalCash -= spend;
      kind = 'rebalance-buy';
      action = '使用備戰現金買進 00631L';
      amount = spend;
    }

    const changePct = (leveragedPrice / leveragedReference - 1) * 100;
    leveragedReference = leveragedPrice;
    if (!kind || amount <= 0) return;
    events.push({
      date: row.date,
      kind,
      signal: `${checkpoint}相對前次基準 ${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%，正二調回總資產 40%`,
      action,
      deviationPct: (row.close / row.movingAverage - 1) * 100,
      basePrice,
      leveragedPrice,
      amount,
    });
  };

  for (let index = 0; index < signals.length; index += 1) {
    const row = signals[index];
    const deviationPct = (row.close / row.movingAverage - 1) * 100;
    const qqqDeviationPct = (row.qqqClose / row.qqqMovingAverage - 1) * 100;
    const rebalanceUp = Math.max(0.001, settings.rebalanceUpPct) / 100;
    const rebalanceDown = Math.max(0.001, settings.rebalanceDownPct) / 100;

    if (index > 0 && mode === 'leveraged' && pendingExit) {
      exitLeveraged(row, row.leveragedOpen, '連續 3 日低於年線 −3%，第 4 日開盤撤退');
    } else if (index > 0 && mode === 'defensive' && pendingReentry && qqqDeviationPct > -10) {
      reenterLeveraged(row, row.open, row.leveragedOpen, '連續 3 日高於年線 +3%，次日開盤反攻');
    } else if (mode === 'defensive' && pendingReentry && qqqDeviationPct <= -10) {
      pendingReentry = false;
    }

    if (index > 0 && mode === 'leveraged') {
      const checkpoints = [
        ['開盤', row.open, row.leveragedOpen],
        ['盤中最高價', row.high, row.leveragedHigh],
        ['盤中最低價', row.low, row.leveragedLow],
      ] as const;
      for (const [label, basePrice, leveragedPrice] of checkpoints) {
        const upLevel = leveragedReference * (1 + rebalanceUp);
        const downLevel = leveragedReference * (1 - rebalanceDown);
        const isUp = leveragedPrice >= upLevel;
        if (!isUp && leveragedPrice > downLevel) continue;
        if (label === '開盤') {
          rebalanceLeveraged(row, basePrice, leveragedPrice, label);
          continue;
        }
        // 盤中觸及門檻時以門檻價成交，不假設賣在最高、買在最低。
        // 0050 在同一時點的價格無法得知，用「正二約為兩倍日報酬」從開盤價推估，只用於計算總資產。
        const fill = Math.min(row.leveragedHigh, Math.max(row.leveragedLow, isUp ? upLevel : downLevel));
        const estimatedBase = row.open * (1 + (fill / row.leveragedOpen - 1) / 2);
        rebalanceLeveraged(row, Math.min(row.high, Math.max(row.low, estimatedBase)), fill, label);
      }
    }

    if (mode === 'leveraged') {
      belowThreeStreak = deviationPct <= -3 ? belowThreeStreak + 1 : 0;
      if (qqqDeviationPct <= -10) {
        exitLeveraged(row, row.leveragedClose, `QQQ ${row.qqqDate} 收盤低於年線 −10%，跨市場強制撤退`);
      } else if (deviationPct <= -5) {
        exitLeveraged(row, row.leveragedClose, '單日收盤低於年線 −5%，立即撤退');
      } else if (belowThreeStreak >= 3) {
        pendingExit = true;
      }
      if (mode === 'leveraged' && (row.leveragedClose >= leveragedReference * (1 + rebalanceUp)
        || row.leveragedClose <= leveragedReference * (1 - rebalanceDown))) {
        rebalanceLeveraged(row, row.close, row.leveragedClose, '收盤');
      }
    }

    if (mode === 'defensive') {
      for (const rung of LADDER) {
        const threshold = -rung;
        if (deviationPct <= threshold && previousDeviation > threshold && !usedLeft.has(rung)) {
          const spend = Math.min(tacticalCash, cycleAnchor * 0.05);
          if (spend > 0) {
            tacticalBaseShares += buyShares(spend, row.close);
            tacticalCash -= spend;
            usedLeft.add(rung);
            events.push({
              date: row.date,
              kind: 'left-buy',
              signal: `向下跌破年線 −${rung}%`,
              action: '備戰金加碼 0050（左側 5%）',
              deviationPct,
              basePrice: row.close,
              leveragedPrice: row.leveragedClose,
              amount: spend,
            });
          }
        }
        if (deviationPct >= threshold && previousDeviation < threshold && !usedRight.has(rung)) {
          const spend = Math.min(tacticalCash, cycleAnchor * 0.02);
          if (spend > 0) {
            tacticalBaseShares += buyShares(spend, row.close);
            tacticalCash -= spend;
            usedRight.add(rung);
            events.push({
              date: row.date,
              kind: 'right-buy',
              signal: `向上收復年線 −${rung}%`,
              action: '備戰金加碼 0050（右側 2%）',
              deviationPct,
              basePrice: row.close,
              leveragedPrice: row.leveragedClose,
              amount: spend,
            });
          }
        }
      }

      aboveThreeStreak = deviationPct >= 3 ? aboveThreeStreak + 1 : 0;
      if (deviationPct >= 5 && qqqDeviationPct > -10) {
        reenterLeveraged(row, row.close, row.leveragedClose, '單日收盤站上年線 +5%，立即反攻');
      } else if (aboveThreeStreak >= 3 && qqqDeviationPct > -10) {
        pendingReentry = true;
      }
    }

    const year = row.date.slice(0, 4);
    if (index > 0 && year !== halfYear) {
      const total = halfShares * row.leveragedOpen + halfCash;
      const targetAsset = total * 0.5;
      const currentAsset = halfShares * row.leveragedOpen;
      if (currentAsset > targetAsset) {
        const sharesToSell = (currentAsset - targetAsset) / row.leveragedOpen;
        halfShares -= sharesToSell;
        halfCash += saleProceeds(sharesToSell, row.leveragedOpen);
      } else if (currentAsset < targetAsset) {
        const spend = Math.min(halfCash, targetAsset - currentAsset);
        halfShares += buyShares(spend, row.leveragedOpen);
        halfCash -= spend;
      }
      halfYear = year;
    }

    const coreBase = coreShares * row.close;
    const tacticalBase = tacticalBaseShares * row.close;
    const leveraged = leveragedShares * row.leveragedClose;
    const total = coreBase + tacticalBase + leveraged + reserve + tacticalCash;
    curve.push({
      date: row.date,
      total,
      coreBase,
      tacticalBase,
      leveraged,
      reserve,
      tacticalCash,
      basePrice: row.close,
      movingAverage: row.movingAverage,
      deviationPct,
      qqqClose: row.qqqClose,
      qqqMovingAverage: row.qqqMovingAverage,
      qqqDeviationPct,
      baseBenchmark: baseBenchmarkShares * row.close,
      leveragedBenchmark: leveragedBenchmarkShares * row.leveragedClose,
      halfBenchmark: halfShares * row.leveragedClose + halfCash,
    });
    previousDeviation = deviationPct;
  }

  const years = elapsedYears(signals[0].date, signals.at(-1)!.date);
  const values = curve.map((point) => point.total);
  const summary = summarize(values, initial, years);
  const annual: RyanAnnual[] = [];
  let priorEnding = initial;
  const yearEnds = new Map<string, RyanCurvePoint>();
  for (const point of curve) yearEnds.set(point.date.slice(0, 4), point);
  for (const [year, point] of yearEnds) {
    annual.push({ year, returnPct: (point.total / priorEnding - 1) * 100, ending: point.total });
    priorEnding = point.total;
  }
  const endingPoint = curve.at(-1)!;
  const weight = (value: number) => summary.ending ? value / summary.ending * 100 : 0;
  return {
    curve,
    events,
    annual,
    ending: summary.ending,
    totalReturn: (summary.ending / initial - 1) * 100,
    cagr: summary.cagr,
    mdd: summary.mdd,
    positiveYears: annual.filter((row) => row.returnPct > 0).length,
    exitCount: events.filter((event) => event.kind === 'exit').length,
    reentryCount: events.filter((event) => event.kind === 'reentry').length,
    leftBuyCount: events.filter((event) => event.kind === 'left-buy').length,
    rightBuyCount: events.filter((event) => event.kind === 'right-buy').length,
    qqqExitCount: events.filter((event) => event.kind === 'exit' && event.signal.startsWith('QQQ')).length,
    rebalanceCount: events.filter((event) => event.kind === 'rebalance-buy' || event.kind === 'rebalance-sell').length,
    endingWeights: {
      core: weight(endingPoint.coreBase),
      tacticalBase: weight(endingPoint.tacticalBase),
      leveraged: weight(endingPoint.leveraged),
      reserve: weight(endingPoint.reserve),
      tacticalCash: weight(endingPoint.tacticalCash),
    },
    comparisons: {
      base: summarize(curve.map((point) => point.baseBenchmark), initial, years),
      leveraged: summarize(curve.map((point) => point.leveragedBenchmark), initial, years),
      half: summarize(curve.map((point) => point.halfBenchmark), initial, years),
    },
  };
}
