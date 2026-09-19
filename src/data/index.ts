import type { DataSource } from './data-source';
import { CustomRecordsDataSource } from './custom-records-source';
import type { HomeAssistantExt, ResolvedConfig } from '../types';

/**
 * Build the appropriate {@link DataSource} for a config. Currently only the
 * Custom Records backend exists; the switch is the single place to extend when
 * an entity/history source is added.
 */
export function createDataSource(hass: HomeAssistantExt, config: ResolvedConfig): DataSource {
  switch (config.data_source) {
    case 'custom_records':
      return new CustomRecordsDataSource(hass, {
        recordType: config.record_type as string,
        valueField: config.value_field,
        filter: config.filter,
      });
    default:
      throw new Error(`Unsupported data_source: ${config.data_source}`);
  }
}

export type { DataSource } from './data-source';
export { CustomRecordsDataSource } from './custom-records-source';
