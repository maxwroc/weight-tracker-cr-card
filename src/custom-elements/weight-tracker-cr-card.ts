import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { CARD_EDITOR_NAME, CARD_NAME, CARD_VERSION } from '../const';
import { ConfigError, normalizeConfig } from '../config';
import { createDataSource, type DataSource } from '../data';
import { resolvePeriod, resolveEffectivePeriod, resolveStatsRange, DAY_MS } from '../logic/period';
import { computeStats, type WeightStats } from '../logic/stats';
import { PERIODS } from '../types';
import type {
  HomeAssistantExt,
  Period,
  RecordTypeField,
  ResolvedConfig,
  WeightPoint,
  WeightTrackerCardConfig,
} from '../types';
import './gauge';
import './weight-chart';
import './add-record-dialog';
import type { AddRecordSubmitDetail } from './add-record-dialog';

const PERIOD_LABELS: Record<Period, string> = {
  '7d': '7D',
  '1m': '1M',
  '6m': '6M',
  '1y': '1Y',
};

const COLOR_VARS: Record<keyof NonNullable<ResolvedConfig['colors']>, string> = {
  gauge_progress: '--wtc-gauge-progress',
  gauge_track: '--wtc-gauge-track',
  line: '--wtc-line',
  point: '--wtc-point',
  target_line: '--wtc-target-line',
};

@customElement(CARD_NAME)
export class WeightTrackerCard extends LitElement {
  @state() private config?: ResolvedConfig;
  @state() private points: WeightPoint[] = [];
  @state() private stats: WeightStats = {};
  @state() private period: Period = '1m';
  @state() private errorMessage?: string;
  @state() private dialogOpen = false;
  @state() private recordFields: RecordTypeField[] = [];

  private _hass?: HomeAssistantExt;
  private dataSource?: DataSource;
  private unsubscribe?: () => void;
  private subscribingFor?: DataSource;
  private hasBeenConnected = false;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  /** Epoch ms of the earliest known record, from the last stats fetch. */
  private earliestRecordMs?: number;

  public static async getConfigElement() {
    await import('./weight-tracker-card-editor');
    return document.createElement(CARD_EDITOR_NAME);
  }

  public static getStubConfig(): WeightTrackerCardConfig {
    return {
      type: `custom:${CARD_NAME}`,
      data_source: 'custom_records',
      record_type: 'body_weight',
      target: 80,
      unit: 'kg',
    };
  }

  public setConfig(config: WeightTrackerCardConfig): void {
    try {
      this.config = normalizeConfig(config);
      this.errorMessage = undefined;
      this.period = this.config.default_period;
      // Force a fresh data source next time hass is available.
      this.dataSource = undefined;
      this.recordFields = [];
      if (this._hass) {
        this.setupDataSource();
      }
    } catch (e) {
      if (e instanceof ConfigError) {
        this.errorMessage = e.message;
      } else {
        throw e;
      }
    }
  }

  public set hass(hass: HomeAssistantExt) {
    const firstRun = !this._hass;
    this._hass = hass;
    if (this.config && (firstRun || !this.dataSource)) {
      this.setupDataSource();
    }
  }

  public get hass(): HomeAssistantExt | undefined {
    return this._hass;
  }

  public getCardSize(): number {
    let size = 1;
    if (this.config?.show_gauge) size += 3;
    if (this.config?.show_graph) size += 3;
    return size;
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this.refreshTimer);
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  public connectedCallback(): void {
    super.connectedCallback();
    if (!this.hasBeenConnected) {
      // Initial mount: setConfig()/the hass setter (which may run before or
      // after this first connect, depending on how the host renders cards)
      // already trigger setupDataSource()'s own subscribe + fetch - doing it
      // again here would just be a redundant, wasteful round-trip.
      this.hasBeenConnected = true;
      return;
    }
    // Reattached after disconnectedCallback tore things down (e.g. a
    // dashboard view switch, or a masonry/sections layout reflow) - without
    // this, a reattached card would silently stop reacting to
    // custom_records_updated events for the rest of its life. Also catch up
    // on anything that may have changed while detached.
    this.subscribeToUpdates();
    void this.fetchData();
  }

  private setupDataSource(): void {
    if (!this._hass || !this.config) {
      return;
    }
    try {
      this.dataSource = createDataSource(this._hass, this.config);
    } catch (e) {
      this.errorMessage = e instanceof Error ? e.message : String(e);
      return;
    }

    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.subscribeToUpdates();

    void this.loadRecordFields();
    void this.fetchData();
  }

