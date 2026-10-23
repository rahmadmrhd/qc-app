import { missingConfigKeys_, syncToken_ } from '@gas/core/config';
import { applyTextFormats_, openTable_, TEXT_FORMATS_PROPERTY } from '@gas/core/db';
import { platform_ } from '@gas/core/platform';
import {
  AUDIT_TABLE,
  LOCATIONS_TABLE,
  migrateAuditDetail_,
  migrateUserAssignments_,
  ROLES_TABLE,
  USERS_TABLE,
} from '@gas/modules/access/repo';
import { BRANDS_TABLE } from '@gas/modules/brand/repo';
import { CUSTOMERS_TABLE } from '@gas/modules/customer/repo';
import { FILES_TABLE } from '@gas/modules/files/repo';
import { DRIVE_FOLDER_NAME, ensureDriveFolder_ } from '@gas/modules/files/service';
import { HANDOVERS_TABLE } from '@gas/modules/handover/repo';
import { ITEMS_TABLE } from '@gas/modules/item/repo';
import {
  ensureQrDocFolder_,
  ensureQrFolder_,
  QR_DOC_FOLDER_NAME,
  QR_FOLDER_NAME,
} from '@gas/modules/qrcode/folders';
import {
  QR_DEFAULTS_TABLE,
  QR_DESIGNS_TABLE,
  QR_DOCUMENTS_TABLE,
  QR_PRESETS_TABLE,
} from '@gas/modules/qrcode/repo';
import { migrateQrDefaults_ } from '@gas/modules/qrcode/service';
import { assignInitialRevs_, SYNC_STATE_TABLE } from '@gas/modules/sync/state';
import { SYNC_TOKEN_MIN_LENGTH } from '@shared/sync';

export function runSetup_(): string {
  const lines: string[] = [];
  const missing = missingConfigKeys_();
  lines.push(
    missing.length === 0
      ? 'Script Properties lengkap.'
      : `Script Properties belum diset: ${missing.join(', ')}`,
  );
  const override = platform_().getProperty('OAUTH_REDIRECT_URI')?.trim();
  lines.push(
    override
      ? `Redirect URI OAuth: override dari Script Property (${override}).`
      : 'Redirect URI OAuth: otomatis dari URL web app (daftarkan URL /dev dan /exec di Google Cloud).',
  );
  if (missing.includes('SPREADSHEET_ID')) {
    lines.push('Pembuatan sheet dilewati karena SPREADSHEET_ID belum diset.');
    return lines.join('\n');
  }
  const tables = [
    USERS_TABLE,
    ROLES_TABLE,
    AUDIT_TABLE,
    LOCATIONS_TABLE,
    FILES_TABLE,
    BRANDS_TABLE,
    ITEMS_TABLE,
    SYNC_STATE_TABLE,
    CUSTOMERS_TABLE,
    HANDOVERS_TABLE,
    QR_DESIGNS_TABLE,
    QR_DOCUMENTS_TABLE,
    QR_DEFAULTS_TABLE,
    QR_PRESETS_TABLE,
  ];
  for (const table of tables) {
    openTable_(table);
    lines.push(`Sheet "${table.sheetName}" siap.`);
  }
  // Seluruh kolom diformat teks sekali di sini; sesudahnya tulis tidak perlu memformat per baris (lebih cepat).
  for (const table of tables) applyTextFormats_(table);
  platform_().setProperty(TEXT_FORMATS_PROPERTY, '1');
  lines.push('Format teks kolom diterapkan pada semua sheet.');
  const presets = migrateQrDefaults_();
  if (presets > 0) {
    lines.push('qr_presets: default tunggal lama dimigrasi menjadi konfigurasi default "Default".');
  }
  const migrated = migrateAuditDetail_();
  if (migrated > 0) lines.push(`audit_log: ${migrated} baris lama dimigrasi ke before/after.`);
  const assigned = migrateUserAssignments_();
  if (assigned > 0)
    lines.push(`users: ${assigned} user lama dimigrasi ke penugasan "Semua lokasi".`);
  const revisions = platform_().withLock(() => assignInitialRevs_());
  if (revisions > 0) lines.push(`sync: ${revisions} baris diberi revisi sinkron.`);
  try {
    const folderId = ensureDriveFolder_();
    lines.push(`Folder Drive "${DRIVE_FOLDER_NAME}" siap (${folderId}).`);
  } catch (error) {
    const property = platform_().getProperty('DRIVE_FOLDER_ID')?.trim() ?? '';
    lines.push(
      `Folder Drive TIDAK dapat diakses (${property}). Properti DRIVE_FOLDER_ID tidak diubah. ` +
        'Periksa: akun pemilik script punya akses Editor ke folder itu dan folder tidak di tempat sampah; ' +
        'atau kosongkan DRIVE_FOLDER_ID agar folder baru dibuat (gambar lama tidak akan tampil).',
    );
    platform_().logError(`setup: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const [label, ensure, property] of [
    [QR_FOLDER_NAME, ensureQrFolder_, 'QR_FOLDER_ID'],
    [QR_DOC_FOLDER_NAME, ensureQrDocFolder_, 'QR_DOC_FOLDER_ID'],
  ] as const) {
    try {
      lines.push(`Folder Drive "${label}" siap (${ensure()}).`);
    } catch (error) {
      const current = platform_().getProperty(property)?.trim() ?? '';
      lines.push(
        `Folder Drive "${label}" TIDAK dapat diakses (${current}). Properti ${property} tidak diubah; periksa akses akun pemilik script atau kosongkan properti agar folder baru dibuat.`,
      );
      platform_().logError(`setup: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const token = syncToken_();
  if (token === '') {
    lines.push('SYNC_API_TOKEN belum diset: sinkronisasi QC Desktop nonaktif.');
  } else if (token.length < SYNC_TOKEN_MIN_LENGTH) {
    lines.push(
      `SYNC_API_TOKEN kurang dari ${SYNC_TOKEN_MIN_LENGTH} karakter: sinkronisasi dinonaktifkan sampai token diperpanjang.`,
    );
  } else {
    lines.push(`SYNC_API_TOKEN terisi (${token.length} karakter).`);
  }
  return lines.join('\n');
}
