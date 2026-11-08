import type { Db } from '@server/core/db';
import { legacyBuAssignments } from '@shared/business-units';
import type { PartialPermissionMap } from '@shared/permissions';
import { sanitizePermissions } from '@shared/permissions';
import { readAssignments } from './context';

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

interface PendingUser {
  id: string;
  role_ids: string;
  assignments: string;
}

/**
 * Backfill hak lama saat rilis BU: `item` tidak lagi dihitung dari penugasan lokasi, jadi setiap user yang
 * `bu_assignments`-nya belum pernah diisi (`''`) mendapat penugasan "Semua BU" berisi gabungan role dari seluruh
 * penugasan lokasinya bila ada role yang memberi level `item`, selain itu `'[]'` (hak `item` mereka tetap sama dengan
 * sebelum rilis).
 *
 * Idempoten dan aman serentak: hanya baris `bu_assignments = ''` yang dibaca dan `UPDATE` menjaga syarat yang sama,
 * jadi baris yang sudah terisi (termasuk `'[]'`) tak pernah ditimpa. Mengembalikan jumlah baris yang benar-benar
 * ditulis.
 */
export async function backfillBuAssignments(db: Db): Promise<number> {
  const pending = (
    await db
      .prepare("SELECT id, role_ids, assignments FROM users WHERE bu_assignments = ''")
      .all<PendingUser>()
  ).results;
  if (pending.length === 0) return 0;
  const roles = (
    await db.prepare('SELECT id, permissions FROM roles').all<{
      id: string;
      permissions: string;
    }>()
  ).results;
  const rolePermissions = new Map<string, PartialPermissionMap>(
    roles.map((role) => [role.id, sanitizePermissions(parseJson(role.permissions))]),
  );
  let written = 0;
  for (const user of pending) {
    const value = JSON.stringify(legacyBuAssignments(readAssignments(user), rolePermissions));
    const result = await db
      .prepare("UPDATE users SET bu_assignments = ? WHERE id = ? AND bu_assignments = ''")
      .bind(value, user.id)
      .run();
    written += result.meta.changes;
  }
  return written;
}
