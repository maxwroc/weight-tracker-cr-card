import { LitElement, css, html, svg, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { computeChartLayout, type ChartPadding } from '../logic/chart-geometry';
import type { WeightPoint } from '../types';

const VIEW_W = 400;
const VIEW_H = 200;
const PADDING: ChartPadding = { top: 12, right: 12, bottom: 22, left: 36 };

/**
 * Lightweight SVG line chart: a polyline through the measurements plus a dashed
 * horizontal target line. No external charting dependency.
 */
@customElement('weight-tracker-cr-chart')
export class WeightTrackerChart extends LitElement {
  @property({ attribute: false }) public points: WeightPoint[] = [];
  @property({ type: Number }) public target?: number;
  @property({ type: String }) public unit = 'kg';

  static styles = css`
    :host {
      display: block;
    }
    svg {
      width: 100%;
      height: auto;
      display: block;
    }
    .grid {
      stroke: var(--divider-color, #e0e0e0);
      stroke-width: 1;
      opacity: 0.5;
    }
    .axis-label {
      fill: var(--secondary-text-color, #727272);
      font-size: 10px;
    }
    .line {
      fill: none;
      stroke: var(--wtc-line, var(--primary-color, #03a9f4));
      stroke-width: 2.5;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    .point {
      fill: var(--wtc-point, var(--wtc-line, var(--primary-color, #03a9f4)));
    }
    .target {
      stroke: var(--wtc-target-line, var(--error-color, #db4437));
      stroke-width: 2;
      stroke-dasharray: 5 4;
    }
    .empty {
      fill: var(--secondary-text-color, #727272);
      font-size: 12px;
      text-anchor: middle;
    }
  `;

  render() {
    const layout = computeChartLayout({
      points: this.points,
      target: this.target,
      width: VIEW_W,
      height: VIEW_H,
      padding: PADDING,
    });

    if (!layout.hasData) {
      return html`<svg viewBox="0 0 ${VIEW_W} ${VIEW_H}">
        <text class="empty" x="${VIEW_W / 2}" y="${VIEW_H / 2}">No data for this period</text>
      </svg>`;
    }

    return html`
      <svg viewBox="0 0 ${VIEW_W} ${VIEW_H}" preserveAspectRatio="none">
        ${layout.yTicks.map(
          (tick) => svg`
            <line class="grid" x1="${PADDING.left}" y1="${tick.y}" x2="${VIEW_W - PADDING.right}" y2="${tick.y}" />
            <text class="axis-label" x="4" y="${tick.y + 3}">${tick.value.toFixed(0)}</text>
          `,
        )}
        ${layout.targetY !== undefined
          ? svg`<line class="target" x1="${PADDING.left}" y1="${layout.targetY}" x2="${VIEW_W - PADDING.right}" y2="${layout.targetY}" />`
          : nothing}
        <polyline class="line" points="${layout.polyline}" />
        ${layout.points.map((p) => svg`<circle class="point" cx="${p.x}" cy="${p.y}" r="2.5" />`)}
      </svg>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'weight-tracker-cr-chart': WeightTrackerChart;
  }
}
