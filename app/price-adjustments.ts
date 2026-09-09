export type OhlcRow = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type SplitAdjustment = {
  effectiveDate: string;
  ratio: number;
};

export type AdjustedPrices = {
  rows: OhlcRow[];
  appliedSplits: SplitAdjustment[];
};

const KNOWN_00631L_SPLITS: SplitAdjustment[] = [
  { effectiveDate: '2026-03-31', ratio: 22 },
];

export function adjust00631LForSplits(rows: OhlcRow[]): AdjustedPrices {
  let adjusted = rows.map((row) => ({ ...row }));
  const appliedSplits: SplitAdjustment[] = [];

  for (const split of KNOWN_00631L_SPLITS) {
    const firstPostSplit = adjusted.findIndex((row) => row.date >= split.effectiveDate);
    if (firstPostSplit <= 0) continue;

    const previous = adjusted[firstPostSplit - 1];
    const current = adjusted[firstPostSplit];
    const boundaryRatio = previous.close / current.close;

    // Only adjust raw price series. An already-adjusted series is continuous
    // across the known split date and must not be divided a second time.
    if (boundaryRatio < split.ratio / 2) continue;

    adjusted = adjusted.map((row) => row.date < split.effectiveDate
      ? {
          ...row,
          open: row.open / split.ratio,
          high: row.high / split.ratio,
          low: row.low / split.ratio,
          close: row.close / split.ratio,
        }
      : row);
    appliedSplits.push(split);
  }

  return { rows: adjusted, appliedSplits };
}
