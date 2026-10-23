import { appError_ } from '@gas/core/errors';
import { readObject_ } from '@gas/core/validate';
import { customerKey, HANDOVER_LIMITS, hasHandoverControlChars } from '@shared/handover';
import { extractChecklist } from '@shared/handover-checklist';
import type {
  AddCommentInput,
  GetHandoverInput,
  HandoverRefInput,
  ListHandoversInput,
  SaveHandoverBatchInput,
  SaveHandoverInput,
  SetCheckInput,
  SetDoneInput,
} from '@shared/rpc';

const MAX_LOCATION_IDS = 50;
const HANDOVER_CONTROL_CHARS_MESSAGE = 'Tidak boleh memuat karakter kontrol';

/** Galat batas catatan (kosong, panjang, jumlah butir, karakter kontrol) atau null bila sah. Untuk save dan batch. */
export function handoverNoteError_(note: string): string | null {
  if (note.trim() === '') return 'Catatan wajib diisi';
  if (note.length > HANDOVER_LIMITS.note) {
    return `Catatan maksimal ${HANDOVER_LIMITS.note} karakter`;
  }
  if (hasHandoverControlChars(note)) return HANDOVER_CONTROL_CHARS_MESSAGE;
  const items = extractChecklist(note).length;
  if (items > HANDOVER_LIMITS.checklistItems) {
    return `Catatan memuat ${items} butir checklist; maksimal ${HANDOVER_LIMITS.checklistItems} butir`;
  }
  return null;
}

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

const HANDOVER_BASE_STATUSES = ['new', 'in_progress', 'done', 'cancelled'] as const;

/** `base` opsional: undefined bila tidak ada, 'invalid' bila bentuknya salah. */
function readSaveBase_(value: unknown): SaveHandoverInput['base'] | 'invalid' | undefined {
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

export function validateSaveHandover_(raw: unknown): SaveHandoverInput {
  const reader = readObject_(raw);
  const id = reader.optionalId('id')?.trim() || undefined;
  const expectedUpdatedAt = reader.optionalId('expectedUpdatedAt');
  const locationId = reader.str('locationId', { required: true, max: 100 });
  const note = reader.str('note', { required: true, max: HANDOVER_LIMITS.note });
  const noteError = handoverNoteError_(note);
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
  const base = readSaveBase_(reader.raw('base'));
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

/** Satu task batch: mengembalikan nilai bersih atau pesan galat pertama. */
function readBatchTask_(
  entry: unknown,
): { customerName: string; note: string; error: null } | { error: string } {
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
  if (customerName.length > HANDOVER_LIMITS.customerName) {
    return { error: `Nama customer maksimal ${HANDOVER_LIMITS.customerName} karakter` };
  }
  if (customerName !== '' && customerKey(customerName) === '') {
    return { error: 'Nama customer harus memuat huruf atau angka' };
  }
  if (hasHandoverControlChars(customerName)) return { error: HANDOVER_CONTROL_CHARS_MESSAGE };
  const noteError = handoverNoteError_(note);
  if (noteError !== null) return { error: noteError };
  return { customerName, note, error: null };
}

export function validateSaveHandoverBatch_(raw: unknown): SaveHandoverBatchInput {
  const reader = readObject_(raw);
  const locationId = reader.str('locationId', { required: true, max: 100 });
  const value = reader.raw('tasks');
  const tasks: SaveHandoverBatchInput['tasks'] = [];
  if (!Array.isArray(value)) {
    reader.fail('tasks', 'Harus berupa daftar task');
  } else if (value.length === 0) {
    reader.fail('tasks', 'Minimal satu task');
  } else if (value.length > HANDOVER_LIMITS.batch) {
    reader.fail('tasks', `Maksimal ${HANDOVER_LIMITS.batch} task`);
  } else {
    for (let i = 0; i < value.length; i++) {
      const task = readBatchTask_(value[i]);
      if (task.error !== null && task.error !== undefined) {
        reader.fail('tasks', `Task ${i + 1}: ${task.error}`);
        break;
      }
      if ('customerName' in task) tasks.push({ customerName: task.customerName, note: task.note });
    }
  }
  reader.done();
  return { locationId, tasks };
}

export function validateHandoverRef_(raw: unknown): HandoverRefInput {
  const reader = readObject_(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const locationId = reader.str('locationId', { required: true, max: 100 });
  reader.done();
  return { id, locationId };
}

export function validateSetCheck_(raw: unknown): SetCheckInput {
  const reader = readObject_(raw);
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
export function validateSetDone_(raw: unknown): SetDoneInput {
  const reader = readObject_(raw);
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
function readContext_(reader: ReturnType<typeof readObject_>, key: string): string {
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

export function validateAddComment_(raw: unknown): AddCommentInput {
  const reader = readObject_(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const locationId = reader.str('locationId', { required: true, max: 100 });
  // Komentar umum (tanpa seleksi) memakai kutipan kosong.
  const quote = reader.str('quote', { max: COMMENT_QUOTE_MAX });
  if (hasHandoverControlChars(quote)) reader.fail('quote', HANDOVER_CONTROL_CHARS_MESSAGE);
  const before = readContext_(reader, 'before');
  const after = readContext_(reader, 'after');
  const body = reader.str('body', { required: true, max: HANDOVER_LIMITS.comment });
  if (hasHandoverControlChars(body)) reader.fail('body', HANDOVER_CONTROL_CHARS_MESSAGE);
  reader.done();
  return { id, locationId, quote, before, after, body };
}
