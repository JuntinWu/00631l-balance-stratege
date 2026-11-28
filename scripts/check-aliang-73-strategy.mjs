import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { adjust0050ForSplits, adjust00631LForSplits, adjust00662ForSplits, adjust00685LForSplits } from '../app/price-adjustments.ts';
import { runAliang73Backtest, xirr } from '../app/aliang-73-backtest.ts';

const readRows = async (name) => JSON.parse(await readFile(new URL(`../public/data/${name}.json`, import.meta.url), 'utf8'));
const prices = {
  base: adjust0050ForSplits(await readRows('0050')).rows,
  l631: adjust00631LForSplits(await readRows('00631L')).rows,
  l685: adjust00685LForSplits(await readRows('00685L')).rows,
  nasdaq: adjust00662ForSplits(await readRows('00662')).rows,
  bond: await readRows('00865B'),
};
const retireOff = { enabled: false, expenseWan: 100, multiple: 20, inflationPct: 2, withdraw: true, mix: { leveraged: 100 / 3, nasdaq: 100 / 3, cash: 100 / 3 } };
const settings = { capitalWan: 1000, targetPct: 70, monthlyWan: 0, cashRatePct: 1.5, rungs: [20, 40, 60], startDate: '2014-01-01', endDate: '2099-12-31', legMode: 'single', retire: retireOff };

// XIRR 自我檢查：投 100、一年後拿回 110 → 10%
assert.ok(Math.abs(xirr([{ date: '2020-01-01', amount: -100 }, { date: '2020-12-31', amount: 110 }]) - 0.1) < 0.002, 'xirr sanity');

// ── 累積期（00631L 單檔）──
const r = runAliang73Backtest(prices, settings);
assert.ok(r.trades[0].label.startsWith('初始七三配'));
assert.ok(Math.abs(r.trades[0].ratio - 70) < 0.2, `initial weight must be ~70%, got ${r.trades[0].ratio}`);
assert.equal(r.invested, 10_000_000);
assert.ok(r.dipCount >= 3, 'full history must trigger the drawdown ladder');
assert.ok(r.curve.every((p) => p.cash >= -0.01 && p.asset >= 0), 'cash and position must never go negative');
assert.ok(r.trades.every((t) => t.amount > 0), 'accumulation phase never sells');
assert.ok(r.interest > 0 && r.retiredAt === null && r.withdrawn === 0);

const noDip = runAliang73Backtest(prices, { ...settings, rungs: [], cashRatePct: 0 });
assert.equal(noDip.dipCount, 0);
assert.ok(Math.abs(noDip.curve.at(-1).cash - 3_000_000) < 1, 'reserve stays fixed without dips');

const dca = runAliang73Backtest(prices, { ...settings, monthlyWan: 5, startDate: '2015-01-01', endDate: '2024-12-31' });
const months = new Set(dca.curve.map((p) => p.date.slice(0, 7))).size;
assert.equal(dca.invested, 10_000_000 + (months - 1) * 50_000, 'contributions must reconcile');
console.log(`PASS 累積期: 年化 ${r.annualized.toFixed(2)}%（0050 ${r.benchAnnualized.toFixed(2)}%），加碼 ${r.dipCount} 次`);

// ── 00631L／00685L 各半：起點自動移到 00685L 上市日 ──
const halfR = runAliang73Backtest(prices, { ...settings, legMode: 'half' });
assert.equal(halfR.startDate, prices.l685[0].date);
assert.ok(halfR.ending > 0 && Number.isFinite(halfR.annualized));
console.log(`PASS 各半: ${halfR.startDate} 起，年化 ${halfR.annualized.toFixed(2)}%`);

// ── 退休期：1000 萬、年開銷 100 萬 → 2000 萬（含通膨）時轉三刀流 333 ──
const ret = runAliang73Backtest(prices, { ...settings, retire: { ...retireOff, enabled: true } });
assert.ok(ret.retiredAt, 'should reach 20x expense in full history');
const retTrade = ret.trades.find((t) => t.label.startsWith('達 20 倍'));
assert.ok(retTrade && retTrade.amount < 0, 'retirement withdraws the first year');
const after = ret.curve.find((p) => p.date === ret.retiredAt);
assert.ok(Math.abs(after.ratio - 100 / 3) < 1, `right after retiring 正二 must be ~33%, got ${after.ratio}`);
assert.ok(Math.abs(after.nasdaq / after.total - 1 / 3) < 0.01, '00662 must be ~33%');
const yearEnds = ret.trades.filter((t) => t.label.startsWith('年底提領'));
const retiredYears = new Set(ret.curve.filter((p) => p.date >= ret.retiredAt).map((p) => p.date.slice(0, 4))).size;
assert.equal(yearEnds.length, retiredYears - 1, 'one withdrawal + rebalance per year-end after retiring');
for (const t of yearEnds) assert.ok(Math.abs(t.ratio - 100 / 3) < 1.5, `year-end rebalance back to ~33% on ${t.date}: ${t.ratio}`);
assert.ok(ret.withdrawn > 0 && !ret.depleted);
assert.ok(ret.curve.every((p) => p.cash >= -1 && p.asset >= 0 && p.nasdaq >= 0), 'no negative sleeves');
// 00865B 上市後，現金部位應轉進 00865B（cash 欄位含 00865B）
const lastPoint = ret.curve.at(-1);
assert.ok(Math.abs(lastPoint.cash / lastPoint.total - 1 / 3) < 0.12, 'cash+00865B sleeve near 1/3');
console.log(`PASS 退休期: ${ret.retiredAt} 退休（資產 ${Math.round(ret.retiredTotal / 1e4)} 萬），提領合計 ${Math.round(ret.withdrawn / 1e4)} 萬，期末 ${Math.round(ret.ending / 1e4)} 萬，XIRR ${ret.annualized.toFixed(2)}%（0050 ${ret.benchAnnualized.toFixed(2)}%）`);

