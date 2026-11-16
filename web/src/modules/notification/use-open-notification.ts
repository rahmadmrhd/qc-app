import type { NotificationDto } from '@shared/notifications';
import { useNavigate } from '@tanstack/react-router';
import { useMarkRead } from './queries';

/**
 * Membuka task (atau papan, untuk `createdBatch`) yang dituju sebuah notifikasi dan menandainya dibaca. Dipakai
 * bersama oleh daftar lonceng dan toast notifikasi baru, supaya keduanya berperilaku sama.
 * `loc` membawa lokasi notifikasi: halaman memuat task/papan lokasi itu walau tidak terpilih di header.
 */
export function useOpenNotification(): (item: NotificationDto) => void {
  const navigate = useNavigate();
  const markRead = useMarkRead();
  return (item) => {
    if (item.readAt === '') markRead.mutate(item.id);
    if (item.handoverId === '') {
      void navigate({ to: '/handover', search: { loc: item.locationId } });
    } else {
      void navigate({
        to: '/handover/$handoverId',
        params: { handoverId: item.handoverId },
        search: { loc: item.locationId },
      });
    }
  };
}
