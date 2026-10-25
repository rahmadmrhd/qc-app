import { BRIDGE_SECRET_MIN_LENGTH } from './auth';
import { bridgePlatform_ } from './platform';

function idsOf_(value: string | null): string[] {
  return (value ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');
}

/**
 * Laporan konfigurasi jembatan untuk pemilik (dijalankan dari editor lewat `setup`). TIDAK mengubah apa pun dan
 * TIDAK pernah mencetak nilai rahasia; hanya status. Memicu persetujuan scope Drive dan Sheets saat pertama dijalankan.
 */
export function runBridgeSetup_(): string {
  const platform = bridgePlatform_();
  const lines: string[] = [];
  const secret = (platform.getProperty('BRIDGE_SECRET') ?? '').trim();
  lines.push(
    secret.length >= BRIDGE_SECRET_MIN_LENGTH
      ? `BRIDGE_SECRET: terisi (${secret.length} karakter)`
      : `BRIDGE_SECRET: BELUM SAH (wajib >= ${BRIDGE_SECRET_MIN_LENGTH} karakter; isi di Project Settings > Script properties)`,
  );
  const folders = idsOf_(platform.getProperty('ALLOWED_FOLDER_IDS'));
  if (folders.length === 0) {
    lines.push('ALLOWED_FOLDER_IDS: KOSONG (semua aksi Drive akan ditolak)');
  }
  for (const id of folders) {
    const meta = platform.driveFolderMeta(id);
    lines.push(
      `ALLOWED_FOLDER_IDS ${id}: ${meta === null ? 'TIDAK TERAKSES' : meta.trashed ? 'ADA DI TEMPAT SAMPAH' : 'ok'}`,
    );
  }
  for (const key of ['SPREADSHEET_ID', 'EXPORT_SPREADSHEET_ID']) {
    const id = (platform.getProperty(key) ?? '').trim();
    if (id === '') {
      lines.push(
        key === 'SPREADSHEET_ID'
          ? 'SPREADSHEET_ID: KOSONG (sheets.dump/export ditolak)'
          : 'EXPORT_SPREADSHEET_ID: kosong (memakai SPREADSHEET_ID)',
      );
      continue;
    }
    try {
      lines.push(`${key}: ok (${platform.spreadsheet(id).sheetNames().length} sheet)`);
    } catch {
      lines.push(`${key}: TIDAK TERAKSES`);
    }
  }
  return lines.join('\n');
}
