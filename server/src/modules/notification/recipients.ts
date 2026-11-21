import { normalizeEmail } from '@server/core/email';
import type { Env } from '@server/core/env';
import { deletedWhere, liveWhere } from '@server/core/soft-delete';
import { loadActiveUserContexts, type UserContext } from '@server/modules/access/context';
import { canReadSerial } from '@server/modules/serial/access';
import { isSerialNotificationKind, type NotificationSide } from '@shared/notifications';
import { hasLevel } from '@shared/permissions';

/**
 * Penentuan penerima notifikasi Serah Terima (spek §3): dihitung dari izin berlokasi yang sudah ada lewat
 * `loadUserContext` (satu definisi hak akses), tanpa tabel pelanggan. Sisi QC = `qc: edit`, sisi WH =
 * `handover: view` ke atas, `all` = salah satunya, semuanya di lokasi task (hanya lokasi aktif: `locations`
 * milik konteks hanya memuat lokasi aktif).
 */

export interface Recipient {
  email: string;
  name: string;
}

function isQcSide(user: Pick<UserContext, 'locations'>, locationId: string): boolean {
  const perms = user.locations[locationId];
  return perms !== undefined && hasLevel(perms.qc, 'edit');
}

function isWhSide(user: Pick<UserContext, 'locations'>, locationId: string): boolean {
  const perms = user.locations[locationId];
  return perms !== undefined && hasLevel(perms.handover, 'view');
}

/**
 * Berhak membaca task (dan notifikasinya) di lokasi itu: `handover` minimal `view` ATAU `qc: edit`; sama dengan
 * izin baca task dan komentar. Dipakai lonceng (saat dibaca) dan push (saat kirim).
 */
export function hasReadAccess(user: Pick<UserContext, 'locations'>, locationId: string): boolean {
  return isWhSide(user, locationId) || isQcSide(user, locationId);
}

/**
 * Berhak membaca notifikasi Serial Number: BU serial entrinya (`serials.bu_id`) termasuk BU yang masih boleh dibaca
 * pengguna (`serial`/`serialservice: view`); entri yang sudah tak ada atau terhapus = tidak berhak. Tak bergantung pada lokasi atau
 * izin Serah Terima.
 */
export async function hasSerialReadAccess(
  env: Env,
  user: UserContext,
  serialId: string,
): Promise<boolean> {
  if (serialId === '') return false;
  const row = await env.DB.prepare(`SELECT bu_id FROM serials WHERE ${liveWhere()} AND id = ?`)
    .bind(serialId)
    .first<{ bu_id: string }>();
  // BU saat ini ATAU BU di riwayat serial (spek serial unik se-sistem §5.3).
  return row !== null && (await canReadSerial(env.DB, user, serialId, row.bu_id.trim()));
}

/** Task Serah Terima sudah dihapus (soft delete): notifikasinya tersembunyi bagi semua sampai dipulihkan. */
async function handoverIsDeleted(env: Env, handoverId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS ok FROM handovers WHERE ${deletedWhere()} AND id = ?`,
  )
    .bind(handoverId)
    .first<{ ok: number }>();
  return row !== null;
}

/**
 * Berhak membaca satu notifikasi (aturan sadar jenis): Serial = BU serial entri (serial hidup), selain itu lokasi Serah
 * Terima dan task yang belum dihapus (`handover_id` kosong = ringkasan batch tanpa task tunggal).
 */
export async function canReadNotification(
  env: Env,
  user: UserContext,
  row: { kind: string; location_id: string; serial_id: string; handover_id?: string },
): Promise<boolean> {
  if (isSerialNotificationKind(row.kind)) return hasSerialReadAccess(env, user, row.serial_id);
  if (!hasReadAccess(user, row.location_id)) return false;
  if (row.handover_id === undefined || row.handover_id === '') return true;
  return !(await handoverIsDeleted(env, row.handover_id));
}

function onSide(
  user: Pick<UserContext, 'locations'>,
  locationId: string,
  side: NotificationSide,
): boolean {
  if (side === 'qc') return isQcSide(user, locationId);
  if (side === 'wh') return isWhSide(user, locationId);
  return hasReadAccess(user, locationId);
}

/**
 * Penerima aktif untuk satu kejadian di `locationId`: semua user `status = 'active'` yang berhak pada `side`,
 * tanpa `excludeEmail` (pelaku; dibandingkan ternormalisasi) dan tanpa email ganda (user di dua sisi = satu
 * notifikasi). Admin super yang tidak punya baris di `users` tidak ikut.
 */
export async function resolveRecipients(
  env: Env,
  input: { locationId: string; side: NotificationSide; excludeEmail: string },
): Promise<Recipient[]> {
  const exclude = normalizeEmail(input.excludeEmail);
  // Dua kueri untuk semua user aktif (tabel peran/lokasi/BU dimuat sekali), bukan satu kueri per user.
  const contexts = await loadActiveUserContexts(env);
  const recipients: Recipient[] = [];
  const seen = new Set<string>();
  for (const user of contexts) {
    if (user.email === exclude || seen.has(user.email)) continue;
    if (!onSide(user, input.locationId, input.side)) continue;
    seen.add(user.email);
    recipients.push({ email: user.email, name: user.name });
  }
  return recipients;
}
