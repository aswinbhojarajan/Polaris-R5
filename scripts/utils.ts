import { parse } from 'csv-parse/sync';
import * as fs from 'fs';

/**
 * Read and parse a CSV file
 */
export function readCSV(filePath: string): any[] {
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  
  try {
    const records = parse(fileContent, {
      columns: true,
      skip_records_with_empty_values: false,
      relax_column_count: true,
      cast: false,
      trim: false,
      bom: true, // Handle BOM if present
    });
    return records;
  } catch (error: any) {
    console.error(`Failed to parse CSV file: ${filePath}`);
    console.error(`Error: ${error.message}`);
    throw error;
  }
}

/**
 * Parse timestamp from CSV format: "2025-10-17T12:01:02.695Z" or """2025-10-17T12:01:02.695Z"""
 */
export function parseTimestamp(csvTimestamp: string | null | undefined): Date | null {
  if (!csvTimestamp || csvTimestamp === '') return null;
  
  // Remove surrounding quotes (csv-parse returns values with quotes already stripped to single quotes)
  let cleaned = csvTimestamp.trim();
  
  // Remove single quotes at start/end if present
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(1, -1);
  }
  
  // Also handle triple quotes just in case
  cleaned = cleaned.replace(/^"""/, '').replace(/"""$/, '');
  
  try {
    const date = new Date(cleaned);
    if (isNaN(date.getTime())) {
      return null;
    }
    return date;
  } catch (error) {
    console.warn(`Failed to parse timestamp: ${csvTimestamp}`);
    return null;
  }
}

/**
 * Parse JSON field from CSV (handles escaped quotes)
 */
export function parseJSONField(csvJson: string | null | undefined): any | null {
  if (!csvJson || csvJson === '' || csvJson === '[]' || csvJson === '{}') {
    return null;
  }
  
  try {
    return JSON.parse(csvJson);
  } catch (error) {
    console.error('Failed to parse JSON:', csvJson?.substring(0, 100));
    throw error;
  }
}

/**
 * Parse boolean from CSV
 */
export function parseBoolean(csvBool: string | null | undefined, defaultValue = false): boolean {
  if (csvBool === null || csvBool === undefined || csvBool === '') {
    return defaultValue;
  }
  return csvBool === 'true' || csvBool === 't' || csvBool === '1';
}

/**
 * Parse numeric/decimal from CSV
 */
export function parseNumeric(csvNumber: string | null | undefined): string | null {
  if (!csvNumber || csvNumber === '') return null;
  return csvNumber;
}

/**
 * Parse integer from CSV
 */
export function parseInteger(csvInt: string | null | undefined): number | null {
  if (!csvInt || csvInt === '') return null;
  const num = parseInt(csvInt, 10);
  return isNaN(num) ? null : num;
}

/**
 * Batch an array into chunks
 */
export function batchArray<T>(array: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < array.length; i += batchSize) {
    batches.push(array.slice(i, i + batchSize));
  }
  return batches;
}
