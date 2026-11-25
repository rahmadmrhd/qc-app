import { MAIL_LIST_FIELDS, type MailListField, type MailLists } from '@shared/mail-lists';
import { normalizeEmail } from './email';

export interface ReadMailListsOptions {
  /** Batas alamat per daftar (To, CC, BCC masing-masing). */
  max: number;
  isValid: (email: string) => boolean;
  /** Melaporkan galat pada satu kolom (`reader.fail`); pembaca berhenti pada galat pertama tiap daftar. */
  fail: (field: MailListField, message: string) => void;
}

const FIELD_NAMES: Record<MailListField, string> = {
  recipients: 'Penerima',
  cc: 'CC',
  bcc: 'BCC',
};

/**
 * Membaca dan menormalkan ketiga daftar penerima dari badan permintaan. `recipients` (To) wajib berupa daftar seperti
 * semula; `cc` dan `bcc` boleh tidak dikirim (klien lama) = kosong. Tiap alamat: huruf kecil, sah menurut `isValid`,
 * tak ganda di dalam satu daftar, dan tak muncul di dua daftar sekaligus (satu orang tak perlu menerima dua salinan).
 */
export function readMailLists(
  source: Record<string, unknown>,
  options: ReadMailListsOptions,
): MailLists {
  const lists: MailLists = { recipients: [], cc: [], bcc: [] };
  const seenAll = new Set<string>();
  for (const field of MAIL_LIST_FIELDS) {
    const raw = source[field];
    if (raw === undefined && field !== 'recipients') continue;
    if (!Array.isArray(raw)) {
      options.fail(field, `${FIELD_NAMES[field]} harus berupa daftar email`);
      continue;
    }
    if (raw.length > options.max) {
      options.fail(field, `Maksimal ${options.max} alamat pada ${FIELD_NAMES[field]}`);
      continue;
    }
    const seen = new Set<string>();
    for (const item of raw) {
      const email = typeof item === 'string' ? normalizeEmail(item) : '';
      if (!options.isValid(email)) {
        options.fail(field, 'Ada alamat email yang tidak valid');
        break;
      }
      if (seen.has(email)) {
        options.fail(field, `Email ganda: ${email}`);
        break;
      }
      if (seenAll.has(email)) {
        options.fail(field, `Email sudah ada di daftar lain: ${email}`);
        break;
      }
      seen.add(email);
      lists[field].push(email);
    }
    for (const email of seen) seenAll.add(email);
  }
  return lists;
}

/** Penerima sah dari daftar tersimpan (pembacaan longgar): buang yang tak sah dan ganda lintas daftar. */
export function sendableMailLists(
  lists: MailLists,
  isValid: (email: string) => boolean,
): MailLists {
  const seen = new Set<string>();
  const result: MailLists = { recipients: [], cc: [], bcc: [] };
  for (const field of MAIL_LIST_FIELDS) {
    for (const item of lists[field]) {
      const email = normalizeEmail(item);
      if (!isValid(email) || seen.has(email)) continue;
      seen.add(email);
      result[field].push(email);
    }
  }
  return result;
}