  private subscribeToUpdates(): void {
    if (!this.dataSource || this.unsubscribe || this.subscribingFor === this.dataSource) {
      return;
    }
    const dataSource = this.dataSource;
    this.subscribingFor = dataSource;
    // Wrapped in Promise.resolve().then() so a DataSource implementation
    // whose subscribeUpdates() throws synchronously (the DataSource
    // interface doesn't guarantee it's an async function) still lands in
    // the .catch()/.finally() below, instead of throwing out of this method
    // and leaving the guard stuck forever (permanently blocking all future
    // re-subscription attempts).
    Promise.resolve()
      .then(() => dataSource.subscribeUpdates(() => this.scheduleRefresh()))
      .then((unsub) => {
        if (!this.isConnected || this.dataSource !== dataSource) {
          // Disconnected, or setConfig() has since replaced dataSource with
          // a newer one while this attempt was still in flight - cancel it
          // immediately instead of leaking a live subscription (or
          // stomping this.unsubscribe with one tied to a stale source).
          // unsub() isn't guaranteed to be synchronous, and its returned
          // promise (if any) isn't observed anywhere else, so call it
          // through its own promise chain and swallow any rejection -
          // otherwise a failing cancellation could surface as an unhandled
          // rejection instead of staying best-effort.
          void Promise.resolve()
            .then(() => unsub())
            .catch(() => {
              /* cancellation is best-effort */
            });
          return;
        }
        this.unsubscribe = unsub;
      })
      .catch(() => {
        /* subscription is best-effort */
      })
      .finally(() => {
        // Only clear the marker if it's still ours - an interleaved newer
        // attempt (for a dataSource created after this one started) must
        // not have its own in-flight marker wiped out by this older one
        // finishing later.
        if (this.subscribingFor === dataSource) {
          this.subscribingFor = undefined;
        }
      });
  }

