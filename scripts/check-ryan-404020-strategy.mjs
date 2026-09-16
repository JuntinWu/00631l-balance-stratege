import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { adjust0050ForSplits, adjust00631LForSplits } from '../app/price-adjustments.ts';
import { runRyan404020Backtest } from '../app/ryan-404020-backtest.ts';

const readRows = async (name) => JSON.parse(await readFile(new URL(`../public/data/${name}.json`, import.meta.url), 'utf8'));
const base = adjust0050ForSplits(await readRows('0050')).rows;
const leveraged = adjust00631LForSplits(await readRows('00631L')).rows;
const qqq = await readRows('QQQ');
const result = runRyan404020Backtest(base, leveraged, qqq, '2015-01-01', '2026-09-09', {
  initialWan: 1000,
  rebalanceUpPct: 70,
  rebalanceDownPct: 30,
  commissionPct: 0.1425,
  discount: 1.8,
  transactionTaxPct: 0.1,
});
const tighterThresholds = runRyan404020Backtest(base, leveraged, qqq, '2015-01-01', '2026-09-09', {
  initialWan: 1000,
  rebalanceUpPct: 20,
  rebalanceDownPct: 10,
  commissionPct: 0.1425,
  discount: 1.8,
  transactionTaxPct: 0.1,
});

assert.ok(qqq.length > 3000, 'expected full QQQ daily history');
assert.ok(result.curve.length > 2800, 'expected a full-history daily curve');
assert.ok(result.events.some((event) => event.kind === 'exit'), 'strategy must leave leveraged exposure');
assert.ok(result.events.some((event) => event.kind === 'reentry'), 'strategy must restart leveraged exposure');
assert.ok(result.rebalanceCount > 0, 'strategy must apply threshold rebalancing while leveraged');
assert.ok(tighterThresholds.rebalanceCount > result.rebalanceCount, 'tighter user thresholds must trigger more rebalances');
assert.ok(result.leftBuyCount > 0, 'strategy must use left-side smile-curve buys');
assert.ok(result.rightBuyCount > 0, 'strategy must use right-side confirmation buys');
assert.ok(result.qqqExitCount > 0, 'QQQ -10% cross-market rule must trigger in the history');
assert.ok(result.curve.every((point) => point.coreBase >= 0 && point.tacticalBase >= 0 && point.leveraged >= 0 && point.reserve >= 0 && point.tacticalCash >= -0.001), 'portfolio sleeves must never be negative');
assert.ok(result.curve.every((point) => Number.isFinite(point.qqqMovingAverage) && point.qqqMovingAverage > 0), 'each Taiwan signal day needs an available prior QQQ 240MA');
assert.ok(Number.isFinite(result.ending) && result.ending > 0, 'ending value must be valid');
assert.ok(Object.values(result.comparisons).every((item) => Number.isFinite(item.cagr) && Number.isFinite(item.mdd)), 'benchmark summaries must be valid');
console.log(`PASS: ending ${result.ending.toFixed(0)}, CAGR ${result.cagr.toFixed(2)}%, MDD ${result.mdd.toFixed(2)}%, QQQ exits ${result.qqqExitCount}`);
