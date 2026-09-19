import { describe, expect, it, vi } from 'vitest';
import { CustomRecordsDataSource } from '../src/data/custom-records-source';
import type { HomeAssistantExt } from '../src/types';
import { resolvePeriod } from '../src/logic/period';

function mockHass(handler: (msg: any) => any): HomeAssistantExt {
  return {
    connection: {
      sendMessagePromise: vi.fn((msg: any) => Promise.resolve(handler(msg))),
      subscribeEvents: vi.fn(() => Promise.resolve(() => Promise.resolve())),
    },
  } as unknown as HomeAssistantExt;
}

describe('CustomRecordsDataSource', () => {
  it('subscribes to the canonical update event and returns its unsubscribe function', async () => {
    const unsubscribe = vi.fn();
    const subscribeEvents = vi.fn(async (_callback: () => void, _eventType: string) => unsubscribe);
    const hass = mockHass(() => ({}));
    Object.assign(hass.connection, { subscribeEvents });
    const source = new CustomRecordsDataSource(hass, { recordType: 'weight' });
    const callback = vi.fn();

    const stop = await source.subscribeUpdates(callback);

    expect(subscribeEvents).toHaveBeenCalledExactlyOnceWith(
      expect.any(Function),
      'custom_records_updated',
    );
    subscribeEvents.mock.calls[0][0]();
    expect(callback).toHaveBeenCalledOnce();
    expect(stop).toBe(unsubscribe);
    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('fetches raw records for the 7d view and maps timestamp/value', async () => {
    const hass = mockHass((msg) => {
      expect(msg.type).toBe('custom_records/list_records');
      expect(msg.record_type).toBe('weight');
      expect(msg.limit).toBe(500);
      return {
        records: [
          { id: 2, timestamp: '2024-06-10T00:00:00Z', weight: 93.8 },
          { id: 1, timestamp: '2024-06-01T00:00:00Z', weight: 99 },
        ],
      };
    });
    const source = new CustomRecordsDataSource(hass, { recordType: 'weight', valueField: 'weight' });

    const points = await source.fetchPoints(resolvePeriod('7d', new Date('2024-06-15T00:00:00Z')));

    expect(points).toHaveLength(2);
    // Sorted ascending by time.
    expect(points[0].y).toBe(99);
    expect(points[1].y).toBe(93.8);
    expect(points[0].x).toBeLessThan(points[1].x);
  });

  it('uses aggregate_records with apexcharts format for bucketed views', async () => {
    const hass = mockHass((msg) => {
      expect(msg.type).toBe('custom_records/aggregate_records');
      expect(msg.op).toBe('avg');
      expect(msg.bucket).toBe('week');
      expect(msg.format).toBe('apexcharts');
      return { series: [{ name: 'weight', data: [{ x: 1000, y: 95 }, { x: 2000, y: 94 }] }] };
    });
    const source = new CustomRecordsDataSource(hass, { recordType: 'weight', valueField: 'weight' });

    const points = await source.fetchPoints(resolvePeriod('1y', new Date('2024-06-15T00:00:00Z')));

    expect(points).toEqual([
      { x: 1000, y: 95 },
      { x: 2000, y: 94 },
    ]);
  });

  it('resolves the value field from the record type when not configured', async () => {
    const sent: any[] = [];
    const hass = mockHass((msg) => {
      sent.push(msg);
      if (msg.type === 'custom_records/list_record_types') {
        return {
          record_types: [
            {
              id: 'weight',
              name: 'Weight',
              fields: [
                { key: 'name', label: 'Name', type: 'text' },
                { key: 'kg', label: 'Kilograms', type: 'number' },
              ],
            },
          ],
        };
      }
      return { records: [] };
    });
    const source = new CustomRecordsDataSource(hass, { recordType: 'weight' });

    await source.fetchPoints(resolvePeriod('7d'));

    // It should have asked for the record types to discover the numeric field...
    expect(sent.some((m) => m.type === 'custom_records/list_record_types')).toBe(true);
    // ...then fetched records for the resolved field without throwing.
    expect(sent.some((m) => m.type === 'custom_records/list_records')).toBe(true);
  });

  it('sends add_record with fields and an ISO timestamp', async () => {
    let captured: any;
    const hass = mockHass((msg) => {
      captured = msg;
      return {};
    });
    const source = new CustomRecordsDataSource(hass, { recordType: 'weight' });
    const ts = new Date('2024-06-15T08:30:00Z');

    await source.addRecord({ weight: 90 }, ts);

    expect(captured.type).toBe('custom_records/add_record');
    expect(captured.record_type).toBe('weight');
    expect(captured.fields).toEqual({ weight: 90 });
    expect(captured.timestamp).toBe(ts.toISOString());
  });

  it('throws a helpful error when no numeric field can be found', async () => {
    const hass = mockHass((msg) => {
      if (msg.type === 'custom_records/list_record_types') {
        return { record_types: [{ id: 'weight', fields: [{ key: 'note', label: 'Note', type: 'text' }] }] };
      }
      return { records: [] };
    });
    const source = new CustomRecordsDataSource(hass, { recordType: 'weight' });

    await expect(source.fetchPoints(resolvePeriod('7d'))).rejects.toThrow(/value_field/);
  });
});