  private scheduleRefresh(): void {
    // Debounce bursts of `custom_records_updated` events.
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.fetchData(), 300);
  }

  private async loadRecordFields(): Promise<void> {
    if (!this.dataSource) return;
    try {
      const recordType = await this.dataSource.getRecordType();
      this.recordFields = recordType?.fields ?? [];
    } catch {
      this.recordFields = [];
    }
  }

  private async fetchGraphPoints(): Promise<void> {
    if (!this.dataSource || !this.config) {
      return;
    }
    try {
      const dataAgeDays =
        this.earliestRecordMs !== undefined ? (Date.now() - this.earliestRecordMs) / DAY_MS : undefined;
      const effectivePeriod = resolveEffectivePeriod(this.period, dataAgeDays);
      const range = resolvePeriod(effectivePeriod);
      this.points = await this.dataSource.fetchPoints(range);
      this.errorMessage = undefined;
    } catch (e) {
      this.errorMessage = e instanceof Error ? e.message : String(e);
    }
  }

  private async fetchStats(): Promise<void> {
    if (!this.dataSource || !this.config) {
      return;
    }
    try {
      // Deliberately independent of `this.period` - the gauge/stats reflect
      // overall current progress, not whatever range the graph happens to
      // be showing.
      const points = await this.dataSource.fetchPoints(resolveStatsRange());
      this.earliestRecordMs = points.length ? Math.min(...points.map((p) => p.x)) : undefined;
      this.stats = computeStats({
        points,
        target: this.config.target,
        startWeight: this.config.start_weight,
      });
      this.errorMessage = undefined;
    } catch (e) {
      this.errorMessage = e instanceof Error ? e.message : String(e);
    }
  }

  private async fetchData(): Promise<void> {
    // Sequential (not Promise.all) so fetchGraphPoints() sees a fresh
    // earliestRecordMs from fetchStats() when deciding whether to fall back
    // to a smaller period tier, instead of racing against a stale value.
    await this.fetchStats();
    await this.fetchGraphPoints();
  }

  private onPeriodClick(period: Period): void {
    if (period === this.period) return;
    this.period = period;
    // Only the graph depends on the selected period - gauge/stats are left
    // untouched.
    void this.fetchGraphPoints();
  }

  private async onSubmitRecord(e: CustomEvent<AddRecordSubmitDetail>): Promise<void> {
    if (!this.dataSource) return;
    try {
      await this.dataSource.addRecord(e.detail.fields);
      this.dialogOpen = false;
      await this.fetchData();
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
    }
  }

  private hostStyle(): string {
    const colors = this.config?.colors;
    if (!colors) return '';
    return Object.entries(colors)
      .filter(([, v]) => v)
      .map(([k, v]) => `${COLOR_VARS[k as keyof typeof COLOR_VARS]}:${v}`)
      .join(';');
  }

  render(): TemplateResult {
    if (this.errorMessage) {
      return html`<ha-card>
        <div class="error">
          <ha-icon icon="mdi:alert-circle-outline"></ha-icon>
          <span>${this.errorMessage}</span>
        </div>
      </ha-card>`;
    }

    if (!this.config) {
      return html`<ha-card></ha-card>`;
    }

    const c = this.config;
    const prefill: Record<string, unknown> = {};
    for (const cond of c.filter ?? []) {
      // Defensive: normalizeConfig() already rejects malformed filter
      // entries, but don't let a null/blank one (e.g. a stray "-" in the
      // YAML list) crash the whole card's render.
      if (!cond) continue;
      for (const [k, v] of Object.entries(cond)) {
        prefill[k] = v;
      }
    }

    return html`
      <ha-card style=${this.hostStyle()}>
        <div class="header">
          <span class="title">${c.title ?? ''}</span>
          ${c.show_add_record
            ? html`<button
                class="add-btn"
                title="Add record"
                @click=${() => (this.dialogOpen = true)}
              >
                +
              </button>`
            : nothing}
        </div>

        <div class="content">
          ${c.show_gauge ? this.renderGauge() : nothing}
          ${c.show_stats ? this.renderStats() : nothing}
          ${c.show_graph ? this.renderGraph() : nothing}
        </div>

        <weight-tracker-cr-add-dialog
          .open=${this.dialogOpen}
          .fields=${this.recordFields}
          .prefill=${prefill}
          .heading=${'Add ' + (c.title ?? 'record')}
          @closed=${() => (this.dialogOpen = false)}
          @submit-record=${this.onSubmitRecord}
        ></weight-tracker-cr-add-dialog>
      </ha-card>
    `;
  }

  private renderGauge(): TemplateResult {
    // The gauge itself derives the "achieved" label/sign from .progress.
    return html`<div class="gauge-wrap">
      <weight-tracker-cr-gauge
        .value=${this.stats.remaining}
        .progress=${this.stats.progress ?? 0}
        .unit=${this.config?.unit ?? 'kg'}
      ></weight-tracker-cr-gauge>
    </div>`;
  }

  private renderStats(): TemplateResult {
    const unit = this.config?.unit ?? 'kg';
    const fmt = (v?: number) =>
      v === undefined ? '—' : `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`;
    return html`<div class="stats">
      <div class="stat"><span>Starting Weight</span><b>${fmt(this.stats.start)}</b></div>
      <div class="stat"><span>Current Weight</span><b>${fmt(this.stats.current)}</b></div>
      <div class="stat"><span>Weight Goal</span><b>${fmt(this.stats.target)}</b></div>
    </div>`;
  }

  private renderGraph(): TemplateResult {
    return html`<div class="graph">
      <div class="periods">
        ${PERIODS.map(
          (p) => html`<button
            class=${p === this.period ? 'period active' : 'period'}
            @click=${() => this.onPeriodClick(p)}
          >
            ${PERIOD_LABELS[p]}
          </button>`,
        )}
      </div>
      <weight-tracker-cr-chart
        .points=${this.points}
        .target=${this.config?.target}
        .unit=${this.config?.unit ?? 'kg'}
      ></weight-tracker-cr-chart>
    </div>`;
  }

  static styles = css`
    ha-card {
      padding: 16px;
      position: relative;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 24px;
    }
    .title {
      font-size: 1.4rem;
      font-weight: 500;
    }
    .add-btn {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      font-size: 1.4rem;
      line-height: 1;
      color: var(--text-primary-color, #fff);
      background: var(--wtc-line, var(--primary-color, #03a9f4));
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
    }
    .content {
      display: flex;
      flex-direction: column;
      gap: 16px;
      margin-top: 8px;
    }
    .gauge-wrap {
      display: flex;
      justify-content: center;
    }
    .stats {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .stat {
      display: flex;
      justify-content: space-between;
      font-size: 1rem;
      border-bottom: 1px solid var(--divider-color, #e0e0e0);
      padding-bottom: 4px;
    }
    .stat span {
      color: var(--secondary-text-color, #727272);
    }
    .periods {
      display: flex;
      justify-content: space-around;
      margin-bottom: 8px;
    }
    .period {
      background: transparent;
      border: none;
      cursor: pointer;
      font: inherit;
      font-weight: 600;
      color: var(--secondary-text-color, #727272);
      padding: 6px 12px;
      border-radius: 6px;
    }
    .period.active {
      color: var(--primary-text-color, #212121);
      background: var(--secondary-background-color, #f0f0f0);
    }
    .error {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--error-color, #db4437);
      padding: 8px 0;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    [CARD_NAME]: WeightTrackerCard;
  }
}

interface CustomCardsWindow {
  customCards?: { type: string; name: string; preview?: boolean; description?: string }[];
}
const w = window as unknown as CustomCardsWindow;
w.customCards = w.customCards || [];
w.customCards.push({
  type: CARD_NAME,
  name: 'Weight Tracker (Custom Records)',
  preview: true,
  description: 'Track weight progress toward a target using the Custom Records integration',
});

console.info(
  `%c ${CARD_NAME} %c ${CARD_VERSION} `,
  'color:#fff;background:#03a9f4;font-weight:700;',
  'color:#03a9f4;background:#fff;font-weight:700;',
);
