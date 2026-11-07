import type { Env } from './env';

/** Kunci konfigurasi di tabel `settings`. */
export const SETTING_DRIVE_FOLDER_ID = 'DRIVE_FOLDER_ID';

/**
 * Folder fungsi di Drive: kunci tabel `settings` -> field `Env` (`.env`) yang menggantikannya bila terisi (T30a).
 * Bila id `.env` terisi, itulah folder fungsi yang berlaku (hanya diverifikasi, tidak pernah dibuat/ditimpa);
 * bila kosong, folder dibuat di bawah folder induk dan dicatat di tabel `settings` seperti semula.
 */
const FOLDER_ENV_FIELD = {
  DRIVE_FOLDER_ID: 'ATTACHMENTS_FOLDER_ID',
  QR_FOLDER_ID: 'QR_FOLDER_ID',
  QR_DOC_FOLDER_ID: 'QR_DOC_FOLDER_ID',
  BACKUP_FOLDER_ID: 'BACKUP_FOLDER_ID',
} as const;

/** Id folder fungsi dari `.env`; '' bila tidak dikonfigurasi. */
export function configuredFolderId(env: Env, settingKey: string): string {
  const field = FOLDER_ENV_FIELD[settingKey as keyof typeof FOLDER_ENV_FIELD];
  return field === undefined ? '' : (env[field]?.trim() ?? '');
}

/** Folder fungsi yang berlaku: id dari `.env` bila ada, jika tidak nilai tabel `settings` ('' bila belum dibuat). */
export async function folderIdOf(env: Env, settingKey: string): Promise<string> {
  return configuredFolderId(env, settingKey) || (await getSetting(env, settingKey));
}

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
