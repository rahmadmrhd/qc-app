import { writeAudit } from '@server/core/audit';
import { CAS_FAIL_SQL, isGuardFailure } from '@server/core/cas';
import type { ActorRef } from '@server/core/context';
import type { DbStatement } from '@server/core/db';
import { DbError } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError, staleError } from '@server/core/errors';
import { getSetting } from '@server/core/settings';
import type {
  SaveStickerSettingsInput,
  StickerAlertSettings,
  StickerSettingsDto,
} from '@shared/contract';
import { STICKER_LIMITS } from '@shared/stickers';
import { listStickerTypeRecords } from './repo';

/**
 * Konfigurasi Stiker (tahap 4a): pengaturan email ringkasan stok menipis (sakelar, penerima, jam WIB) dan minimum
 * bawaan per jenis. Pengaturan email disimpan sebagai satu JSON di tabel `settings` (kunci `STICKER_ALERT`) yang memuat
 * `updatedAt` sebagai versi (CAS: `UPDATE ... WHERE value = <nilai lama>`).
 */

export const SETTING_STICKER_ALERT = 'STICKER_ALERT';

export const STICKER_SETTINGS_STALE_MESSAGE =
  'Pengaturan sudah diubah orang lain; muat ulang halaman lalu ulangi perubahan Anda';

const DEFAULT_ALERT: StickerAlertSettings = {
  enabled: false,
  recipients: [],
  cc: [],
  bcc: [],
  digestHour: 8,
  intervalDays: 1,
};

interface StoredAlert extends StickerAlertSettings {
  updatedAt: string;
}

function parseStored(raw: string): StoredAlert | null {
  if (raw === '') return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredAlert> | null;
    if (typeof value !== 'object' || value === null) return null;
    const hour = Number(value.digestHour);
    const interval = Number(value.intervalDays);
    return {
      enabled: value.enabled === true,
      recipients: Array.isArray(value.recipients)
        ? value.recipients.filter((item): item is string => typeof item === 'string')
        : [],
      cc: Array.isArray(value.cc)
        ? value.cc.filter((item): item is string => typeof item === 'string')
        : [],
      bcc: Array.isArray(value.bcc)
        ? value.bcc.filter((item): item is string => typeof item === 'string')
        : [],
      digestHour:
        Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_ALERT.digestHour,
      // Data tersimpan sebelum ada selang tidak memuatnya: dibaca sebagai tiap hari (perilaku lama).
      intervalDays:
        Number.isInteger(interval) &&
        interval >= 1 &&
        interval <= STICKER_LIMITS.alertIntervalDaysMax
          ? interval
          : DEFAULT_ALERT.intervalDays,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
    };
  } catch {
    return null;
  }
}

/** Pengaturan email tersimpan (bawaan: nonaktif, tanpa penerima, jam 8 WIB) dan nilai mentahnya untuk CAS. */
export async function readStickerAlert(
  env: Env,
): Promise<{ alert: StickerAlertSettings; updatedAt: string; raw: string }> {
  const raw = await getSetting(env, SETTING_STICKER_ALERT);
  const stored = parseStored(raw);
  if (!stored) return { alert: { ...DEFAULT_ALERT }, updatedAt: '', raw };
  const { updatedAt, ...alert } = stored;
  return { alert, updatedAt, raw };
}

export async function getStickerSettings(env: Env): Promise<StickerSettingsDto> {
  const [{ alert, updatedAt }, types] = await Promise.all([
    readStickerAlert(env),
    listStickerTypeRecords(env.DB),
  ]);
  return {
    alert,
    types: types
      .map((type) => ({
        id: type.id,
        name: type.name,
        systemKind: type.systemKind,
        defaultMinQty: type.defaultMinQty,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    updatedAt,
    smtpConfigured: env.MAILER !== undefined,
  };
}

/** `SELECT` penjaga: membatalkan batch bila baris yang baru di-`UPDATE` tidak berubah (nilai lama sudah berganti). */
function guardChanged(env: Env): DbStatement {
  return env.DB.prepare(
    `SELECT CASE WHEN ROW_COUNT() = 0 THEN ${CAS_FAIL_SQL} ELSE 0 END AS guard_ok`,
  );
}

export async function saveStickerSettings(
  env: Env,
  input: SaveStickerSettingsInput,
  actor: ActorRef,
): Promise<StickerSettingsDto> {
  const [current, types] = await Promise.all([
    readStickerAlert(env),
    listStickerTypeRecords(env.DB),
  ]);
  if (input.expectedUpdatedAt !== current.updatedAt) {
    throw staleError(STICKER_SETTINGS_STALE_MESSAGE);
  }
  const knownTypes = new Map(types.map((type) => [type.id, type]));
  const defaults = input.defaults ?? [];
  for (const row of defaults) {
    if (!knownTypes.has(row.typeId)) {
      const message = 'Jenis stiker tidak ditemukan';
      throw appError('VALIDATION', message, { defaults: message });
    }
  }
  const now = nowIso(env);
  const stored: StoredAlert = { ...input.alert, updatedAt: now };
  const value = JSON.stringify(stored);
  const changedDefaults = defaults.filter(
    (row) => knownTypes.get(row.typeId)?.defaultMinQty !== row.defaultMinQty,
  );
  const statements: DbStatement[] =
    current.raw === ''
      ? [
          env.DB.prepare('INSERT INTO settings (`key`, value) VALUES (?, ?)').bind(
            SETTING_STICKER_ALERT,
            value,
          ),
        ]
      : [
          env.DB.prepare('UPDATE settings SET value = ? WHERE `key` = ? AND value = ?').bind(
            value,
            SETTING_STICKER_ALERT,
            current.raw,
          ),
          guardChanged(env),
        ];
  for (const row of changedDefaults) {
    statements.push(
      // `updated_at` ikut naik: form Jenis (yang juga memuat minimum bawaan) yang dibuka sebelumnya menjadi usang,
      // bukan menimpa diam-diam perubahan dari halaman ini (satu kolom data, dua pintu; keputusan 2026-11-25).
      env.DB.prepare(
        'UPDATE sticker_types SET default_min_qty = ?, updated_at = ?, updated_by = ? WHERE id = ?',
      ).bind(row.defaultMinQty, now, actor.email, row.typeId),
    );
  }
  statements.push(
    writeAudit(env.DB, {
      ts: now,
      actor: actor.email,
      action: 'sticker.settings',
      target: 'Konfigurasi Stiker',
      before: {
        enabled: current.alert.enabled,
        recipients: current.alert.recipients.join(','),
        cc: current.alert.cc.join(','),
        bcc: current.alert.bcc.join(','),
        digestHour: current.alert.digestHour,
        intervalDays: current.alert.intervalDays,
      },
      after: {
        enabled: input.alert.enabled,
        recipients: input.alert.recipients.join(','),
        cc: input.alert.cc.join(','),
        bcc: input.alert.bcc.join(','),
        digestHour: input.alert.digestHour,
        intervalDays: input.alert.intervalDays,
        defaults: changedDefaults
          .map((row) => `${knownTypes.get(row.typeId)?.name ?? row.typeId}=${row.defaultMinQty}`)
          .join(', '),
      },
    }),
  );
  try {
    await env.DB.batch(statements);
  } catch (error) {
    // Penjaga gagal = nilai lama sudah diganti penyimpan lain; INSERT ganda = penyimpan pertama kali lain lebih dulu.
    if (isGuardFailure(error) || (error instanceof DbError && error.kind === 'duplicate')) {
      throw staleError(STICKER_SETTINGS_STALE_MESSAGE);
    }
    throw error;
  }
  return getStickerSettings(env);
}
