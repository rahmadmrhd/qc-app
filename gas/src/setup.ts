import { missingConfigKeys_ } from '@gas/core/config';
import { openTable_ } from '@gas/core/db';
import { platform_ } from '@gas/core/platform';
import {
  AUDIT_TABLE,
  LOCATIONS_TABLE,
  migrateAuditDetail_,
  migrateUserAssignments_,
  ROLES_TABLE,
  USERS_TABLE,
} from '@gas/modules/access/repo';
import { FILES_TABLE } from '@gas/modules/files/repo';
import { DRIVE_FOLDER_NAME, ensureDriveFolder_ } from '@gas/modules/files/service';

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
  for (const table of [USERS_TABLE, ROLES_TABLE, AUDIT_TABLE, LOCATIONS_TABLE, FILES_TABLE]) {
    openTable_(table);
    lines.push(`Sheet "${table.sheetName}" siap.`);
  }
  const migrated = migrateAuditDetail_();
  if (migrated > 0) lines.push(`audit_log: ${migrated} baris lama dimigrasi ke before/after.`);
  const assigned = migrateUserAssignments_();
  if (assigned > 0)
    lines.push(`users: ${assigned} user lama dimigrasi ke penugasan "Semua lokasi".`);
  const folderId = ensureDriveFolder_();
  lines.push(`Folder Drive "${DRIVE_FOLDER_NAME}" siap (${folderId}).`);
  return lines.join('\n');
}
