import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { adjust0050ForSplits, adjust00631LForSplits } from '../app/price-adjustments.ts';

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

const raw0050 = JSON.parse(await readFile(new URL('../public/data/0050.json', import.meta.url), 'utf8'));
const adjusted0050 = adjust0050ForSplits(raw0050);
const june10 = adjusted0050.rows.find((row) => row.date === '2025-06-10');
const june18 = adjusted0050.rows.find((row) => row.date === '2025-06-18');
assert.ok(june10 && june18, '0050 split boundary rows must exist');
assert.deepEqual(adjusted0050.appliedSplits, [{ effectiveDate: '2025-06-18', ratio: 4 }]);
assert.ok(Math.abs(june10.close - 188.65 / 4) < 1e-9, '0050 pre-split close must be divided by 4');
assert.equal(june18.close, 47.57, '0050 post-split close must stay unchanged');
console.log('PASS: 0050 4:1 split adjusted');
