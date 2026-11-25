// 一次更新 0050、00631L、QQQ 三份資料，避免各策略因日期不同步而少算區間。
//
// 台股兩檔使用「還原股價」：抓 FinMind 原始日K（TaiwanStockPrice）與除權息結果
// （TaiwanStockDividendResult），在每個除息日之前的價格乘上 after_price / before_price，
// 等同於除息日當天把現金股利再投入。股票分割（0050 1拆4、00631L 1拆22）仍由
// app/price-adjustments.ts 在瀏覽器端處理，這裡不重複調整。
//
// QQQ 只用來計算年線乖離訊號，沿用 Yahoo 的 close（已調整分割、未含息）。
//
// 用法：npm run update:data
//   END_DATE=2026-11-25 npm run update:data   # 指定結束日
//   FINMIND_TOKEN=xxx npm run update:data     # 有 FinMind token 時可提高額度
import { readFile, writeFile } from 'node:fs/promises';

const END_DATE = process.env.END_DATE ?? new Date().toISOString().slice(0, 10);
const TOKEN = process.env.FINMIND_TOKEN;
const dataFile = (name) => new URL(`../public/data/${name}.json`, import.meta.url);
const round = (value) => Math.round(value * 1e6) / 1e6;

async function readExisting(name) {
  try {
    return JSON.parse(await readFile(dataFile(name), 'utf8'));
  } catch {
    return [];
  }
}

async function finmind(dataset, dataId, startDate) {
  const params = new URLSearchParams({ dataset, data_id: dataId, start_date: startDate, end_date: END_DATE });
  const response = await fetch(`https://api.finmindtrade.com/api/v4/data?${params}`, {
    headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
  });
  if (!response.ok) throw new Error(`FinMind ${dataset} ${dataId}: HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.status !== 200 || !Array.isArray(payload.data)) {
    throw new Error(`FinMind ${dataset} ${dataId}: ${payload.msg ?? 'no data'}`);
  }
  return payload.data;
}

async function fetchAdjustedTaiwan(id, startDate) {
  const prices = (await finmind('TaiwanStockPrice', id, startDate))
    .filter((row) => Number(row.close) > 0)
    .map((row) => ({
      date: row.date,
      open: Number(row.open),
      high: Number(row.max),
      low: Number(row.min),
      close: Number(row.close),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // 只採用現金股利造成的價格調整（因子介於 0.8～1）。分割或減資這類大幅調整
  // 交給 price-adjustments.ts，避免重複調整。
  const events = (await finmind('TaiwanStockDividendResult', id, startDate))
    .map((item) => ({ date: item.date, factor: Number(item.after_price) / Number(item.before_price) }))
    .filter((event) => Number.isFinite(event.factor) && event.factor > 0.8 && event.factor < 1)
    .sort((a, b) => a.date.localeCompare(b.date));

  const rows = prices.map((row) => {
    const factor = events.reduce((product, event) => (row.date < event.date ? product * event.factor : product), 1);
    return {
      date: row.date,
      open: round(row.open * factor),
      high: round(row.high * factor),
      low: round(row.low * factor),
      close: round(row.close * factor),
    };
  });
  const cumulative = events.reduce((product, event) => product * event.factor, 1);
  console.log(`${id}: ${rows.length} rows, ${events.length} 次除息，最早價格調整係數 ${cumulative.toFixed(4)}`);
  return rows;
}

async function fetchQqq() {
  const period1 = Math.floor(Date.parse('2014-01-01T00:00:00Z') / 1000);
  const period2 = Math.floor(Date.parse(`${END_DATE}T00:00:00Z`) / 1000) + 86_400;
  const response = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/QQQ?period1=${period1}&period2=${period2}&interval=1d`,
    { headers: { 'User-Agent': 'Mozilla/5.0' } },
  );
  if (!response.ok) throw new Error(`Yahoo QQQ: HTTP ${response.status}`);
  const result = (await response.json())?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  if (!result?.timestamp || !quote) throw new Error('Yahoo QQQ: no data');
  const offset = result.meta?.gmtoffset ?? 0;
  const rows = result.timestamp
    .map((time, i) => ({
      date: new Date((time + offset) * 1000).toISOString().slice(0, 10),
      open: quote.open[i],
      high: quote.high[i],
      low: quote.low[i],
      close: quote.close[i],
    }))
    .filter((row) => [row.open, row.high, row.low, row.close].every(Number.isFinite));
  console.log(`QQQ: ${rows.length} rows`);
  return rows;
}

function guard(name, existing, next) {
  if (!next.length) throw new Error(`${name}: 沒有抓到資料`);
  if (existing.length && next.length < existing.length * 0.95) {
    throw new Error(`${name}: 新資料只有 ${next.length} 筆（原本 ${existing.length} 筆），不覆蓋`);
  }
}

// 先全部抓完、檢查通過才一起寫入，避免只更新到一部分造成日期不同步。
const targets = [
  ['0050', () => fetchAdjustedTaiwan('0050', '2014-01-01')],
  ['00631L', () => fetchAdjustedTaiwan('00631L', '2014-10-31')],
  ['QQQ', fetchQqq],
];
const results = [];
for (const [name, fetcher] of targets) {
  const [existing, next] = await Promise.all([readExisting(name), fetcher()]);
  guard(name, existing, next);
  results.push([name, next]);
}
for (const [name, rows] of results) {
  await writeFile(dataFile(name), `${JSON.stringify(rows)}\n`);
  console.log(`已寫入 ${name}.json，最新日期 ${rows.at(-1).date}`);
}