// ── 各半＋退休：退休當天與每次年底再平衡後，00631L 與 00685L 市值各占正二一半 ──
const halfRet = runAliang73Backtest(prices, { ...settings, legMode: 'half', retire: { ...retireOff, enabled: true } });
assert.ok(halfRet.retiredAt);
const rebalanceDates = halfRet.trades.filter((t) => t.label.startsWith('達 20 倍') || t.label.startsWith('年底提領')).map((t) => t.date);
assert.ok(rebalanceDates.length >= 3, 'expect several year-end rebalances');
for (const date of rebalanceDates) {
  const p = halfRet.curve.find((point) => point.date === date);
  const share = p.l631 / (p.l631 + p.l685);
  assert.ok(Math.abs(share - 0.5) < 0.005, `00631L/00685L must be 50/50 after rebalance on ${date}: ${(share * 100).toFixed(2)}%`);
  assert.ok(Math.abs(p.ratio - 100 / 3) < 1.5, `正二 ~33% on ${date}: ${p.ratio}`);
}
// 年中會漂移（兩檔漲跌不同），證明確實有在調
const drift = Math.max(...halfRet.curve.filter((p) => p.date > halfRet.retiredAt).map((p) => Math.abs(p.l631 / (p.l631 + p.l685) - 0.5)));
assert.ok(drift > 0.005, 'legs should drift between rebalances');
console.log(`PASS 各半＋退休: ${rebalanceDates.length} 次再平衡都調回 50/50（年中最大漂移 ${(drift * 100).toFixed(2)} 個百分點），XIRR ${halfRet.annualized.toFixed(2)}%`);

// ── 退休但不提領：同一天轉配置、每年再平衡，沒有任何提領 ──
const keep = runAliang73Backtest(prices, { ...settings, retire: { ...retireOff, enabled: true, withdraw: false } });
assert.equal(keep.retiredAt, ret.retiredAt, 'same retirement trigger date');
assert.equal(keep.withdrawn, 0);
assert.ok(keep.trades.every((t) => t.amount >= 0), 'no withdrawals');
const keepYearEnds = keep.trades.filter((t) => t.label === '年底再平衡（不提領）');
assert.equal(keepYearEnds.length, yearEnds.length, 'still rebalances every year-end');
for (const t of keepYearEnds) assert.ok(Math.abs(t.ratio - 100 / 3) < 1.5, `rebalanced to ~33% on ${t.date}`);
assert.ok(keep.simple, 'no intermediate cash flows → CAGR');
assert.ok(keep.ending > ret.ending, 'keeping the money ends higher than withdrawing');
console.log(`PASS 退休不提領: 期末 ${Math.round(keep.ending / 1e4)} 萬（提領版 ${Math.round(ret.ending / 1e4)} 萬＋已提領 ${Math.round(ret.withdrawn / 1e4)} 萬），CAGR ${keep.annualized.toFixed(2)}%`);

// ── 頁面預設階梯 10/20/30/40/50 ──
const ui = runAliang73Backtest(prices, { ...settings, rungs: [10, 20, 30, 40, 50] });
const uiRet = runAliang73Backtest(prices, { ...settings, rungs: [10, 20, 30, 40, 50], retire: { ...retireOff, enabled: true } });
assert.ok(ui.dipCount >= r.dipCount, 'shallower rungs trigger at least as often');
assert.ok(ui.trades.filter((t) => t.label.startsWith('大跌加碼')).every((t) => /−(10|20|30|40|50)%/.test(t.label)));
console.log(`PASS 預設階梯 10-50: 累積期年化 ${ui.annualized.toFixed(2)}%，加碼 ${ui.dipCount} 次；退休 333 ${uiRet.retiredAt}，XIRR ${uiRet.annualized.toFixed(2)}%`);

// 配置合計不是 100% 要報錯
assert.throws(() => runAliang73Backtest(prices, { ...settings, retire: { ...retireOff, enabled: true, mix: { leveraged: 50, nasdaq: 30, cash: 30 } } }), /100%/);
