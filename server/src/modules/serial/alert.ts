import { writeAudit } from '@server/core/audit';
import { CAS_FAIL_SQL, isGuardFailure } from '@server/core/cas';
import type { DbStatement } from '@server/core/db';
import { DbError } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError, staleError } from '@server/core/errors';
import { getSetting } from '@server/core/settings';
import type { UserContext } from '@server/modules/access/context';
import { canActOnAllBus } from '@shared/business-units';
import type {
  SaveSerialSettingsInput,
  SerialAlertSettings,
  SerialSettingsDto,
} from '@shared/contract';

/**
 * Pengaturan surel "Serial Number rusak" (tahap 5b, spek §4.6): satu JSON di tabel `settings` (kunci `SERIAL_ALERT`)
 * yang membawa `updatedAt` sebagai versi CAS sendiri, terpisah dari `STICKER_ALERT` dan `POSTEL_ALERT`. Satu daftar
 * penerima GLOBAL (keputusan pemilik 2026-11-13, spek §11 butir 2). Pola `savePostelSettings`.
 */
export const SETTING_SERIAL_ALERT = 'SERIAL_ALERT';

export const SERIAL_SETTINGS_STALE_MESSAGE =
  'Pengaturan sudah diubah orang lain; muat ulang halaman lalu ulangi perubahan kamu';

interface StoredAlert extends SerialAlertSettings {
  updatedAt: string;
}

function defaults(): SerialAlertSettings {
  return { enabled: false, recipients: [] };
}

/**
 * Pembacaan LONGGAR (tampilan dan pengirim job tak boleh gagal karena pengaturan rusak): bukan JSON atau bukan objek =
 * bawaan; `enabled` hanya `true` eksplisit; penerima yang bukan teks dibuang.
 */
function parseStored(raw: string): StoredAlert | null {
  if (raw === '') return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown> | null;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    return {
      enabled: value.enabled === true,
      recipients: Array.isArray(value.recipients)
        ? value.recipients.filter((item): item is string => typeof item === 'string')
        : [],
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
    };
  } catch {
    return null;
  }
}

/** Pengaturan tersimpan (bawaan nonaktif tanpa penerima) dan nilai mentahnya untuk CAS. */
export async function readSerialAlert(
  env: Env,
): Promise<{ alert: SerialAlertSettings; updatedAt: string; raw: string }> {
  const raw = await getSetting(env, SETTING_SERIAL_ALERT);
  const stored = parseStored(raw);
  if (!stored) return { alert: defaults(), updatedAt: '', raw };
  const { updatedAt, ...alert } = stored;
  return { alert, updatedAt, raw };
}

/**
 * Pengaturan penerima bersifat global dan memuat alamat email: hanya super admin atau pemegang `serial: manage` pada
 * SEMUA BU (penugasan "Semua BU", atau setara di setiap BU) yang boleh membaca atau mengubahnya (keputusan pemilik
 * 2026-11-13). Selain itu `FORBIDDEN`.
 */
export async function assertCanManageSerialSettings(env: Env, user: UserContext): Promise<void> {
  if (!(await canManageSerialSettings(env, user))) {
    throw appError('FORBIDDEN', 'Pengaturan ini hanya untuk pengelola Serial Number di semua BU');
  }
}

/** Aturan tunggal izin pengaturan penerima: dipakai penjaga rute DAN `auth.me` (penanda menu di web). */
export async function canManageSerialSettings(env: Env, user: UserContext): Promise<boolean> {
  if (user.isSuperAdmin) return true;
  const rows = await env.DB.prepare('SELECT id FROM business_units').all<{ id: string }>();
  const allBuIds = rows.results.map((row) => row.id.trim());
  return canActOnAllBus(user.businessUnits, 'serial', 'manage', allBuIds);
}

export async function getSerialSettings(env: Env, user: UserContext): Promise<SerialSettingsDto> {
  await assertCanManageSerialSettings(env, user);
  return serialSettingsDto(env);
}

async function serialSettingsDto(env: Env): Promise<SerialSettingsDto> {
  const { alert, updatedAt } = await readSerialAlert(env);
  return { alert, updatedAt, smtpConfigured: env.MAILER !== undefined };
}

/** `SELECT` penjaga: membatalkan batch bila baris yang baru di-`UPDATE` tidak berubah (nilai lama sudah berganti). */
function guardChanged(env: Env): DbStatement {
  return env.DB.prepare(
    `SELECT CASE WHEN ROW_COUNT() = 0 THEN ${CAS_FAIL_SQL} ELSE 0 END AS guard_ok`,
  );
}

function auditView(alert: SerialAlertSettings) {
  return { enabled: alert.enabled, recipients: alert.recipients.join(',') };
}

export async function saveSerialSettings(
  env: Env,
  input: SaveSerialSettingsInput,
  user: UserContext,
): Promise<SerialSettingsDto> {
  await assertCanManageSerialSettings(env, user);
  const current = await readSerialAlert(env);
  if (input.expectedUpdatedAt !== current.updatedAt) {
    throw staleError(SERIAL_SETTINGS_STALE_MESSAGE);
  }
  const now = nowIso(env);
  const stored: StoredAlert = { ...input.alert, updatedAt: now };
  const value = JSON.stringify(stored);
  // Keberadaan BARIS yang menentukan INSERT atau UPDATE (baris bernilai '' tetap harus di-UPDATE, bukan di-INSERT ulang).
  const rowExists =
    (await env.DB.prepare('SELECT 1 AS present FROM settings WHERE `key` = ?')
      .bind(SETTING_SERIAL_ALERT)
      .first<{ present: number }>()) !== null;
  const statements: DbStatement[] = !rowExists
    ? [
        env.DB.prepare('INSERT INTO settings (`key`, value) VALUES (?, ?)').bind(
          SETTING_SERIAL_ALERT,
          value,
        ),
      ]
    : [
        env.DB.prepare('UPDATE settings SET value = ? WHERE `key` = ? AND value = ?').bind(
          value,
          SETTING_SERIAL_ALERT,
          current.raw,
        ),
        guardChanged(env),
      ];
  statements.push(
    writeAudit(env.DB, {
      ts: now,
      actor: user.email,
      action: 'serial.settings',
      target: `settings:${SETTING_SERIAL_ALERT}`,
      before: auditView(current.alert),
      after: auditView(input.alert),
    }),
  );
  try {
    await env.DB.batch(statements);
  } catch (error) {
    // Penjaga gagal = nilai lama sudah diganti penyimpan lain; INSERT ganda = penyimpan pertama kali lain lebih dulu.
    if (isGuardFailure(error) || (error instanceof DbError && error.kind === 'duplicate')) {
      throw staleError(SERIAL_SETTINGS_STALE_MESSAGE);
    }
    throw error;
  }
  return serialSettingsDto(env);
}
