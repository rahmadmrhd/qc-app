import type { NotificationDto } from '@shared/notifications';
import { notificationTitle } from '@shared/notifications';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { notificationsQueryOptions } from './queries';
import { useOpenNotification } from './use-open-notification';

/** Lebih dari ini sekaligus (mis. kembali dari tidur) digabung menjadi satu toast ringkasan. */
export const TOAST_MAX = 3;
/** Lama toast tampil (milidetik); cukup untuk dibaca dan diklik, tidak menutupi layar. */
export const TOAST_DURATION_MS = 8_000;

/**
 * Notifikasi yang belum pernah dilihat tab ini (id tidak ada di `seen`) DAN belum dibaca. Mengisi `seen` dengan
 * SEMUA id daftar, termasuk yang sudah dibaca, sehingga tak ada yang ditampilkan dua kali.
 */
export function takeFresh(items: NotificationDto[], seen: Set<string>): NotificationDto[] {
  const fresh = items.filter((item) => !seen.has(item.id) && item.readAt === '');
  for (const item of items) seen.add(item.id);
  return fresh;
}

/**
 * Toast "notifikasi baru" selama lonceng terpasang (keputusan pemilik 2026-11-16). Dasarnya daftar lonceng yang sudah
 * diperbarui seketika (SSE/jembatan desktop/polling), jadi tak ada saluran data baru:
 * - Pemuatan pertama hanya mengisi baseline: membuka aplikasi tak memunculkan toast untuk riwayat.
 * - Hanya tab yang TERLIHAT yang menampilkan toast (banyak tab = satu toast per jendela); yang tiba saat tersembunyi
 *   tetap tercatat di lonceng dan, bila aktif, lewat push, lalu dianggap sudah dilihat.
 * - Id toast = id notifikasi, jadi pemuatan ulang yang sama tak menggandakan toast.
 */
export function useNotificationToasts(): void {
  const query = useQuery(notificationsQueryOptions());
  const open = useOpenNotification();
  const openRef = useRef(open);
  openRef.current = open;
  const seenRef = useRef<Set<string> | null>(null);
  const items = query.data?.items;

  useEffect(() => {
    if (items === undefined) return;
    if (seenRef.current === null) {
      seenRef.current = new Set(items.map((item) => item.id));
      return;
    }
    const fresh = takeFresh(items, seenRef.current);
    if (fresh.length === 0 || document.visibilityState !== 'visible') return;
    if (fresh.length > TOAST_MAX) {
      toast(`${fresh.length} notifikasi baru`, { duration: TOAST_DURATION_MS });
      return;
    }
    // Daftar terbaru di atas; toast ditampilkan dari yang tertua supaya yang terbaru berada di atas tumpukan.
    for (const item of [...fresh].reverse()) {
      const detail =
        item.preview !== ''
          ? item.preview
          : item.customerName !== '' && item.kind !== 'createdBatch'
            ? item.customerName
            : undefined;
      toast(notificationTitle(item), {
        id: `notif-${item.id}`,
        description: detail,
        duration: TOAST_DURATION_MS,
        action: { label: 'Buka', onClick: () => openRef.current(item) },
      });
    }
  }, [items]);
}
