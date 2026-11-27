import { appError } from '@server/core/errors';
import { readFilterList, readObject } from '@server/core/validate';
import type {
  AddCommentInput,
  BoardPageInput,
  GetHandoverInput,
  HandoverRefInput,
  ListHandoversInput,
  SaveHandoverBatchInput,
  SaveHandoverInput,
  SetCheckInput,
  SetDoneInput,
} from '@shared/contract';
import type { HandoverStatus } from '@shared/handover';
import {
  customerKey,
  customerNameProblem,
  HANDOVER_BATCH_MAX,
  HANDOVER_LIMITS,
  hasHandoverControlChars,
  isHandoverClientId,
} from '@shared/handover';
import { checklistOf } from './checklist';

const MAX_LOCATION_IDS = 50;
const HANDOVER_CONTROL_CHARS_MESSAGE = 'Tidak boleh memuat karakter kontrol';

/** Galat batas catatan (kosong, panjang, jumlah butir, karakter kontrol) atau null bila sah. Untuk save dan batch. */
export function handoverNoteError(note: string): string | null {
  if (note.trim() === '') return 'Catatan wajib diisi';
  if (note.length > HANDOVER_LIMITS.note) {
    return `Catatan maksimal ${HANDOVER_LIMITS.note} karakter`;
  }
  if (hasHandoverControlChars(note)) return HANDOVER_CONTROL_CHARS_MESSAGE;
  const items = checklistOf(note).length;
  if (items > HANDOVER_LIMITS.checklistItems) {
    return `Catatan memuat ${items} butir checklist; maksimal ${HANDOVER_LIMITS.checklistItems} butir`;
  }
  return null;
}

/** `locationIds` (≥ 1, ≤ 50, teks tak kosong) — router sudah memeriksa izinnya; di sini bentuknya. */
export function validateLocationIds(raw: unknown): string[] {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const value = source.locationIds;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_LOCATION_IDS ||
    !value.every((id) => typeof id === 'string' && id.trim() !== '')
  ) {
    throw appError('VALIDATION', 'Lokasi wajib diisi', { locationIds: 'Lokasi wajib diisi' });
  }
  return [...new Set((value as string[]).map((id) => id.trim()))];
}

export function validateListHandovers(raw: unknown): ListHandoversInput {
  return { locationIds: validateLocationIds(raw) };
}

export function validateGetHandover(raw: unknown): GetHandoverInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: 100 });
  reader.done();
  return { id, locationIds: validateLocationIds(raw) };
}

const HANDOVER_BASE_STATUSES = ['new', 'in_progress', 'done', 'cancelled'] as const;

/** `base` opsional: undefined bila tidak ada, 'invalid' bila bentuknya salah. */
function readSaveBase(value: unknown): SaveHandoverInput['base'] | 'invalid' | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) return 'invalid';
  const source = value as Record<string, unknown>;
  const status = HANDOVER_BASE_STATUSES.find((item) => item === source.status);
  if (
    typeof source.note !== 'string' ||
    source.note.length > HANDOVER_LIMITS.note ||
    typeof source.customerId !== 'string' ||
    source.customerId.length > 100 ||
    status === undefined
  ) {
    return 'invalid';
  }
  return { note: source.note, customerId: source.customerId, status };
}

export function validateSaveHandover(raw: unknown): SaveHandoverInput {
  const reader = readObject(raw);
  const id = reader.optionalId('id')?.trim() || undefined;
  const expectedUpdatedAt = reader.optionalId('expectedUpdatedAt');
  const locationId = reader.str('locationId', { required: true, max: 100 });
  const note = reader.str('note', { required: true, max: HANDOVER_LIMITS.note });
  const noteError = handoverNoteError(note);
  if (noteError !== null && note !== '' && note.length <= HANDOVER_LIMITS.note) {
    reader.fail('note', noteError);
  }
  // Customer opsional: kosong = task tanpa customer.
  const customerName = reader.str('customerName', { max: HANDOVER_LIMITS.customerName });
  if (customerName !== '' && customerKey(customerName) === '') {
    reader.fail('customerName', 'Nama customer harus memuat huruf atau angka');
  }
  if (hasHandoverControlChars(customerName))
    reader.fail('customerName', HANDOVER_CONTROL_CHARS_MESSAGE);
  const base = readSaveBase(reader.raw('base'));
  if (base === 'invalid') reader.fail('base', 'Keadaan dasar form tidak valid');
  reader.done();
  const input = { locationId, customerName, note };
  return id
    ? {
        id,
        ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
        ...(base && base !== 'invalid' ? { base } : {}),
        ...input,
      }
    : input;
}

