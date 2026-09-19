import { LitElement, css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { RecordTypeField } from '../types';

export interface AddRecordSubmitDetail {
  fields: Record<string, unknown>;
}

/**
 * Popup form for adding a new record. Renders an input per record-type field,
 * pre-filling values passed in `prefill` (e.g. the card's filter values), and
 * dispatches a `submit` event with the collected field values.
 */
@customElement('weight-tracker-cr-add-dialog')
export class WeightTrackerAddDialog extends LitElement {
  @property({ type: Boolean }) public open = false;
  @property({ attribute: false }) public fields: RecordTypeField[] = [];
  @property({ attribute: false }) public prefill: Record<string, unknown> = {};
  @property({ type: String }) public heading = 'Add record';

  @state() private values: Record<string, unknown> = {};

  static styles = css`
    .backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10;
    }
    .dialog {
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color, #212121);
      border-radius: var(--ha-card-border-radius, 12px);
      padding: 20px;
      width: min(90vw, 360px);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    }
    h2 {
      margin: 0 0 12px;
      font-size: 1.2rem;
    }
    .field {
      display: flex;
      flex-direction: column;
      margin-bottom: 12px;
    }
    label {
      font-size: 0.85rem;
      color: var(--secondary-text-color, #727272);
      margin-bottom: 4px;
    }
    input,
    select,
    textarea {
      font: inherit;
      padding: 8px;
      border: 1px solid var(--divider-color, #e0e0e0);
      border-radius: 6px;
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color, #212121);
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 8px;
    }
    button {
      font: inherit;
      cursor: pointer;
      border: none;
      border-radius: 6px;
      padding: 8px 16px;
    }
    .cancel {
      background: transparent;
      color: var(--primary-text-color, #212121);
    }
    .submit {
      background: var(--primary-color, #03a9f4);
      color: var(--text-primary-color, #fff);
    }
    .required {
      color: var(--error-color, #db4437);
    }
  `;

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has('open') && this.open) {
      // Reset the form to defaults + prefill each time it opens.
      const initial: Record<string, unknown> = {};
      for (const field of this.fields) {
        if (this.prefill[field.key] !== undefined) {
          initial[field.key] = this.prefill[field.key];
        } else if (field.default !== undefined) {
          initial[field.key] = field.default;
        }
      }
      this.values = initial;
    }
  }

  render() {
    if (!this.open) {
      return nothing;
    }

    return html`
      <div class="backdrop" @click=${this.onBackdrop}>
        <div class="dialog" @click=${(e: Event) => e.stopPropagation()}>
          <h2>${this.heading}</h2>
          <form @submit=${this.onSubmit}>
            ${this.fields.map((field) => this.renderField(field))}
            <div class="actions">
              <button type="button" class="cancel" @click=${this.close}>Cancel</button>
              <button type="submit" class="submit">Add</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  private renderField(field: RecordTypeField) {
    const label = html`${field.label ?? field.key}${field.required
      ? html`<span class="required"> *</span>`
      : nothing}`;
    const value = this.values[field.key];
    const set = (v: unknown) => {
      this.values = { ...this.values, [field.key]: v };
    };

    let control;
    switch (field.type) {
      case 'number':
        control = html`<input
          type="number"
          step="any"
          .value=${value ?? ''}
          @input=${(e: Event) => set((e.target as HTMLInputElement).value)}
        />`;
        break;
      case 'boolean':
        control = html`<input
          type="checkbox"
          .checked=${Boolean(value)}
          @change=${(e: Event) => set((e.target as HTMLInputElement).checked)}
        />`;
        break;
      case 'datetime':
        control = html`<input
          type="datetime-local"
          .value=${value ?? ''}
          @input=${(e: Event) => set((e.target as HTMLInputElement).value)}
        />`;
        break;
      case 'long_text':
        control = html`<textarea
          rows="3"
          .value=${value ?? ''}
          @input=${(e: Event) => set((e.target as HTMLTextAreaElement).value)}
        ></textarea>`;
        break;
      case 'single_select':
        control = html`<select
          @change=${(e: Event) => set((e.target as HTMLSelectElement).value)}
        >
          <option value="" ?selected=${!value}></option>
          ${(field.options ?? []).map(
            (opt) => html`<option value=${opt} ?selected=${value === opt}>${opt}</option>`,
          )}
        </select>`;
        break;
      default:
        control = html`<input
          type="text"
          .value=${value ?? ''}
          @input=${(e: Event) => set((e.target as HTMLInputElement).value)}
        />`;
    }

    return html`<div class="field"><label>${label}</label>${control}</div>`;
  }

  private onBackdrop = () => this.close();

  private close = () => {
    this.dispatchEvent(new CustomEvent('closed', { bubbles: true, composed: true }));
  };

  private onSubmit = (e: Event) => {
    e.preventDefault();
    const fields: Record<string, unknown> = {};
    for (const field of this.fields) {
      const raw = this.values[field.key];
      if (raw === undefined || raw === '') {
        continue;
      }
      fields[field.key] = field.type === 'number' ? Number(raw) : raw;
    }
    this.dispatchEvent(
      new CustomEvent<AddRecordSubmitDetail>('submit-record', {
        detail: { fields },
        bubbles: true,
        composed: true,
      }),
    );
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'weight-tracker-cr-add-dialog': WeightTrackerAddDialog;
  }
}
