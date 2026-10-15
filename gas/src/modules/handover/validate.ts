import { appError_ } from '@gas/core/errors';
import { readObject_ } from '@gas/core/validate';
import { customerKey, HANDOVER_LIMITS } from '@shared/handover';
import type {
  CompleteLineInput,
  GetHandoverInput,
  HandoverRefInput,
  ListHandoversInput,
  SaveHandoverInput,
  SaveHandoverLineInput,
  SetProgressInput,
} from '@shared/rpc';

const MAX_LOCATION_IDS = 50;

/** `locationIds` (≥ 1, ≤ 50, teks tak kosong) — router sudah memeriksa izinnya; di sini bentuknya. */
export function validateLocationIds_(raw: unknown): string[] {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const value = source.locationIds;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_LOCATION_IDS ||
    !value.every((id) => typeof id === 'string' && id.trim() !== '')
  ) {
    throw appError_('VALIDATION', 'Lokasi wajib diisi', { locationIds: 'Lokasi wajib diisi' });
  }
  return [...new Set((value as string[]).map((id) => id.trim()))];
}

export function validateListHandovers_(raw: unknown): ListHandoversInput {
  return { locationIds: validateLocationIds_(raw) };
}

export function validateGetHandover_(raw: unknown): GetHandoverInput {
  const reader = readObject_(raw);
  const id = reader.str('id', { required: true, max: 100 });
  reader.done();
  return { id, locationIds: validateLocationIds_(raw) };
}

function readHandoverLines_(value: unknown): {
  lines: SaveHandoverLineInput[];
  error: string | null;
} {
  if (!Array.isArray(value)) return { lines: [], error: 'Harus berupa daftar baris' };
  if (value.length === 0) return { lines: [], error: 'Minimal satu baris' };
  if (value.length > HANDOVER_LIMITS.lines) {
    return { lines: [], error: `Maksimal ${HANDOVER_LIMITS.lines} baris` };
  }
  const lines: SaveHandoverLineInput[] = [];
  const firstRow = new Map<string, number>();
  for (let i = 0; i < value.length; i++) {
    const entry = value[i];
    const source =
      typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};
    const itemId = typeof source.itemId === 'string' ? source.itemId.trim() : '';
    const qty = source.qty;
    if (itemId === '' || itemId.length > 100)
      return { lines: [], error: `Baris ${i + 1}: tipe wajib dipilih` };
    if (
      typeof qty !== 'number' ||
      !Number.isInteger(qty) ||
      qty < 1 ||
      qty > HANDOVER_LIMITS.qtyMax
    ) {
      return {
        lines: [],
        error: `Baris ${i + 1}: qty harus bilangan bulat 1–${HANDOVER_LIMITS.qtyMax}`,
      };
    }
    const seen = firstRow.get(itemId);
    if (seen !== undefined) {
      return { lines: [], error: `Baris ${i + 1}: tipe yang sama sudah ada di baris ${seen}` };
    }
    firstRow.set(itemId, i + 1);
    lines.push({ itemId, qty });
  }
  return { lines, error: null };
}

export function validateSaveHandover_(raw: unknown): SaveHandoverInput {
  const reader = readObject_(raw);
  const id = reader.optionalId('id')?.trim() || undefined;
  const locationId = reader.str('locationId', { required: true, max: 100 });
  const note = reader.str('note', { max: HANDOVER_LIMITS.note });
  // Customer opsional: kosong = task tanpa customer.
  const customerName = reader.str('customerName', { max: HANDOVER_LIMITS.customerName });
  if (customerName !== '' && customerKey(customerName) === '') {
    reader.fail('customerName', 'Nama customer harus memuat huruf atau angka');
  }
  const { lines, error } = readHandoverLines_(reader.raw('lines'));
  if (error) reader.fail('lines', error);
  reader.done();
  const input = { locationId, customerName, note, lines };
  return id ? { id, ...input } : input;
}

export function validateHandoverRef_(raw: unknown): HandoverRefInput {
  const reader = readObject_(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const locationId = reader.str('locationId', { required: true, max: 100 });
  reader.done();
  return { id, locationId };
}

export function validateSetProgress_(raw: unknown): SetProgressInput {
  const reader = readObject_(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const locationId = reader.str('locationId', { required: true, max: 100 });
  const lineId = reader.str('lineId', { required: true, max: 100 });
  const doneQty = reader.raw('doneQty');
  if (
    typeof doneQty !== 'number' ||
    !Number.isInteger(doneQty) ||
    doneQty < 0 ||
    doneQty > HANDOVER_LIMITS.qtyMax
  ) {
    reader.fail('doneQty', `Harus bilangan bulat 0–${HANDOVER_LIMITS.qtyMax}`);
  }
  reader.done();
  return { id, locationId, lineId, doneQty: doneQty as number };
}

export function validateCompleteLine_(raw: unknown): CompleteLineInput {
  const reader = readObject_(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const locationId = reader.str('locationId', { required: true, max: 100 });
  const lineId = reader.str('lineId', { required: true, max: 100 });
  reader.done();
  return { id, locationId, lineId };
}
