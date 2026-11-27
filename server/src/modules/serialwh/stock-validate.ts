import { readFilterList, readObject } from '@server/core/validate';
import type { ListReadyStockInput } from '@shared/contract';
import { SERIAL_LIMITS } from '@shared/serials';

/** Halaman Stok Ready: kardus per halaman (bawaan 20, maks. 50) dan batas `pickCount` (sama dengan baris draf). */
export const READY_STOCK_LIMITS = { listDefault: 20, listMax: 50 } as const;

export function validateListReadyStock(raw: unknown): ListReadyStockInput {
  const reader = readObject(raw ?? {});
  const query = reader.str('query', { max: 100 });
  const buIds = readFilterList(reader, 'buIds');
  const itemIds = readFilterList(reader, 'itemIds');
  const cursor = reader.str('cursor', { max: 200 });
  const limit = readBoundedInt(reader, 'limit', READY_STOCK_LIMITS.listMax, 'Batas halaman');
  const pickCount = readBoundedInt(reader, 'pickCount', SERIAL_LIMITS.tableRows, 'Jumlah pilihan');
  reader.done();
  return {
    ...(query !== '' ? { query } : {}),
    ...(buIds ? { buIds } : {}),
    ...(itemIds ? { itemIds } : {}),
    ...(cursor !== '' ? { cursor } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(pickCount !== undefined ? { pickCount } : {}),
  };
}

function readBoundedInt(
  reader: ReturnType<typeof readObject>,
  key: string,
  max: number,
  label: string,
): number | undefined {
  const value = reader.raw(key);
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    reader.fail(key, `${label} harus 1-${max}`);
    return undefined;
  }
  return value;
}
