import { writeAudit } from '@server/core/audit';
import { CAS_FAIL_SQL, isGuardFailure } from '@server/core/cas';
import type { DbStatement } from '@server/core/db';
import { DbError } from '@server/core/db';
import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { staleError } from '@server/core/errors';
import { getSetting } from '@server/core/settings';
import type { UserContext } from '@server/modules/access/context';
import type {
  SaveSerialServiceSettingsInput,
  SerialLocationOptionDto,
  SerialServiceSettingsDto,
} from '@shared/contract';
import { assertCanManageSerialSettings } from './alert';
import { validationError } from './service';

/**
 * Lokasi tim servis (laporan rusak 2026-11-14 §4.6): satu JSON di tabel `settings` (kunci `SERIAL_SERVICE_LOCATIONS`)
 * yang membawa `updatedAt` sebagai versi CAS sendiri, terpisah dari `SERIAL_ALERT`. Global. Daftar kosong, atau tak
 * satu pun lokasi tercantum yang masih aktif, berarti SEMUA lokasi aktif (agar alur tidak macet sebelum admin mengisinya).
 * Hak mengubahnya sama dengan daftar penerima surel (`assertCanManageSerialSettings`).
 */
export const SETTING_SERIAL_SERVICE_LOCATIONS = 'SERIAL_SERVICE_LOCATIONS';

export const SERVICE_SETTINGS_STALE_MESSAGE =
  'Pengaturan sudah diubah orang lain; muat ulang halaman lalu ulangi perubahan kamu';

interface StoredLocations {
  locationIds: string[];
  updatedAt: string;
}

/** Pembacaan LONGGAR: bukan JSON/objek = bawaan kosong; id yang bukan teks dibuang. */
function parseStored(raw: string): StoredLocations | null {
  if (raw === '') return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown> | null;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    return {
      locationIds: Array.isArray(value.locationIds)
        ? value.locationIds.filter((id): id is string => typeof id === 'string')
        : [],
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
    };
  } catch {
    return null;
  }
}

async function readServiceSettings(
  env: Env,
): Promise<{ locationIds: string[]; updatedAt: string; raw: string }> {
  const raw = await getSetting(env, SETTING_SERIAL_SERVICE_LOCATIONS);
  const stored = parseStored(raw);
  return { locationIds: stored?.locationIds ?? [], updatedAt: stored?.updatedAt ?? '', raw };
}

/** Semua lokasi aktif, urut kode. */
async function activeLocations(env: Env): Promise<SerialLocationOptionDto[]> {
  const rows = await env.DB.prepare(
    "SELECT id, code, name FROM locations WHERE status = 'active' ORDER BY code, id",
  ).all<{ id: string; code: string; name: string }>();
  return rows.results.map((row) => ({ id: row.id.trim(), code: row.code.trim(), name: row.name }));
}

/**
 * Lokasi servis efektif: lokasi AKTIF yang tercantum di pengaturan, urut kode. Kosong, atau tak satu pun tercantum yang
 * aktif, = semua lokasi aktif. Satu-satunya sumber daftar tujuan Kirim ke servis (server) dan pilihan di dialog (web).
 */
export async function effectiveServiceLocations(env: Env): Promise<SerialLocationOptionDto[]> {
  const [{ locationIds }, active] = await Promise.all([
    readServiceSettings(env),
    activeLocations(env),
  ]);
  if (locationIds.length === 0) return active;
  const chosen = new Set(locationIds.map((id) => id.trim()));
  const narrowed = active.filter((location) => chosen.has(location.id));
  return narrowed.length > 0 ? narrowed : active;
}

export async function getServiceSettings(
  env: Env,
  user: UserContext,
): Promise<SerialServiceSettingsDto> {
  await assertCanManageSerialSettings(env, user);
  return serviceSettingsDto(env);
}

async function serviceSettingsDto(env: Env): Promise<SerialServiceSettingsDto> {
  const { locationIds, updatedAt } = await readServiceSettings(env);
  return { locationIds, updatedAt };
}

/** `SELECT` penjaga: membatalkan batch bila baris yang baru di-`UPDATE` tidak berubah (nilai lama sudah berganti). */
function guardChanged(env: Env): DbStatement {
  return env.DB.prepare(
    `SELECT CASE WHEN ROW_COUNT() = 0 THEN ${CAS_FAIL_SQL} ELSE 0 END AS guard_ok`,
  );
}

export async function saveServiceSettings(
  env: Env,
  input: SaveSerialServiceSettingsInput,
  user: UserContext,
): Promise<SerialServiceSettingsDto> {
  await assertCanManageSerialSettings(env, user);
  const current = await readServiceSettings(env);
  if (input.expectedUpdatedAt !== current.updatedAt) {
    throw staleError(SERVICE_SETTINGS_STALE_MESSAGE);
  }
  // Lokasi yang dipilih harus ada (status apa pun: lokasi nonaktif yang tercantum diabaikan saat dipakai).
  if (input.locationIds.length > 0) {
    const marks = input.locationIds.map(() => '?').join(', ');
    const found = await env.DB.prepare(`SELECT id FROM locations WHERE id IN (${marks})`)
      .bind(...input.locationIds)
      .all<{ id: string }>();
    if (found.results.length !== input.locationIds.length) {
      throw validationError('locationIds', 'Ada lokasi yang tidak ditemukan');
    }
  }
  const now = nowIso(env);
  const stored: StoredLocations = { locationIds: input.locationIds, updatedAt: now };
  const value = JSON.stringify(stored);
  const rowExists =
    (await env.DB.prepare('SELECT 1 AS present FROM settings WHERE `key` = ?')
      .bind(SETTING_SERIAL_SERVICE_LOCATIONS)
      .first<{ present: number }>()) !== null;
  const statements: DbStatement[] = !rowExists
    ? [
        env.DB.prepare('INSERT INTO settings (`key`, value) VALUES (?, ?)').bind(
          SETTING_SERIAL_SERVICE_LOCATIONS,
          value,
        ),
      ]
    : [
        env.DB.prepare('UPDATE settings SET value = ? WHERE `key` = ? AND value = ?').bind(
          value,
          SETTING_SERIAL_SERVICE_LOCATIONS,
          current.raw,
        ),
        guardChanged(env),
      ];
  statements.push(
    writeAudit(env.DB, {
      ts: now,
      actor: user.email,
      action: 'serial.service_locations',
      target: `settings:${SETTING_SERIAL_SERVICE_LOCATIONS}`,
      before: { locationIds: current.locationIds.join(',') },
      after: { locationIds: input.locationIds.join(',') },
    }),
  );
  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (isGuardFailure(error) || (error instanceof DbError && error.kind === 'duplicate')) {
      throw staleError(SERVICE_SETTINGS_STALE_MESSAGE);
    }
    throw error;
  }
  return serviceSettingsDto(env);
}
