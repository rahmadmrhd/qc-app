import type { Env } from '@server/core/env';
import { nowIso } from '@server/core/env';
import { appError } from '@server/core/errors';
import type { UserContext } from '@server/modules/access/context';
import { readableBuIds } from '@server/modules/serial/access';
import type { ListNotificationsInput, NotificationListDto } from '@shared/contract';
import { hasReadAccess } from './recipients';
import { countUnread, listNotifications, markAllRead, markRead } from './repo';
import { NOTIFICATION_PAGE_DEFAULT } from './validate';

/**
 * Lonceng notifikasi. Kotak notifikasi milik pengguna sendiri (kunci email ternormalisasi). Hak akses diperiksa
 * SAAT DIBACA (spek §5.1): lokasi yang boleh dibaca dihitung dari konteks akses saat ini (`ctx.user.locations`
 * hanya memuat lokasi aktif; `hasReadAccess` = `handover: view` atau `qc: edit`; jenis Serial Number: BU serial entrinya masih terbaca), sehingga pengguna yang kehilangan
 * akses lokasi tidak melihat sisa notifikasinya dan hitungan belum dibaca ikut turun.
 */
function readableLocationIds(user: Pick<UserContext, 'locations'>): string[] {
  return Object.keys(user.locations).filter((id) => hasReadAccess(user, id));
}

export async function listForUser(
  env: Env,
  user: UserContext,
  input: ListNotificationsInput,
): Promise<NotificationListDto> {
  const locationIds = readableLocationIds(user);
  // Jenis Serial Number mengikuti BU serial yang masih terbaca (bukan izin/lokasi Serah Terima).
  const serialBuIds = readableBuIds(user);
  const [page, unread] = await Promise.all([
    listNotifications(env, user.email, {
      locationIds,
      serialBuIds,
      limit: input.limit ?? NOTIFICATION_PAGE_DEFAULT,
      before: input.before,
    }),
    countUnread(env, user.email, locationIds, serialBuIds),
  ]);
  return { items: page.items, unread, nextCursor: page.nextCursor };
}

/** `NOT_FOUND` bila id bukan milik pemanggil atau tak ada (tak membedakan, agar tak membocorkan keberadaan). */
export async function markNotificationRead(
  env: Env,
  user: UserContext,
  id: string,
): Promise<{ ok: true }> {
  if (!(await markRead(env, user.email, id, nowIso(env)))) {
    throw appError('NOT_FOUND', 'Notifikasi tidak ditemukan');
  }
  return { ok: true };
}

export async function markAllNotificationsRead(
  env: Env,
  user: UserContext,
): Promise<{ count: number }> {
  return { count: await markAllRead(env, user.email, nowIso(env)) };
}