const CLIENT_ID_MESSAGE = 'clientId tidak valid';

/**
 * `clientId` opsional: tidak ada/null/'' = undefined (perilaku lama); ada tetapi bukan UUID huruf kecil 36 karakter =
 * 'invalid' (tidak dipangkas atau dinormalkan, agar kunci idempoten tidak ambigu).
 */
function readClientId(value: unknown): string | undefined | 'invalid' {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !isHandoverClientId(value)) return 'invalid';
  return value;
}

/** Satu task batch: mengembalikan nilai bersih atau pesan galat pertama. */
function readBatchTask(
  entry: unknown,
): { customerName: string; note: string; clientId?: string; error: null } | { error: string } {
  const source =
    typeof entry === 'object' && entry !== null && !Array.isArray(entry)
      ? (entry as Record<string, unknown>)
      : null;
  if (!source) return { error: 'Harus berupa objek' };
  const customerRaw = source.customerName ?? '';
  const noteRaw = source.note ?? '';
  if (typeof customerRaw !== 'string') return { error: 'Nama customer harus berupa teks' };
  if (typeof noteRaw !== 'string') return { error: 'Catatan harus berupa teks' };
  const customerName = customerRaw.trim();
  const note = noteRaw.trim();
  const customerProblem = customerNameProblem(customerName);
  if (customerProblem !== null) return { error: customerProblem };
  const noteError = handoverNoteError(note);
  if (noteError !== null) return { error: noteError };
  const clientId = readClientId(source.clientId);
  if (clientId === 'invalid') return { error: CLIENT_ID_MESSAGE };
  return { customerName, note, ...(clientId ? { clientId } : {}), error: null };
}

export function validateSaveHandoverBatch(raw: unknown): SaveHandoverBatchInput {
  const reader = readObject(raw);
  const locationId = reader.str('locationId', { required: true, max: 100 });
  const value = reader.raw('tasks');
  const tasks: SaveHandoverBatchInput['tasks'] = [];
  if (!Array.isArray(value)) {
    reader.fail('tasks', 'Harus berupa daftar task');
  } else if (value.length === 0) {
    reader.fail('tasks', 'Minimal satu task');
  } else if (value.length > HANDOVER_BATCH_MAX) {
    reader.fail('tasks', `Maksimal ${HANDOVER_BATCH_MAX} task per permintaan`);
  } else {
    const seenClientIds = new Set<string>();
    for (let i = 0; i < value.length; i++) {
      const task = readBatchTask(value[i]);
      if (task.error !== null && task.error !== undefined) {
        reader.fail('tasks', `Task ${i + 1}: ${task.error}`);
        break;
      }
      if (!('customerName' in task)) continue;
      if (task.clientId !== undefined) {
        if (seenClientIds.has(task.clientId)) {
          reader.fail('tasks', `Task ${i + 1}: clientId ganda dalam satu permintaan`);
          break;
        }
        seenClientIds.add(task.clientId);
      }
      tasks.push({
        customerName: task.customerName,
        note: task.note,
        ...(task.clientId ? { clientId: task.clientId } : {}),
      });
    }
  }
  reader.done();
  return { locationId, tasks };
}

export function validateHandoverRef(raw: unknown): HandoverRefInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const locationId = reader.str('locationId', { required: true, max: 100 });
  reader.done();
  return { id, locationId };
}

export function validateSetCheck(raw: unknown): SetCheckInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const locationId = reader.str('locationId', { required: true, max: 100 });
  const index = reader.raw('index');
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 10_000) {
    reader.fail('index', 'Nomor butir tidak valid');
  }
  const text = reader.str('text', { max: HANDOVER_LIMITS.note });
  const checked = reader.raw('checked');
  if (typeof checked !== 'boolean') reader.fail('checked', 'Harus berupa ya/tidak');
  reader.done();
  return { id, locationId, index: index as number, text, checked: checked as boolean };
}

/** Hanya menyelesaikan; membuka kembali task Selesai tidak ada, jadi field `done` apa pun ditolak. */
export function validateSetDone(raw: unknown): SetDoneInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const locationId = reader.str('locationId', { required: true, max: 100 });
  const done = reader.raw('done');
  if (done === false) {
    reader.fail('done', 'Task yang sudah selesai tidak dapat dibuka kembali');
  } else if (done !== undefined) {
    reader.fail('done', 'Field done tidak lagi didukung; setDone selalu menyelesaikan task');
  }
  reader.done();
  return { id, locationId };
}

const COMMENT_QUOTE_MAX = 500;
const COMMENT_CONTEXT_MAX = 40;

