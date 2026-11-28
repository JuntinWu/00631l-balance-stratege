import type { OhlcRow } from './price-adjustments';

export function build0050Benchmark(
  points: ReadonlyArray<{ date: string }>,
  prices: OhlcRow[],
  initial: number,
  buyFee: number,
  entry: 'open' | 'close',
) {
  const values = new Map<string, number>();
  const start = points[0]?.date;
  const lastPriceDate = prices.at(-1)?.date;
  if (!start || !lastPriceDate) return values;

  let priceIndex = prices.findIndex((row) => row.date >= start);
  if (priceIndex < 0) return values;
  const firstPrice = prices[priceIndex];
  const shares = initial / (1 + buyFee) / firstPrice[entry];
  for (const point of points) {
    if (point.date < firstPrice.date) continue;
    if (point.date > lastPriceDate) break;
    while (priceIndex + 1 < prices.length && prices[priceIndex + 1].date <= point.date) {
      priceIndex += 1;
    }
    values.set(point.date, shares * prices[priceIndex].close);
  }
  return values;
}
