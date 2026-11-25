import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { adjust0050ForSplits } from '../app/price-adjustments.ts';

const readRows = async (name) => JSON.parse(await readFile(new URL(`../public/data/${name}.json`, import.meta.url), 'utf8'));
const base = adjust0050ForSplits(await readRows('0050')).rows;
const leveraged = await readRows('00631L');
const qqq = await readRows('QQQ');

// 0050 原始收盤 2014/10/31 為 65.3（分割後 16.325）。含息還原後應明顯更低。
const oct31 = base.find((row) => row.date === '2014-10-31');
assert.ok(oct31, '0050 must include 2014-10-31');
assert.ok(oct31.close < (65.3 / 4) * 0.85, `0050 looks unadjusted for dividends: ${oct31.close}`);

const lastDates = { '0050': base.at(-1).date, '00631L': leveraged.at(-1).date, QQQ: qqq.at(-1).date };
const days = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 864e5;
assert.ok(days(lastDates['0050'], lastDates['00631L']) <= 3, `0050/00631L out of sync: ${JSON.stringify(lastDates)}`);
assert.ok(days(lastDates['0050'], lastDates.QQQ) <= 5, `QQQ out of sync: ${JSON.stringify(lastDates)}`);
console.log(`PASS: 0050 已含息還原（2014/10/31 = ${oct31.close.toFixed(3)}），資料同步至 ${JSON.stringify(lastDates)}`);
