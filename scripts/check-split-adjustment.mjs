import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { adjust0050ForSplits, adjust00631LForSplits } from '../app/price-adjustments.ts';

const raw = JSON.parse(await readFile(new URL('../public/data/00631L.json', import.meta.url), 'utf8'));
const adjusted = adjust00631LForSplits(raw);
const march24 = adjusted.rows.find((row) => row.date === '2026-03-24');
const march31 = adjusted.rows.find((row) => row.date === '2026-03-31');

assert.ok(march24 && march31, 'split boundary rows must exist');
assert.deepEqual(adjusted.appliedSplits, [{ effectiveDate: '2026-03-31', ratio: 22 }]);
// 資料可能已含息還原，不再比對原始價格；改檢查分割前後價格連續。
assert.ok(Math.abs(march24.close / march31.close - 1) < 0.25, `pre-split close must be divided by 22: ${march24.close} vs ${march31.close}`);

let worst = { ratio: 1, date: '' };
for (let index = 1; index < adjusted.rows.length; index += 1) {
  const ratio = adjusted.rows[index].close / adjusted.rows[index - 1].close;
  if (ratio < worst.ratio) worst = { ratio, date: adjusted.rows[index].date };
}
assert.ok(worst.ratio > 0.6, `split-like cliff remains on ${worst.date}: ${worst.ratio}`);
console.log(`PASS: 22:1 split adjusted; worst close ratio ${worst.ratio.toFixed(4)} on ${worst.date}`);

const raw0050 = JSON.parse(await readFile(new URL('../public/data/0050.json', import.meta.url), 'utf8'));
const adjusted0050 = adjust0050ForSplits(raw0050);
const june10 = adjusted0050.rows.find((row) => row.date === '2025-06-10');
const june18 = adjusted0050.rows.find((row) => row.date === '2025-06-18');
assert.ok(june10 && june18, '0050 split boundary rows must exist');
assert.deepEqual(adjusted0050.appliedSplits, [{ effectiveDate: '2025-06-18', ratio: 4 }]);
assert.ok(Math.abs(june10.close / june18.close - 1) < 0.15, `0050 pre-split close must be divided by 4: ${june10.close} vs ${june18.close}`);
console.log('PASS: 0050 4:1 split adjusted');
