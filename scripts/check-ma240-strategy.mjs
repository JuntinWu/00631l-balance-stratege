import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { adjust0050ForSplits, adjust00631LForSplits } from '../app/price-adjustments.ts';
import { runMa240Backtest } from '../app/ma240-backtest.ts';

const readRows = async (name) => JSON.parse(await readFile(new URL(`../public/data/${name}.json`, import.meta.url), 'utf8'));
const base = adjust0050ForSplits(await readRows('0050')).rows;
const leveraged = adjust00631LForSplits(await readRows('00631L')).rows;
const result = runMa240Backtest(base, leveraged, '2015-01-01', '2026-09-09', {
  initialWan: 1000,
  monthlyWan: 5,
  commissionPct: 0.1425,
  discount: 1.8,
});

assert.ok(result.curve.length > 2800, 'expected a full-history daily curve');
assert.ok(result.buys.length > 100, 'expected monthly purchases');
assert.ok(result.baseBuys > 0, 'strategy must buy 0050 above its 240MA');
assert.ok(result.leveragedBuys > 0, 'strategy must buy 00631L below the 240MA');
assert.equal(result.totalInvested, 17_000_000, 'initial capital plus monthly contributions must reconcile');
assert.ok(Number.isFinite(result.ending) && result.ending > 0, 'ending value must be valid');
console.log(`PASS: ${result.buys.length} buys (${result.baseBuys} above MA, ${result.leveragedBuys} below MA)`);
