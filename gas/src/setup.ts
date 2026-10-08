import { missingConfigKeys_ } from '@gas/core/config';
import { openTable_ } from '@gas/core/db';
import {
  AUDIT_TABLE,
  migrateAuditDetail_,
  ROLES_TABLE,
  USERS_TABLE,
} from '@gas/modules/access/repo';

export function runSetup_(): string {
  const lines: string[] = [];
  const missing = missingConfigKeys_();
  lines.push(
    missing.length === 0
      ? 'Script Properties lengkap.'
      : `Script Properties belum diset: ${missing.join(', ')}`,
  );
  if (missing.includes('SPREADSHEET_ID')) {
    lines.push('Pembuatan sheet dilewati karena SPREADSHEET_ID belum diset.');
    return lines.join('\n');
  }
  for (const table of [USERS_TABLE, ROLES_TABLE, AUDIT_TABLE]) {
    openTable_(table);
    lines.push(`Sheet "${table.sheetName}" siap.`);
  }
  const migrated = migrateAuditDetail_();
  if (migrated > 0) lines.push(`audit_log: ${migrated} baris lama dimigrasi ke before/after.`);
  return lines.join('\n');
}
