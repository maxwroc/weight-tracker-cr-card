import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { CARD_EDITOR_NAME } from '../const';
import { CustomRecordsDataSource } from '../data/custom-records-source';
import type { HomeAssistant, LovelaceCardEditor, WeightTrackerCardConfig } from '../types';

/** Schema fed to HA's `ha-form`. */
const SCHEMA = [
  { name: 'title', selector: { text: {} } },
  { name: 'record_type', required: true, selector: { text: {} } },
  { name: 'value_field', selector: { text: {} } },
  {
    name: '',
    type: 'grid',
    schema: [
      { name: 'target', selector: { number: { mode: 'box', step: 0.1 } } },
      { name: 'start_weight', selector: { number: { mode: 'box', step: 0.1 } } },
      { name: 'unit', selector: { text: {} } },
      {
        name: 'default_period',
        selector: {
          select: {
            mode: 'dropdown',
            options: [
              { value: '7d', label: '7 days' },
              { value: '1m', label: '1 month' },
              { value: '6m', label: '6 months' },
              { value: '1y', label: '1 year' },
            ],
          },
        },
      },
    ],
  },
  {
    name: '',
    type: 'grid',
    schema: [
      { name: 'show_gauge', selector: { boolean: {} } },
      { name: 'show_stats', selector: { boolean: {} } },
      { name: 'show_graph', selector: { boolean: {} } },
      { name: 'show_add_record', selector: { boolean: {} } },
    ],
  },
] as const;

const LABELS: Record<string, string> = {
  title: 'Title',
  record_type: 'Record type (required)',
  value_field: 'Value field (optional)',
  target: 'Target weight',
  start_weight: 'Starting weight (optional)',
  unit: 'Unit',
  default_period: 'Default period',
  show_gauge: 'Show gauge',
  show_stats: 'Show stats',
  show_graph: 'Show graph',
  show_add_record: 'Show add button',
};

@customElement(CARD_EDITOR_NAME)
export class WeightTrackerCardEditor extends LitElement implements LovelaceCardEditor {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private config: WeightTrackerCardConfig = { type: '' };
  @state() private autoValueField?: string;

  private queriedRecordType?: string;

  public setConfig(config: WeightTrackerCardConfig): void {
    this.config = config;
  }

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has('hass') || changed.has('config')) {
      this.maybeLoadAutoValueField();
    }
  }

  /**
   * Look up the record type's first `number` field so the (optional)
   * `value_field` selector can show what it will resolve to at runtime,
   * mirroring the actual default used by {@link CustomRecordsDataSource}.
   */
  private maybeLoadAutoValueField(): void {
    const recordType = this.config.record_type;
    if (!this.hass || !recordType || recordType === this.queriedRecordType) {
      return;
    }
    this.queriedRecordType = recordType;
    const requestedRecordType = recordType;
    const source = new CustomRecordsDataSource(this.hass, { recordType });
    source
      .getRecordType()
      .then((rt) => {
        if (this.queriedRecordType !== requestedRecordType) return;
        this.autoValueField = rt?.fields.find((f) => f.type === 'number')?.key;
      })
      .catch(() => {
        if (this.queriedRecordType !== requestedRecordType) return;
        this.autoValueField = undefined;
      });
  }

  private computeLabel = (schema: { name: string }) => LABELS[schema.name] ?? schema.name;

  // Merge in resolved defaults purely for display, so boolean toggles (and
  // the auto-detected value field) show their true effective value for a
  // config that omits them, without writing those defaults back into the
  // config until the user actually changes something.
  private get displayData(): WeightTrackerCardConfig {
    return {
      ...this.config,
      unit: this.config.unit ?? 'kg',
      default_period: this.config.default_period ?? '1m',
      value_field: this.config.value_field ?? this.autoValueField,
      show_gauge: this.config.show_gauge ?? true,
      show_stats: this.config.show_stats ?? true,
      show_graph: this.config.show_graph ?? true,
      show_add_record: this.config.show_add_record ?? true,
    };
  }

  private onValueChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const config = ev.detail.value as WeightTrackerCardConfig;
    this.dispatchEvent(
      new CustomEvent('config-changed', {
        detail: { config },
        bubbles: true,
        composed: true,
      }),
    );
  };

  render(): TemplateResult {
    if (!this.hass) {
      return html``;
    }

    return html`
      <ha-form
        .hass=${this.hass}
        .data=${this.displayData}
        .schema=${SCHEMA}
        .computeLabel=${this.computeLabel}
        @value-changed=${this.onValueChanged}
      ></ha-form>
      <p class="hint">
        This card currently reads from the <b>Custom Records</b> integration. Filters and colour
        overrides can be set in YAML.
      </p>
    `;
  }

  static styles = css`
    .hint {
      color: var(--secondary-text-color, #727272);
      font-size: 0.85rem;
      margin: 12px 4px 0;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    [CARD_EDITOR_NAME]: WeightTrackerCardEditor;
  }
}
