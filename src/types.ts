import type { HomeAssistant, LovelaceCardConfig, LovelaceCardEditor } from 'custom-card-helpers';

/**
 * Which backend supplies the data. Only `custom_records` is implemented today;
 * the enum leaves room for a future `entity` (regular HA entity + recorder
 * history) source without a breaking config change.
 */
export type DataSourceKind = 'custom_records';

/** Time ranges offered by the period selector. */
export type Period = '7d' | '1m' | '6m' | '1y';

export const PERIODS: Period[] = ['7d', '1m', '6m', '1y'];

/** A single Custom Records filter condition, e.g. `{ name: 'Max' }`. */
export type MetricFilter = Record<string, string | number | boolean>;

/** Optional colour overrides. Any omitted value falls back to a theme colour. */
export interface ColorConfig {
  gauge_progress?: string;
  gauge_track?: string;
  line?: string;
  point?: string;
  target_line?: string;
}

export interface WeightTrackerCardConfig extends LovelaceCardConfig {
  type: string;
  title?: string;
  data_source?: DataSourceKind;
  /** Custom Records record type key (required for the custom_records source). */
  record_type?: string;
  /** Numeric field key holding the weight value. Defaults to the first number field. */
  value_field?: string;
  /** Server-side Custom Records filter conditions. */
  filter?: MetricFilter[];
  /** Target/goal weight. */
  target?: number;
  /** Explicit starting weight; when omitted the earliest record is used. */
  start_weight?: number;
  /** Display unit, e.g. `kg` or `lb`. */
  unit?: string;
  default_period?: Period;
  show_gauge?: boolean;
  show_stats?: boolean;
  show_graph?: boolean;
  show_add_record?: boolean;
  colors?: ColorConfig;
}

/** A normalized config with defaults resolved (see {@link normalizeConfig}). */
export interface ResolvedConfig extends WeightTrackerCardConfig {
  data_source: DataSourceKind;
  unit: string;
  default_period: Period;
  show_gauge: boolean;
  show_stats: boolean;
  show_graph: boolean;
  show_add_record: boolean;
}

/** A single logged measurement, backend-agnostic. */
export interface WeightPoint {
  /** Epoch milliseconds. */
  x: number;
  /** Weight value. */
  y: number;
}

/** Field definition as returned by Custom Records `list_record_types`. */
export interface RecordTypeField {
  key: string;
  label?: string;
  type: string;
  required?: boolean;
  options?: string[];
  default?: unknown;
}

export interface RecordType {
  id: string;
  name?: string;
  fields: RecordTypeField[];
}

/**
 * Home Assistant object alias. Aliased so we have a single spot to extend if a
 * future data source needs extra frontend surface. The Custom Records source
 * uses the standard `hass.connection` WebSocket API.
 */
export type HomeAssistantExt = HomeAssistant;

export type { HomeAssistant, LovelaceCardEditor };
