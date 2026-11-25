import { readFile, writeFile } from 'node:fs/promises';

const file = new URL('../public/data/00631L.json', import.meta.url);
const existing = JSON.parse(await readFile(file, 'utf8'));
const startDate = existing.at(-1)?.date ?? '2014-10-31';
const endDate = process.env.END_DATE ?? new Date().toISOString().slice(0, 10);
const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=00631L&start_date=${startDate}&end_date=${endDate}`;
const response = await fetch(url);
if (!response.ok) throw new Error(`FinMind request failed: ${response.status}`);
const payload = await response.json();
if (payload.status !== 200 || !Array.isArray(payload.data)) throw new Error(payload.msg ?? 'FinMind returned no data');

const rows = new Map(existing.map((row) => [row.date, row]));
for (const row of payload.data) {
  if (existing.length && row.date <= startDate) continue;
  rows.set(row.date, {
    date: row.date,
    open: Number(row.open),
    high: Number(row.max),
    low: Number(row.min),
    close: Number(row.close),
  });
}
const merged = [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
await writeFile(file, `${JSON.stringify(merged, null, 2)}\n`);
console.log(`Updated 00631L: ${existing.length} → ${merged.length} rows; latest ${merged.at(-1)?.date}`);
