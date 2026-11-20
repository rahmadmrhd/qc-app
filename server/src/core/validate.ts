import { BATCH_MAX, type IdBatchInput, type VersionedBatchInput } from '@shared/batch';
import { isValidEmail, normalizeEmail } from './email';
import { appError } from './errors';

export interface ObjectReader {
  str(key: string, options?: { required?: boolean; max?: number }): string;
  email(key: string): string;
  oneOf<T extends string>(key: string, allowed: readonly T[]): T;
  stringArray(key: string): string[];
  optionalId(key: string): string | undefined;
  raw(key: string): unknown;
  fail(key: string, message: string): void;
  /** Lempar VALIDATION berisi semua error field yang terkumpul. */
  done(): void;
}

export function readObject(input: unknown): ObjectReader {
  const isObject = Boolean(input) && typeof input === 'object' && !Array.isArray(input);
  const source: Record<string, unknown> = isObject ? (input as Record<string, unknown>) : {};
  const fields: Record<string, string> = {};
  if (!isObject) fields._ = 'Input harus berupa objek';

  const reader: ObjectReader = {
    str(key, options = {}) {
      const value = source[key];
      if (value !== undefined && value !== null && typeof value !== 'string') {
        fields[key] = 'Harus berupa teks';
        return '';
      }
      const text = typeof value === 'string' ? value.trim() : '';
      if (options.required && text === '') fields[key] = 'Wajib diisi';
      else if (options.max !== undefined && text.length > options.max) {
        fields[key] = `Maksimal ${options.max} karakter`;
      }
      return text;
    },
    email(key) {
      const text = normalizeEmail(reader.str(key, { required: true, max: 254 }));
      if (text !== '' && !fields[key] && !isValidEmail(text)) {
        fields[key] = 'Format email tidak valid';
      }
      return text;
    },
    oneOf<T extends string>(key: string, allowed: readonly T[]): T {
      const value = source[key];
      const match = allowed.find((item) => item === value);
      if (match !== undefined) return match;
      fields[key] = 'Nilai tidak valid';
      return allowed[0] as T;
    },
    stringArray(key) {
      const value = source[key];
      if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
        fields[key] = 'Harus berupa daftar teks';
        return [];
      }
      return [...new Set(value as string[])];
    },
    optionalId(key) {
      const value = source[key];
      if (value === undefined || value === null || value === '') return undefined;
      if (typeof value !== 'string') {
        fields[key] = 'ID tidak valid';
        return undefined;
      }
      return value;
    },
    raw(key) {
      return source[key];
    },
    fail(key, message) {
      fields[key] = message;
    },
    done() {
      if (Object.keys(fields).length > 0) {
        throw appError('VALIDATION', 'Input tidak valid', { ...fields });
      }
    },
  };
  return reader;
}

/** Nama dari plan; sama dengan `readObject`. */
export const createReader = readObject;

export function expectNull(input: unknown): null {
  if (input !== null && input !== undefined) {
    throw appError('VALIDATION', 'Method ini tidak menerima input');
  }
  return null;
}

function batchIds(raw: unknown, label: string): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw appError('VALIDATION', `${label} wajib berisi minimal 1 id`, { ids: 'Wajib diisi' });
  }
  if (raw.length > BATCH_MAX) {
    throw appError('VALIDATION', `Maksimal ${BATCH_MAX} data per permintaan`, {
      ids: `Maksimal ${BATCH_MAX}`,
    });
  }
  const seen = new Set<string>();
  for (const id of raw) {
    if (typeof id !== 'string' || id === '' || id.length > 100) {
      throw appError('VALIDATION', 'ID tidak valid', { ids: 'ID tidak valid' });
    }
    if (seen.has(id)) throw appError('VALIDATION', 'ID ganda', { ids: 'ID tidak boleh ganda' });
    seen.add(id);
  }
  return raw as string[];
}

/** Masukan batch id: 1..`BATCH_MAX` id unik, tiap id string tak kosong. Pelanggaran = `VALIDATION`. */
export function validateIdBatch(raw: unknown): IdBatchInput {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return { ids: batchIds(source.ids, 'Daftar id') };
}

/** Masukan batch berversi: 1..`BATCH_MAX` entri `{ id, updatedAt }` dengan id unik. */
export function validateVersionedBatch(raw: unknown): VersionedBatchInput {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const list = source.items;
  if (!Array.isArray(list)) {
    throw appError('VALIDATION', 'Daftar wajib berisi minimal 1 data', { items: 'Wajib diisi' });
  }
  const entries = list.map((entry) =>
    entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {},
  );
  const ids = batchIds(
    entries.map((entry) => entry.id),
    'Daftar',
  );
  return {
    items: entries.map((entry, index) => {
      if (typeof entry.updatedAt !== 'string' || entry.updatedAt === '') {
        throw appError('VALIDATION', 'updatedAt wajib diisi', { items: 'updatedAt wajib diisi' });
      }
      return { id: ids[index] as string, updatedAt: entry.updatedAt };
    }),
  };
}
