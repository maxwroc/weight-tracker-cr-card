import { PERIODS, type Period } from '../types';

export type Bucket = 'raw' | 'day' | 'week' | 'month';

export interface PeriodRange {
  period: Period;
  /** Inclusive lower bound. */
  start: Date;
  /** Upper bound (now). */
  end: Date;
  /**
   * How to aggregate. `raw` means "return individual records"; otherwise the
   * value is a Custom Records aggregate bucket size.
   */
  bucket: Bucket;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

const PERIOD_DAYS: Record<Period, number> = {
  '7d': 7,
  '1m': 30,
  '6m': 182,
  '1y': 365,
};

const PERIOD_BUCKET: Record<Period, Bucket> = {
  // Short range: show every measurement.
  '7d': 'raw',
  // A month of daily-ish records stays readable as raw daily points.
  '1m': 'day',
  // Longer ranges get progressively coarser buckets to keep the line clean.
  '6m': 'week',
  '1y': 'week',
};

/**
 * Resolve a period selection into a concrete date range and bucket strategy.
 * Pure and deterministic given `now` (injectable for tests).
 */
export function resolvePeriod(period: Period, now: Date = new Date()): PeriodRange {
  const days = PERIOD_DAYS[period];
  const end = now;
  const start = new Date(now.getTime() - days * DAY_MS);
  return { period, start, end, bucket: PERIOD_BUCKET[period] };
}

/**
 * Choose which period tier to actually query for the graph, given the
 * user's selected period and how far back real data goes (`dataAgeDays`,
 * the age in days of the earliest known record - `undefined` when unknown,
 * e.g. before the first fetch completes).
 *
 * A period whose window isn't filled by real history would mostly aggregate
 * into a single bucket (e.g. selecting `1y` with only 2 days of data would
 * collapse everything into one weekly dot), so this walks from the selected
 * period down toward the smallest tier (`7d`), stopping at the first
 * candidate whose window is met or exceeded by the data's age - or at `7d`
 * itself if none qualify. This only changes which data gets fetched/
 * rendered, not which period button appears selected in the UI.
 */
export function resolveEffectivePeriod(selected: Period, dataAgeDays: number | undefined): Period {
  if (dataAgeDays === undefined) {
    return selected;
  }
  for (let i = PERIODS.indexOf(selected); i >= 0; i--) {
    const candidate = PERIODS[i];
    if (i === 0 || dataAgeDays >= PERIOD_DAYS[candidate]) {
      return candidate;
    }
  }
  return PERIODS[0];
}

/**
 * How far back to look for the gauge/stats "current status" snapshot -
 * deliberately independent of whatever period the graph is currently
 * showing, and wide enough to cover realistic tracking histories.
 */
const STATS_LOOKBACK_DAYS = 5 * 365;

/**
 * Resolve the range used for the gauge/stats snapshot (current weight,
 * progress, etc). Always the same fixed, wide window of raw records
 * regardless of the graph's selected period, so switching graph periods
 * never changes the gauge/stats. Pure and deterministic given `now`
 * (injectable for tests).
 */
export function resolveStatsRange(now: Date = new Date()): PeriodRange {
  return {
    // `period` isn't read by DataSource.fetchPoints() (only start/end/bucket
    // are) - `1y` is just a placeholder satisfying the type.
    period: '1y',
    start: new Date(now.getTime() - STATS_LOOKBACK_DAYS * DAY_MS),
    end: now,
    bucket: 'raw',
  };
}
