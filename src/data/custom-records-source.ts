import type { DataSource } from './data-source';
import type { PeriodRange } from '../logic/period';
import type {
  HomeAssistantExt,
  MetricFilter,
  RecordType,
  RecordTypeField,
  WeightPoint,
} from '../types';

const SERVER_ROW_CAP = 500;

interface RawRecord {
  id: number;
  timestamp: string;
  [field: string]: unknown;
}

interface ListRecordsResponse {
  records?: RawRecord[];
}

interface ApexSeriesResponse {
  series: { name: string; data: { x: number; y: number }[] }[];
}

interface ListRecordTypesResponse {
  record_types?: RecordType[];
}

export interface CustomRecordsSourceOptions {
  recordType: string;
  valueField?: string;
  filter?: MetricFilter[];
}

/**
 * {@link DataSource} backed by the Custom Records integration WebSocket API.
 */
export class CustomRecordsDataSource implements DataSource {
  private recordTypeCache?: RecordType;

  constructor(
    private readonly hass: HomeAssistantExt,
    private readonly options: CustomRecordsSourceOptions,
  ) {}

  async fetchPoints(range: PeriodRange): Promise<WeightPoint[]> {
    const field = await this.resolveValueField();

    if (range.bucket === 'raw') {
      const response = await this.hass.connection.sendMessagePromise<ListRecordsResponse>({
        type: 'custom_records/list_records',
        record_type: this.options.recordType,
        start: range.start.toISOString(),
        end: range.end.toISOString(),
        limit: SERVER_ROW_CAP,
        filter: this.options.filter,
      });

      return (response?.records ?? [])
        .map((r) => ({ x: Date.parse(r.timestamp), y: Number(r[field]) }))
        .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
        .sort((a, b) => a.x - b.x);
    }

    const response = await this.hass.connection.sendMessagePromise<ApexSeriesResponse>({
      type: 'custom_records/aggregate_records',
      record_type: this.options.recordType,
      op: 'avg',
      bucket: range.bucket,
      field,
      start: range.start.toISOString(),
      end: range.end.toISOString(),
      filter: this.options.filter,
      format: 'apexcharts',
    });

    const data = response?.series?.[0]?.data ?? [];
    return data
      .map((d) => ({ x: Number(d.x), y: Number(d.y) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
      .sort((a, b) => a.x - b.x);
  }

  async addRecord(fields: Record<string, unknown>, timestamp?: Date): Promise<void> {
    await this.hass.connection.sendMessagePromise({
      type: 'custom_records/add_record',
      record_type: this.options.recordType,
      fields,
      ...(timestamp ? { timestamp: timestamp.toISOString() } : {}),
    });
  }

  async getRecordType(): Promise<RecordType | undefined> {
    if (this.recordTypeCache) {
      return this.recordTypeCache;
    }

    const response = await this.hass.connection.sendMessagePromise<
      ListRecordTypesResponse | RecordType[]
    >({
      type: 'custom_records/list_record_types',
    });

    const list = Array.isArray(response) ? response : (response?.record_types ?? []);
    this.recordTypeCache = list.find((rt) => rt.id === this.options.recordType);
    return this.recordTypeCache;
  }

  async subscribeUpdates(callback: () => void): Promise<() => void> {
    return this.hass.connection.subscribeEvents(() => callback(), 'custom_records_updated');
  }

  /**
   * Determine the numeric field to plot: the configured `value_field`, or the
   * first `number` field of the record type.
   */
  private async resolveValueField(): Promise<string> {
    if (this.options.valueField) {
      return this.options.valueField;
    }

    const recordType = await this.getRecordType();
    const numberField: RecordTypeField | undefined = recordType?.fields?.find(
      (f) => f.type === 'number',
    );

    if (!numberField) {
      throw new Error(
        'Could not determine a numeric field to plot. Set "value_field" in the card config.',
      );
    }

    return numberField.key;
  }
}
