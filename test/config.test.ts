import { describe, expect, it } from 'vitest';
import { ConfigError, normalizeConfig } from '../src/config';

describe('normalizeConfig', () => {
  const base = { type: 'custom:weight-tracker-cr-card', record_type: 'weight' };

  it('applies defaults', () => {
    const c = normalizeConfig(base);
    expect(c.data_source).toBe('custom_records');
    expect(c.unit).toBe('kg');
    expect(c.default_period).toBe('1m');
    expect(c.show_gauge).toBe(true);
    expect(c.show_stats).toBe(true);
    expect(c.show_graph).toBe(true);
    expect(c.show_add_record).toBe(true);
  });

  it('preserves explicit values', () => {
    const c = normalizeConfig({
      ...base,
      unit: 'lb',
      default_period: '1y',
      show_gauge: false,
      target: 80,
    });
    expect(c.unit).toBe('lb');
    expect(c.default_period).toBe('1y');
    expect(c.show_gauge).toBe(false);
    expect(c.target).toBe(80);
  });

  it('requires record_type', () => {
    expect(() => normalizeConfig({ type: 'x' })).toThrow(ConfigError);
  });

  it('rejects unsupported data sources', () => {
    expect(() => normalizeConfig({ ...base, data_source: 'entity' as never })).toThrow(ConfigError);
  });

  it('accepts the canonical data source explicitly', () => {
    expect(normalizeConfig({ ...base, data_source: 'custom_records' }).data_source).toBe(
      'custom_records',
    );
  });

  it('rejects the legacy data source rather than treating it as an alias', () => {
    expect(() =>
      normalizeConfig({ ...base, data_source: 'custom_metrics' as never }),
    ).toThrow('Unsupported data_source "custom_metrics". Only "custom_records" is supported');
  });

  it('rejects invalid default_period', () => {
    expect(() => normalizeConfig({ ...base, default_period: '2w' as never })).toThrow(ConfigError);
  });

  it('accepts a valid filter', () => {
    const c = normalizeConfig({ ...base, filter: [{ name: 'Max' }] });
    expect(c.filter).toEqual([{ name: 'Max' }]);
  });

  it('rejects a non-list filter', () => {
    expect(() => normalizeConfig({ ...base, filter: { name: 'Max' } as never })).toThrow(ConfigError);
  });

  it('rejects a filter containing a blank/null entry', () => {
    expect(() => normalizeConfig({ ...base, filter: [null] as never })).toThrow(ConfigError);
  });

  it('throws on missing config', () => {
    expect(() => normalizeConfig(undefined as never)).toThrow(ConfigError);
  });
});
