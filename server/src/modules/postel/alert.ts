import { writeAudit } from '@server/core/audit';
import { CAS_FAIL_SQL, isGuardFailure } from '@server/core/cas';
import type { ActorRef } from '@server/core/context';
import type { DbStatement } from '@server/core/db';
import { DbError } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { staleError } from '@server/core/errors';
import { getSetting } from '@server/core/settings';
import type {
  PostelAlertSettings,
  PostelSettingsDto,
  SavePostelSettingsInput,
} from '@shared/contract';
import { POSTEL_ALERT_DEFAULTS, POSTEL_LIMITS } from '@shared/postel';

/**
 * Pengaturan peringatan masa berlaku Postel (tahap 4b, spek §3 butir 7): satu JSON di tabel `settings` (kunci
 * `POSTEL_ALERT`) yang memuat `updatedAt` sebagai versi CAS sendiri, terpisah dari `STICKER_ALERT`, sehingga menyimpan
 * satu tidak menimpa yang lain. Pola `saveStickerSettings`.
 */

/** Kunci pengaturan peringatan Postel di tabel `settings`. */
export const SETTING_POSTEL_ALERT = 'POSTEL_ALERT';

export const POSTEL_SETTINGS_STALE_MESSAGE =
  'Pengaturan sudah diubah orang lain; muat ulang halaman lalu ulangi perubahan Anda';

interface StoredAlert extends PostelAlertSettings {
  updatedAt: string;
}

function defaults(): PostelAlertSettings {
  return {
    enabled: POSTEL_ALERT_DEFAULTS.enabled,
    recipients: [...POSTEL_ALERT_DEFAULTS.recipients],
    sendHour: POSTEL_ALERT_DEFAULTS.sendHour,
    thresholds: [...POSTEL_ALERT_DEFAULTS.thresholds],
    repeatEveryDays: POSTEL_ALERT_DEFAULTS.repeatEveryDays,
  };
}

/**
 * Pembacaan LONGGAR (tampilan dan penjadwal tak boleh gagal karena pengaturan rusak): bukan JSON, bukan objek, atau
 * bidang tak sah memakai nilai bawaan per bidang; ambang tak sah disaring dan bila tak tersisa memakai bawaan.
 */
function parseStored(raw: string): StoredAlert | null {
  if (raw === '') return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown> | null;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const base = defaults();
    const hour = value.sendHour;
    const repeat = value.repeatEveryDays;
    const thresholds = Array.isArray(value.thresholds)
      ? [
          ...new Set(
            value.thresholds.filter(
              (entry): entry is number =>
                typeof entry === 'number' &&
                Number.isInteger(entry) &&
                entry > 0 &&
                entry <= POSTEL_LIMITS.thresholdDaysMax,
            ),
          ),
        ]
          .sort((a, b) => b - a)
          .slice(0, POSTEL_LIMITS.thresholdsMax)
      : [];
    return {
      enabled: value.enabled === true,
      recipients: Array.isArray(value.recipients)
        ? value.recipients.filter((item): item is string => typeof item === 'string')
        : [],
      sendHour:
        typeof hour === 'number' && Number.isInteger(hour) && hour >= 0 && hour <= 23
          ? hour
          : base.sendHour,
      thresholds: thresholds.length > 0 ? thresholds : base.thresholds,
      repeatEveryDays:
        typeof repeat === 'number' &&
        Number.isInteger(repeat) &&
        repeat >= 0 &&
        repeat <= POSTEL_LIMITS.repeatDaysMax
          ? repeat
          : base.repeatEveryDays,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
    };
  } catch {
    return null;
  }
}

/** Pengaturan tersimpan (bawaan `POSTEL_ALERT_DEFAULTS`) dan nilai mentahnya untuk CAS. */
export async function readPostelAlert(
  env: Env,
): Promise<{ alert: PostelAlertSettings; updatedAt: string; raw: string }> {
  const raw = await getSetting(env, SETTING_POSTEL_ALERT);
  const stored = parseStored(raw);
  if (!stored) return { alert: defaults(), updatedAt: '', raw };
  const { updatedAt, ...alert } = stored;
  return { alert, updatedAt, raw };
}

export async function getPostelSettings(env: Env): Promise<PostelSettingsDto> {
  const { alert, updatedAt } = await readPostelAlert(env);
  return { alert, updatedAt, smtpConfigured: env.MAILER !== undefined };
}

/** `SELECT` penjaga: membatalkan batch bila baris yang baru di-`UPDATE` tidak berubah (nilai lama sudah berganti). */
function guardChanged(env: Env): DbStatement {
  return env.DB.prepare(
    `SELECT CASE WHEN ROW_COUNT() = 0 THEN ${CAS_FAIL_SQL} ELSE 0 END AS guard_ok`,
  );
}

function auditView(alert: PostelAlertSettings) {
  return {
    enabled: alert.enabled,
    recipients: alert.recipients.join(','),
    sendHour: alert.sendHour,
    thresholds: alert.thresholds.join(','),
    repeatEveryDays: alert.repeatEveryDays,
  };
}

export async function savePostelSettings(
  env: Env,
  input: SavePostelSettingsInput,
  actor: ActorRef,
): Promise<PostelSettingsDto> {
  const current = await readPostelAlert(env);
  if (input.expectedUpdatedAt !== current.updatedAt) {
    throw staleError(POSTEL_SETTINGS_STALE_MESSAGE);
  }
  const now = nowIso(env);
  const stored: StoredAlert = { ...input.alert, updatedAt: now };
  const value = JSON.stringify(stored);
  // Keberadaan BARIS yang menentukan INSERT atau UPDATE (baris bernilai '' tetap harus di-UPDATE, bukan di-INSERT ulang).
  const rowExists =
    (await env.DB.prepare('SELECT 1 AS present FROM settings WHERE `key` = ?')
      .bind(SETTING_POSTEL_ALERT)
      .first<{ present: number }>()) !== null;
  const statements: DbStatement[] = !rowExists
    ? [
        env.DB.prepare('INSERT INTO settings (`key`, value) VALUES (?, ?)').bind(
          SETTING_POSTEL_ALERT,
          value,
        ),
      ]
    : [
        env.DB.prepare('UPDATE settings SET value = ? WHERE `key` = ? AND value = ?').bind(
          value,
          SETTING_POSTEL_ALERT,
          current.raw,
        ),
        guardChanged(env),
      ];
  statements.push(
    writeAudit(env.DB, {
      ts: now,
      actor: actor.email,
      action: 'postel.settings',
      target: 'Konfigurasi Postel',
      before: auditView(current.alert),
      after: auditView(input.alert),
    }),
  );
  try {
    await env.DB.batch(statements);
  } catch (error) {
    // Penjaga gagal = nilai lama sudah diganti penyimpan lain; INSERT ganda = penyimpan pertama kali lain lebih dulu.
    if (isGuardFailure(error) || (error instanceof DbError && error.kind === 'duplicate')) {
      throw staleError(POSTEL_SETTINGS_STALE_MESSAGE);
    }
    throw error;
  }
  return getPostelSettings(env);
}