/** Konteks jangkar tidak dipangkas (spasi tepi berarti) dan boleh kosong. */
function readContext(reader: ReturnType<typeof readObject>, key: string): string {
  const value = reader.raw(key);
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    reader.fail(key, 'Harus berupa teks');
    return '';
  }
  if (value.length > COMMENT_CONTEXT_MAX) {
    reader.fail(key, `Maksimal ${COMMENT_CONTEXT_MAX} karakter`);
  }
  if (hasHandoverControlChars(value)) reader.fail(key, HANDOVER_CONTROL_CHARS_MESSAGE);
  return value;
}

export function validateAddComment(raw: unknown): AddCommentInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const locationId = reader.str('locationId', { required: true, max: 100 });
  // Komentar umum (tanpa seleksi) memakai kutipan kosong.
  const quote = reader.str('quote', { max: COMMENT_QUOTE_MAX });
  if (hasHandoverControlChars(quote)) reader.fail('quote', HANDOVER_CONTROL_CHARS_MESSAGE);
  const before = readContext(reader, 'before');
  const after = readContext(reader, 'after');
  const body = reader.str('body', { required: true, max: HANDOVER_LIMITS.comment });
  if (hasHandoverControlChars(body)) reader.fail('body', HANDOVER_CONTROL_CHARS_MESSAGE);
  const clientId = readClientId(reader.raw('clientId'));
  if (clientId === 'invalid') reader.fail('clientId', CLIENT_ID_MESSAGE);
  reader.done();
  return {
    id,
    locationId,
    quote,
    before,
    after,
    body,
    ...(clientId && clientId !== 'invalid' ? { clientId } : {}),
  };
}

/**
 * Ukuran halaman board: bawaan 20, maksimum 50 task. Keputusan pemilik 2026-11-05:
 * batas 3 peninggalan platform sebelumnya dibuang karena tak berlaku di VPS. Klien memuat halaman
 * berikutnya otomatis (infinite scroll) lewat kursor. Di atas batas ditolak VALIDATION (pola kontrak board).
 */
export const BOARD_DEFAULT_LIMIT = 20;
export const BOARD_MAX_LIMIT = 50;
const BOARD_STATUSES = ['new', 'in_progress', 'done', 'cancelled'] as const;

/**
 * Kursor board: `<updatedAt>|<number>`; untuk kolom Dikerjakan `<progres 0-1000>|<updatedAt>|<number>`.
 * Bentuk dipastikan di sini; makna diperiksa service.
 */
export function parseBoardCursor(
  status: HandoverStatus,
  cursor: string,
): { progress: number | null; updatedAt: string; number: string } | null {
  const parts = cursor.split('|');
  if (status === 'in_progress') {
    const [progress, updatedAt, number] = parts;
    const p = Number(progress);
    if (parts.length !== 3 || !Number.isInteger(p) || p < 0 || !updatedAt || !number) return null;
    return { progress: p, updatedAt, number };
  }
  const [updatedAt, number] = parts;
  if (parts.length !== 2 || !updatedAt || !number) return null;
  return { progress: null, updatedAt, number };
}

/** `handovers.board`: satu kolom kanban per panggilan, berkursor. */
export function validateBoardPage(raw: unknown): BoardPageInput {
  const locationIds = validateLocationIds(raw);
  const reader = readObject(raw);
  const status = reader.oneOf('status', BOARD_STATUSES);
  const customerId = reader.optionalId('customerId')?.trim() || undefined;
  const customerIds = readFilterList(reader, 'customerIds');
  const deleted = reader.raw('deleted');
  if (deleted !== undefined && deleted !== null && typeof deleted !== 'boolean') {
    reader.fail('deleted', 'Harus berupa true atau false');
  }
  const cursor = reader.raw('cursor');
  if (cursor !== undefined && cursor !== null) {
    if (typeof cursor !== 'string' || parseBoardCursor(status, cursor) === null) {
      reader.fail('cursor', 'Kursor tidak valid');
    }
  }
  const limit = reader.raw('limit') ?? BOARD_DEFAULT_LIMIT;
  if (
    typeof limit !== 'number' ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > BOARD_MAX_LIMIT
  ) {
    reader.fail('limit', `Batas halaman harus 1-${BOARD_MAX_LIMIT}`);
  }
  reader.done();
  return {
    locationIds,
    status,
    limit: limit as number,
    ...(typeof cursor === 'string' ? { cursor } : {}),
    ...(customerId ? { customerId } : {}),
    ...(customerIds ? { customerIds } : {}),
    ...(deleted === true ? { deleted: true } : {}),
  };
}
