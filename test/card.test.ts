// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import '../src/custom-elements/weight-tracker-cr-card';
import { WeightTrackerCard } from '../src/custom-elements/weight-tracker-cr-card';
import type { HomeAssistantExt } from '../src/types';

function mockHass(handler: (msg: any) => any): HomeAssistantExt {
  return {
    connection: {
      sendMessagePromise: vi.fn((msg: any) => Promise.resolve(handler(msg))),
      subscribeEvents: vi.fn(() => Promise.resolve(() => Promise.resolve())),
    },
  } as unknown as HomeAssistantExt;
}

const records = [
  { id: 1, timestamp: '2024-06-01T00:00:00Z', weight: 100 },
  { id: 2, timestamp: '2024-06-10T00:00:00Z', weight: 94 },
];

function makeCard(): WeightTrackerCard {
  return document.createElement('weight-tracker-cr-card') as WeightTrackerCard;
}

async function settle(el: WeightTrackerCard): Promise<void> {
  await new Promise((r) => setTimeout(r, 30));
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
}

describe('WeightTrackerCard', () => {
  it('registers the canonical card, editor and children without legacy aliases', async () => {
    const editor = await WeightTrackerCard.getConfigElement();
    expect(editor.localName).toBe('weight-tracker-cr-card-editor');
    expect(customElements.get('weight-tracker-cr-card')).toBe(WeightTrackerCard);
    for (const suffix of ['card', 'card-editor', 'gauge', 'chart', 'add-dialog']) {
      expect(customElements.get(`weight-tracker-cr-${suffix}`)).toBeDefined();
      expect(customElements.get(`weight-tracker-cm-${suffix}`)).toBeUndefined();
    }
  });

  it('reports a config error for a missing record_type', async () => {
    const el = makeCard();
    el.setConfig({ type: 'custom:weight-tracker-cr-card' });
    document.body.appendChild(el);
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector('.error')).not.toBeNull();
  });

  it('provides a stub config and a card size', () => {
    const el = makeCard();
    const stub = (
      el.constructor as unknown as { getStubConfig: () => Record<string, unknown> }
    ).getStubConfig();
    expect(stub.record_type).toBe('body_weight');
    expect(stub.type).toBe('custom:weight-tracker-cr-card');
    expect(stub.data_source).toBe('custom_records');
    el.setConfig({ type: 'custom:weight-tracker-cr-card', record_type: 'weight', target: 86 });
    expect(el.getCardSize()).toBeGreaterThan(1);
  });

  it('does not issue a redundant fetch on initial mount', async () => {
    const calls: any[] = [];
    const hass = mockHass((msg) => {
      calls.push(msg);
      if (msg.type === 'custom_records/list_record_types') {
        return { record_types: [{ id: 'weight', fields: [{ key: 'weight', label: 'Weight', type: 'number' }] }] };
      }
      if (msg.type === 'custom_records/list_records') return { records };
      return [];
    });
    const el = makeCard();
    el.setConfig({
      type: 'custom:weight-tracker-cr-card',
      record_type: 'weight',
      value_field: 'weight',
      target: 86,
      default_period: '7d',
    });
    // Config + hass are both set before the element is ever inserted into
    // the DOM (a common Home Assistant pattern) - connectedCallback()'s
    // first-ever invocation must not trigger a second, wasteful fetch on
    // top of the one setupDataSource() already made.
    el.hass = hass;
    document.body.appendChild(el);
    await settle(el);

    // One fetch for the graph (period-scoped) and one for the gauge/stats
    // (period-independent) - each exactly once, not redundantly doubled.
    expect(calls.filter((m) => m.type === 'custom_records/list_records')).toHaveLength(2);
  });

  it('fetches data and renders gauge, stats and chart', async () => {
    const hass = mockHass((msg) => {
      if (msg.type === 'custom_records/list_record_types') {
        return { record_types: [{ id: 'weight', fields: [{ key: 'weight', label: 'Weight', type: 'number' }] }] };
      }
      if (msg.type === 'custom_records/list_records') return { records };
      return [];
    });
    const el = makeCard();
    el.setConfig({
      type: 'custom:weight-tracker-cr-card',
      record_type: 'weight',
      value_field: 'weight',
      target: 86,
      default_period: '7d',
    });
    el.hass = hass;
    document.body.appendChild(el);
    await settle(el);

    expect(el.shadowRoot!.querySelector('weight-tracker-cr-gauge')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('weight-tracker-cr-chart')).not.toBeNull();
    // Current weight (latest record) shown in stats.
    expect(el.shadowRoot!.textContent).toContain('94');

    // Target not yet reached (100 -> 94, target 86) - gauge still says REMAIN.
    const gaugeEl = el.shadowRoot!.querySelector('weight-tracker-cr-gauge') as unknown as { shadowRoot: ShadowRoot };
    expect(gaugeEl.shadowRoot.textContent).toContain('REMAIN');
    expect(gaugeEl.shadowRoot.textContent).not.toContain('GOAL MET');
  });

  it('shows "GOAL MET" in the gauge once the target is reached', async () => {
    const reachedRecords = [
      { id: 1, timestamp: '2024-06-01T00:00:00Z', weight: 100 },
      { id: 2, timestamp: '2024-06-10T00:00:00Z', weight: 85 },
    ];
    const hass = mockHass((msg) => {
      if (msg.type === 'custom_records/list_record_types') {
        return { record_types: [{ id: 'weight', fields: [{ key: 'weight', label: 'Weight', type: 'number' }] }] };
      }
      if (msg.type === 'custom_records/list_records') return { records: reachedRecords };
      return [];
    });
    const el = makeCard();
    el.setConfig({
      type: 'custom:weight-tracker-cr-card',
      record_type: 'weight',
      value_field: 'weight',
      target: 86,
      default_period: '7d',
    });
    el.hass = hass;
    document.body.appendChild(el);
    await settle(el);

    const gaugeEl = el.shadowRoot!.querySelector('weight-tracker-cr-gauge') as unknown as { shadowRoot: ShadowRoot };
    expect(gaugeEl.shadowRoot.textContent).toContain('GOAL MET');
    // Past the goal (100 -> 85, target 86) - shown as a negative overshoot.
    expect(gaugeEl.shadowRoot.textContent).toContain('-1');
  });

  it('switches period and refetches with the right bucket', async () => {
    const calls: any[] = [];
    const hass = mockHass((msg) => {
      calls.push(msg);
      if (msg.type === 'custom_records/list_record_types') {
        return { record_types: [{ id: 'weight', fields: [{ key: 'weight', label: 'Weight', type: 'number' }] }] };
      }
      if (msg.type === 'custom_records/list_records') return { records };
      if (msg.type === 'custom_records/aggregate_records') {
        return { series: [{ name: 'w', data: [{ x: 1, y: 95 }] }] };
      }
      return [];
    });
    const el = makeCard();
    el.setConfig({
      type: 'custom:weight-tracker-cr-card',
      record_type: 'weight',
      value_field: 'weight',
      target: 86,
      default_period: '7d',
    });
    el.hass = hass;
    document.body.appendChild(el);
    await settle(el);

    const buttons = el.shadowRoot!.querySelectorAll('button.period');
    const oneYear = Array.from(buttons).find((b) => b.textContent?.trim() === '1Y') as HTMLElement;
    oneYear.click();
    await settle(el);

    expect(calls.some((m) => m.type === 'custom_records/aggregate_records')).toBe(true);
  });

  it('falls back to raw 7d data when selecting 1y with only 2 days of history', async () => {
    const calls: any[] = [];
    const now = Date.now();
    const recentRecords = [
      { id: 1, timestamp: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(), weight: 100 },
      { id: 2, timestamp: new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(), weight: 98 },
    ];
    const hass = mockHass((msg) => {
      calls.push(msg);
      if (msg.type === 'custom_records/list_record_types') {
        return { record_types: [{ id: 'weight', fields: [{ key: 'weight', label: 'Weight', type: 'number' }] }] };
      }
      if (msg.type === 'custom_records/list_records') return { records: recentRecords };
      if (msg.type === 'custom_records/aggregate_records') {
        // Should never be hit once the fallback kicks in.
        return { series: [{ name: 'w', data: [{ x: 1, y: 50 }] }] };
      }
      return [];
    });
    const el = makeCard();
    el.setConfig({
      type: 'custom:weight-tracker-cr-card',
      record_type: 'weight',
      value_field: 'weight',
      target: 86,
      default_period: '1y',
    });
    el.hass = hass;
    document.body.appendChild(el);
    await settle(el);

    // No aggregate_records call at all - the graph fell back to raw records
    // instead of collapsing 2 days of data into a single weekly bucket.
    expect(calls.some((m) => m.type === 'custom_records/aggregate_records')).toBe(false);
    expect(calls.some((m) => m.type === 'custom_records/list_records')).toBe(true);

    // The 1Y button still appears selected even though 7d data was fetched.
    const buttons = el.shadowRoot!.querySelectorAll('button.period');
    const oneYear = Array.from(buttons).find((b) => b.textContent?.trim() === '1Y') as HTMLElement;
    expect(oneYear.className).toContain('active');
  });

  it('does not change the gauge/stats when switching the graph period', async () => {
    const calls: any[] = [];
    const hass = mockHass((msg) => {
      calls.push(msg);
      if (msg.type === 'custom_records/list_record_types') {
        return { record_types: [{ id: 'weight', fields: [{ key: 'weight', label: 'Weight', type: 'number' }] }] };
      }
      if (msg.type === 'custom_records/list_records') return { records };
      if (msg.type === 'custom_records/aggregate_records') {
        // A very different figure than the raw records', so it's obvious if
        // switching periods leaks into the gauge/stats computation.
        return { series: [{ name: 'w', data: [{ x: 1, y: 50 }] }] };
      }
      return [];
    });
    const el = makeCard();
    el.setConfig({
      type: 'custom:weight-tracker-cr-card',
      record_type: 'weight',
      value_field: 'weight',
      target: 86,
      default_period: '7d',
    });
    el.hass = hass;
    document.body.appendChild(el);
    await settle(el);

    const statsText = () => el.shadowRoot!.querySelector('.stats')!.textContent;
    expect(statsText()).toContain('94');

    const buttons = el.shadowRoot!.querySelectorAll('button.period');
    const oneYear = Array.from(buttons).find((b) => b.textContent?.trim() === '1Y') as HTMLElement;
    oneYear.click();
    await settle(el);

    // The graph now shows the aggregated (50) series, but the gauge/stats
    // must still reflect the original, period-independent value.
    expect(statsText()).toContain('94');
    expect(statsText()).not.toContain('50');
  });

  it('refreshes the chart/stats after adding a record via the dialog', async () => {
    const state = { records: [...records] };
    const calls: any[] = [];
    const hass = mockHass((msg) => {
      calls.push(msg);
      if (msg.type === 'custom_records/list_record_types') {
        return { record_types: [{ id: 'weight', fields: [{ key: 'weight', label: 'Weight', type: 'number' }] }] };
      }
      if (msg.type === 'custom_records/list_records') return { records: state.records };
      if (msg.type === 'custom_records/add_record') {
        state.records = [
          ...state.records,
          { id: 3, timestamp: '2024-06-20T00:00:00Z', weight: 90 },
        ];
        return {};
      }
      return [];
    });
    const el = makeCard();
    el.setConfig({
      type: 'custom:weight-tracker-cr-card',
      record_type: 'weight',
      value_field: 'weight',
      target: 86,
      default_period: '7d',
    });
    el.hass = hass;
    document.body.appendChild(el);
    await settle(el);

    const addButton = el.shadowRoot!.querySelector('.add-btn') as HTMLElement;
    addButton.click();
    await settle(el);

    const dialogEl = el.shadowRoot!.querySelector('weight-tracker-cr-add-dialog') as unknown as {
      shadowRoot: ShadowRoot;
      updateComplete: Promise<unknown>;
      open: boolean;
    };
    await dialogEl.updateComplete;
    const listRecordsCallsBeforeSubmit = calls.filter((m) => m.type === 'custom_records/list_records').length;
    const submitBtn = dialogEl.shadowRoot.querySelector('button.submit') as HTMLElement;
    submitBtn.click();
    await settle(el);
    await settle(el);

    expect(calls.some((m) => m.type === 'custom_records/add_record')).toBe(true);
    // A fresh fetch must follow the add so the newly-added record is reflected.
    const listRecordsCallsAfterSubmit = calls.filter((m) => m.type === 'custom_records/list_records').length;
    expect(listRecordsCallsAfterSubmit).toBeGreaterThan(listRecordsCallsBeforeSubmit);
    expect(dialogEl.open).toBe(false);
    expect(el.shadowRoot!.textContent).toContain('90');
  });

  it('refreshes when a custom_records_updated event fires (e.g. added elsewhere)', async () => {
    const state = { records: [...records] };
    let subscribedCallback: ((event: unknown) => void) | undefined;
    const hass: HomeAssistantExt = {
      connection: {
        sendMessagePromise: vi.fn((msg: any) => {
          if (msg.type === 'custom_records/list_record_types') {
            return Promise.resolve({
              record_types: [{ id: 'weight', fields: [{ key: 'weight', label: 'Weight', type: 'number' }] }],
            });
          }
          if (msg.type === 'custom_records/list_records') {
            return Promise.resolve({ records: state.records });
          }
          return Promise.resolve([]);
        }),
        subscribeEvents: vi.fn((callback: (event: unknown) => void) => {
          subscribedCallback = callback;
          return Promise.resolve(() => Promise.resolve());
        }),
      },
    } as unknown as HomeAssistantExt;

    const el = makeCard();
    el.setConfig({
      type: 'custom:weight-tracker-cr-card',
      record_type: 'weight',
      value_field: 'weight',
      target: 86,
      default_period: '7d',
    });
    el.hass = hass;
    document.body.appendChild(el);
    await settle(el);

    expect(el.shadowRoot!.textContent).toContain('94');
    expect(subscribedCallback).toBeDefined();
    expect(hass.connection.subscribeEvents).toHaveBeenCalledExactlyOnceWith(
      expect.any(Function),
      'custom_records_updated',
    );

    // Simulate a record added from elsewhere (another tab, an automation, the
    // Custom Records integration's own card) while ours stays mounted.
    state.records = [...state.records, { id: 3, timestamp: '2024-06-20T00:00:00Z', weight: 90 }];
    vi.useFakeTimers();
    try {
      subscribedCallback!({});
      // scheduleRefresh() debounces via a 300ms setTimeout - advance fake
      // timers instead of a real-time sleep (faster, and avoids CI flakiness).
      await vi.advanceTimersByTimeAsync(300);
    } finally {
      vi.useRealTimers();
    }
    await el.updateComplete;

    expect(el.shadowRoot!.textContent).toContain('90');
  });

  it('re-subscribes to live updates after being detached and reattached', async () => {
    const state = { records: [...records] };
    let subscribeCount = 0;
    let subscribedCallback: ((event: unknown) => void) | undefined;
    const unsubscribe = vi.fn(() => Promise.resolve());
    const hass: HomeAssistantExt = {
      connection: {
        sendMessagePromise: vi.fn((msg: any) => {
          if (msg.type === 'custom_records/list_record_types') {
            return Promise.resolve({
              record_types: [{ id: 'weight', fields: [{ key: 'weight', label: 'Weight', type: 'number' }] }],
            });
          }
          if (msg.type === 'custom_records/list_records') {
            return Promise.resolve({ records: state.records });
          }
          return Promise.resolve([]);
        }),
        subscribeEvents: vi.fn((callback: (event: unknown) => void) => {
          subscribeCount += 1;
          subscribedCallback = callback;
          return Promise.resolve(unsubscribe);
        }),
      },
    } as unknown as HomeAssistantExt;

    const el = makeCard();
    el.setConfig({
      type: 'custom:weight-tracker-cr-card',
      record_type: 'weight',
      value_field: 'weight',
      target: 86,
      default_period: '7d',
    });
    el.hass = hass;
    document.body.appendChild(el);
    await settle(el);
    expect(subscribeCount).toBe(1);
    expect(hass.connection.subscribeEvents).toHaveBeenLastCalledWith(
      expect.any(Function),
      'custom_records_updated',
    );

    // Simulate a dashboard view switch: the element is removed from the DOM
    // then reattached without setConfig()/hass being called again.
    el.remove();
    expect(unsubscribe).toHaveBeenCalledOnce();
    document.body.appendChild(el);
    await settle(el);

    expect(subscribeCount).toBe(2);
    expect(hass.connection.subscribeEvents).toHaveBeenLastCalledWith(
      expect.any(Function),
      'custom_records_updated',
    );

    // The re-established subscription must actually work.
    state.records = [...state.records, { id: 3, timestamp: '2024-06-20T00:00:00Z', weight: 90 }];
    vi.useFakeTimers();
    try {
      subscribedCallback!({});
      // scheduleRefresh() debounces via a 300ms setTimeout - advance fake
      // timers instead of a real-time sleep (faster, and avoids CI flakiness).
      await vi.advanceTimersByTimeAsync(300);
    } finally {
      vi.useRealTimers();
    }
    await el.updateComplete;

    expect(el.shadowRoot!.textContent).toContain('90');
  });

  it('clears a pending refresh debounce timer on disconnect', async () => {
    const calls: any[] = [];
    let subscribedCallback: ((event: unknown) => void) | undefined;
    const hass: HomeAssistantExt = {
      connection: {
        sendMessagePromise: vi.fn((msg: any) => {
          calls.push(msg);
          if (msg.type === 'custom_records/list_record_types') {
            return Promise.resolve({
              record_types: [{ id: 'weight', fields: [{ key: 'weight', label: 'Weight', type: 'number' }] }],
            });
          }
          if (msg.type === 'custom_records/list_records') {
            return Promise.resolve({ records });
          }
          return Promise.resolve([]);
        }),
        subscribeEvents: vi.fn((callback: (event: unknown) => void) => {
          subscribedCallback = callback;
          return Promise.resolve(() => Promise.resolve());
        }),
      },
    } as unknown as HomeAssistantExt;

    const el = makeCard();
    el.setConfig({
      type: 'custom:weight-tracker-cr-card',
      record_type: 'weight',
      value_field: 'weight',
      target: 86,
      default_period: '7d',
    });
    el.hass = hass;
    document.body.appendChild(el);
    await settle(el);

    const listRecordsCallsBeforeEvent = calls.filter((m) => m.type === 'custom_records/list_records').length;

    vi.useFakeTimers();
    try {
      // Fire the live-update event (schedules a 300ms debounced refetch), then
      // detach before it fires - disconnectedCallback must cancel the pending
      // timer instead of letting it fetch on a now-invisible card.
      subscribedCallback!({});
      el.remove();
      await vi.advanceTimersByTimeAsync(300);
    } finally {
      vi.useRealTimers();
    }

    const listRecordsCallsAfter = calls.filter((m) => m.type === 'custom_records/list_records').length;
    expect(listRecordsCallsAfter).toBe(listRecordsCallsBeforeEvent);
  });
});
