import type { Env } from '@server/core/env';
import { getSetting, putSetting } from '@server/core/settings';
import { parseBackupName } from './names';
import type { VerifyResult, VerifyStatus } from './verify';

/** Nama berkas cadangan terakhir yang BERHASIL (terunggah dan terverifikasi ke Drive); ditulis `db_backup`. */
export const SETTING_BACKUP_LAST_SUCCESS_NAME = 'BACKUP_LAST_SUCCESS_NAME';
/** Hasil verifikasi terakhir (JSON `StoredVerifyResult`). */
export const SETTING_BACKUP_VERIFY_RESULT = 'BACKUP_VERIFY_RESULT';

/** Percobaan verifikasi per cadangan bila hasilnya `error` (tak dapat diselesaikan); `failed` bersifat final. */
export const VERIFY_MAX_ATTEMPTS = 3;
/** Jeda minimum antar percobaan ulang setelah `error`. */
export const VERIFY_RETRY_AFTER_MS = 30 * 60 * 1000;
/** Cadangan yang lebih tua dari ini tidak lagi dijadwalkan verifikasinya (verifikasi dijalankan tepat sesudah cadangan, bukan siang hari). */
export const VERIFY_FRESH_MS = 8 * 60 * 60 * 1000;
/** Cadangan tanpa hasil verifikasi lebih lama dari ini = peringatan "verifikasi tidak berjalan". */
export const VERIFY_MISSING_AFTER_MS = 12 * 60 * 60 * 1000;

const TEXT_LIMIT = 300;
const LIST_LIMIT = 11;

export interface StoredVerifyResult {
  status: VerifyStatus;
  name: string;
  attempts: number;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  summary: string;
  failures: string[];
  notes: string[];
  tables: number;
  rows: number;
  bytes: number;
}

const clip = (text: string): string =>
  text.length <= TEXT_LIMIT ? text : `${text.slice(0, TEXT_LIMIT - 3)}...`;

export function toStored(result: VerifyResult, attempts: number): StoredVerifyResult {
  return {
    status: result.status,
    name: result.name,
    attempts,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    durationMs: result.durationMs,
    summary: clip(result.summary),
    failures: result.failures.slice(0, LIST_LIMIT).map(clip),
    notes: result.notes.slice(0, LIST_LIMIT).map(clip),
    tables: result.tables,
    rows: result.rows,
    bytes: result.bytes,
  };
}

const isStatus = (value: unknown): value is VerifyStatus =>
  value === 'ok' || value === 'failed' || value === 'error';

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const num = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

/** Membaca hasil tersimpan; `null` bila belum ada atau bentuknya rusak. */
export async function readVerifyResult(env: Env): Promise<StoredVerifyResult | null> {
  const raw = await getSetting(env, SETTING_BACKUP_VERIFY_RESULT);
  if (raw === '') return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (!isStatus(record.status) || typeof record.name !== 'string') return null;
  return {
    status: record.status,
    name: record.name,
    attempts: Math.max(1, num(record.attempts)),
    startedAt: num(record.startedAt),
    finishedAt: num(record.finishedAt),
    durationMs: num(record.durationMs),
    summary: typeof record.summary === 'string' ? record.summary : '',
    failures: strings(record.failures),
    notes: strings(record.notes),
    tables: num(record.tables),
    rows: num(record.rows),
    bytes: num(record.bytes),
  };
}

export async function writeVerifyResult(env: Env, stored: StoredVerifyResult): Promise<void> {
  await putSetting(env, SETTING_BACKUP_VERIFY_RESULT, JSON.stringify(stored));
}

/**
 * Mencatat hasil verifikasi untuk `name` (penghitung percobaan naik bila hasil sebelumnya untuk cadangan yang sama).
 * Dipakai job dan CLI `--record`.
 */
export async function recordVerification(
  env: Env,
  result: VerifyResult,
  fallbackName: string,
): Promise<StoredVerifyResult> {
  const name = result.name === '' ? fallbackName : result.name;
  const previous = await readVerifyResult(env);
  const attempts = previous !== null && previous.name === name ? previous.attempts + 1 : 1;
  const stored = toStored({ ...result, name }, attempts);
  await writeVerifyResult(env, stored);
  return stored;
}

/**
 * Apakah cadangan terakhir perlu diverifikasi (fungsi murni): ada cadangan berhasil bernama sah yang masih segar
 * (`VERIFY_FRESH_MS`) dan belum punya hasil; atau hasilnya `error` dan masih ada sisa percobaan setelah jeda. Hasil `ok`
 * dan `failed` final: `failed` tak diulang (isi cadangan tak berubah dan basis data hidup hanya makin menyimpang).
 */
export function isVerifyDue(
  nowMs: number,
  lastName: string,
  result: StoredVerifyResult | null,
): boolean {
  const parsed = lastName === '' ? null : parseBackupName(lastName);
  if (parsed === null) return false;
  if (nowMs - parsed.epochMs > VERIFY_FRESH_MS) return false;
  if (result === null || result.name !== lastName) return true;
  if (result.status !== 'error') return false;
  return (
    result.attempts < VERIFY_MAX_ATTEMPTS && nowMs - result.finishedAt >= VERIFY_RETRY_AFTER_MS
  );
}
