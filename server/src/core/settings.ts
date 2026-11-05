import type { Env } from './env';

/** Kunci konfigurasi di tabel `settings`. */
export const SETTING_DRIVE_FOLDER_ID = 'DRIVE_FOLDER_ID';

export async function getSetting(env: Env, key: string): Promise<string> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE `key` = ?')
    .bind(key)
    .first<{ value: string }>();
  return row?.value.trim() ?? '';
}

/**
 * Menyimpan nilai hanya bila belum ada (permintaan serentak: pemenang menentukan) dan mengembalikan
 * nilai yang berlaku.
 */
export async function setSettingIfAbsent(env: Env, key: string, value: string): Promise<string> {
  await env.DB.prepare('INSERT IGNORE INTO settings (`key`, value) VALUES (?, ?)')
    .bind(key, value)
    .run();
  return getSetting(env, key);
}

export async function putSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
  )
    .bind(key, value)
    .run();
}
