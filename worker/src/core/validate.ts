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
