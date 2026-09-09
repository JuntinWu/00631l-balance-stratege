import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { adjust00631LForSplits } from '../app/price-adjustments.ts';

const raw = JSON.parse(await readFile(new URL('../public/data/00631L.json', import.meta.url), 'utf8'));
const adjusted = adjust00631LForSplits(raw);
const march24 = adjusted.rows.find((row) => row.date === '2026-03-24');
const march31 = adjusted.rows.find((row) => row.date === '2026-03-31');

assert.ok(march24 && march31, 'split boundary rows must exist');
assert.deepEqual(adjusted.appliedSplits, [{ effectiveDate: '2026-03-31', ratio: 22 }]);
assert.ok(Math.abs(march24.close - 443.15 / 22) < 1e-9, 'pre-split close must be divided by 22');
assert.ok(march31.close === 19.26, 'post-split close must stay unchanged');

let worst = { ratio: 1, date: '' };
for (let index = 1; index < adjusted.rows.length; index += 1) {
  const ratio = adjusted.rows[index].close / adjusted.rows[index - 1].close;
  if (ratio < worst.ratio) worst = { ratio, date: adjusted.rows[index].date };
}
assert.ok(worst.ratio > 0.6, `split-like cliff remains on ${worst.date}: ${worst.ratio}`);
console.log(`PASS: 22:1 split adjusted; worst close ratio ${worst.ratio.toFixed(4)} on ${worst.date}`);
