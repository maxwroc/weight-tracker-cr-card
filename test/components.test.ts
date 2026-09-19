// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import '../src/custom-elements/gauge';
import '../src/custom-elements/weight-chart';
import type { WeightTrackerGauge } from '../src/custom-elements/gauge';
import type { WeightTrackerChart } from '../src/custom-elements/weight-chart';

async function mount<T extends HTMLElement>(el: T): Promise<T> {
  document.body.appendChild(el);
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return el;
}

describe('gauge element', () => {
  it('renders an svg with a track and a progress arc', async () => {
    const el = document.createElement('weight-tracker-cr-gauge') as WeightTrackerGauge;
    el.value = 7.8;
    el.progress = 0.58;
    el.unit = 'kg';
    await mount(el);

    const svg = el.shadowRoot!.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(el.shadowRoot!.querySelector('path.track')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('path.progress')).not.toBeNull();
    expect(el.shadowRoot!.textContent).toContain('7.8');
  });

  it('omits the progress arc when there is no progress', async () => {
    const el = document.createElement('weight-tracker-cr-gauge') as WeightTrackerGauge;
    el.progress = 0;
    await mount(el);
    expect(el.shadowRoot!.querySelector('path.progress')).toBeNull();
  });

  it('shows REMAIN and a plain value before the goal is reached', async () => {
    const el = document.createElement('weight-tracker-cr-gauge') as WeightTrackerGauge;
    el.value = 7.8;
    el.progress = 0.58;
    await mount(el);
    expect(el.shadowRoot!.textContent).toContain('REMAIN');
    expect(el.shadowRoot!.textContent).not.toContain('-7.8');
  });

  it('shows GOAL MET and a minus-prefixed value once progress reaches 1', async () => {
    const el = document.createElement('weight-tracker-cr-gauge') as WeightTrackerGauge;
    el.value = 3;
    el.progress = 1;
    await mount(el);
    expect(el.shadowRoot!.textContent).toContain('GOAL MET');
    expect(el.shadowRoot!.textContent).toContain('-3');
  });

  it('lets an explicit label override the auto-derived one', async () => {
    const el = document.createElement('weight-tracker-cr-gauge') as WeightTrackerGauge;
    el.value = 3;
    el.progress = 1;
    el.label = 'CUSTOM';
    await mount(el);
    expect(el.shadowRoot!.textContent).toContain('CUSTOM');
    expect(el.shadowRoot!.textContent).not.toContain('GOAL MET');
  });
});

describe('chart element', () => {
  it('renders a polyline and a dashed target line', async () => {
    const el = document.createElement('weight-tracker-cr-chart') as WeightTrackerChart;
    el.points = [
      { x: 1, y: 100 },
      { x: 2, y: 95 },
      { x: 3, y: 92 },
    ];
    el.target = 86;
    await mount(el);

    expect(el.shadowRoot!.querySelector('polyline.line')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('line.target')).not.toBeNull();
    expect(el.shadowRoot!.querySelectorAll('circle.point')).toHaveLength(3);
  });

  it('shows an empty state when there are no points', async () => {
    const el = document.createElement('weight-tracker-cr-chart') as WeightTrackerChart;
    el.points = [];
    await mount(el);
    expect(el.shadowRoot!.textContent).toContain('No data');
  });
});
