import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { adjust0050ForSplits, adjust00631LForSplits } from '../app/price-adjustments.ts';
import { runAliang73Backtest, xirr } from '../app/aliang-73-backtest.ts';

const readRows = async (name) => JSON.parse(await readFile(new URL(`../public/data/${name}.json`, import.meta.url), 'utf8'));
const base = adjust0050ForSplits(await readRows('0050')).rows;
const leveraged = adjust00631LForSplits(await readRows('00631L')).rows;
const settings = { capitalWan: 1000, targetPct: 70, monthlyWan: 0, cashRatePct: 1.5, rungs: [20, 40, 60], startDate: '2014-01-01', endDate: '2099-12-31' };

// XIRR 自我檢查：投 100、一年後拿回 110 → 10%
assert.ok(Math.abs(xirr([{ date: '2020-01-01', amount: -100 }, { date: '2020-12-31', amount: 110 }]) - 0.1) < 0.002, 'xirr sanity');

const r = runAliang73Backtest(base, leveraged, settings);
const first = r.trades[0];
assert.equal(first.label.startsWith('初始七三配'), true);
assert.ok(Math.abs(first.ratio - 70) < 0.2, `initial weight must be ~70%, got ${first.ratio}`);
assert.equal(r.invested, 10_000_000);
assert.ok(r.dipCount >= 3, 'full history must trigger the drawdown ladder (e.g. 2020, 2022)');
assert.ok(r.curve.every((p) => p.cash >= -0.01 && p.asset >= 0), 'cash and position must never go negative');
assert.ok(r.trades.every((t) => t.amount > 0), 'accumulation phase never sells');
assert.ok(r.interest > 0, 'cash must earn interest');
assert.ok(Number.isFinite(r.annualized) && r.ending > 0);

// 沒有大跌階梯時不應動用現金：現金只會因利息變多
const noDip = runAliang73Backtest(base, leveraged, { ...settings, rungs: [], cashRatePct: 0 });
assert.equal(noDip.dipCount, 0);
assert.ok(Math.abs(noDip.curve.at(-1).cash - 3_000_000) < 1, 'reserve stays fixed without dips');

// 每月投入：本金對帳＋XIRR
const dca = runAliang73Backtest(base, leveraged, { ...settings, monthlyWan: 5, startDate: '2015-01-01', endDate: '2024-12-31' });
const months = new Set(dca.curve.map((p) => p.date.slice(0, 7))).size;
assert.equal(dca.invested, 10_000_000 + (months - 1) * 50_000, 'contributions must reconcile');
assert.ok(Number.isFinite(dca.annualized));

console.log(`PASS: ending ${Math.round(r.ending / 1e4)}萬, annualized ${r.annualized.toFixed(2)}% (0050 ${r.benchAnnualized.toFixed(2)}%), dips ${r.dipCount}, final 正二 ${r.endingRatio.toFixed(1)}%`);
for (const t of r.trades) console.log(' ', t.date, t.label, t.price.toFixed(2), Math.round(t.amount / 1e4) + '萬', t.ratio.toFixed(1) + '%');
