import type { NotificationDto } from '@shared/notifications';
import { isSerialNotificationKind, notificationTitle } from '@shared/notifications';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useTourMenu } from '@/modules/guide/lib/tour-menu';
import { notificationsQueryOptions, useMarkAllRead, useMarkRead } from './queries';

/** Jumlah pada ikon dibatasi agar tidak melebar. */
const BADGE_MAX = 99;

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Lonceng notifikasi di header (Serah Terima dan Serial Number): jumlah belum dibaca, daftar terbaru, tandai dibaca, dan
 * buka task atau Serial Number terkait. Selalu bekerja (tanpa izin peramban). Cuplikan `preview` ditampilkan sebagai teks biasa.
 */
export function NotificationBell() {
  const tourMenu = useTourMenu('notification-bell');
  const setOpen = tourMenu.setOpen;
  const navigate = useNavigate();
  const query = useQuery(notificationsQueryOptions());
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const unread = query.data?.unread ?? 0;
  const items = query.data?.items ?? [];

  const openItem = (item: NotificationDto) => {
    if (item.readAt === '') markRead.mutate(item.id);
    setOpen(false);
    // Jenis Serial Number membuka detail Serial Number (akses mengikuti BU, tanpa `loc` lokasi Serah Terima).
    if (isSerialNotificationKind(item.kind)) {
      if (item.serialId === '') void navigate({ to: '/serial' });
      else void navigate({ to: '/serial/$serialId', params: { serialId: item.serialId } });
      return;
    }
    // `loc` membawa lokasi notifikasi: halaman memuat task/papan lokasi itu walau tidak terpilih di header.
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

  return (
    <Popover {...tourMenu.rootProps}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          data-tour="notification-bell"
          aria-label={unread > 0 ? `Notifikasi, ${unread} belum dibaca` : 'Notifikasi'}
        >
          <Bell />
          {unread > 0 ? (
            <span
              aria-hidden="true"
              className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none font-medium text-white"
            >
              {unread > BADGE_MAX ? `${BADGE_MAX}+` : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 gap-0 p-0 sm:w-96"
        data-tour="notification-menu"
        {...tourMenu.contentProps}
      >
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <h2 className="text-sm font-medium">Notifikasi</h2>
          <Button
            variant="ghost"
            size="sm"
            disabled={unread === 0 || markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            Tandai semua dibaca
          </Button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {query.isPending ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : query.isError ? (
            <p role="alert" className="p-4 text-sm text-destructive">
              Gagal memuat notifikasi.
            </p>
          ) : items.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">Belum ada notifikasi.</p>
          ) : (
            <ul>
              {items.map((item) => {
                const isUnread = item.readAt === '';
                return (
                  <li key={item.id} className="border-b last:border-b-0">
                    <button
                      type="button"
                      onClick={() => openItem(item)}
                      className={cn(
                        'flex w-full gap-2 px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none',
                        isUnread && 'bg-muted/40',
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'mt-1.5 size-2 shrink-0 rounded-full',
                          isUnread ? 'bg-primary' : 'bg-transparent',
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className={cn('block', isUnread && 'font-medium')}>
                          {notificationTitle(item)}
                        </span>
                        {isSerialNotificationKind(item.kind) ? (
                          // Jenis Serial: baris isi = nomor Serial Number saja.
                          item.number !== '' ? (
                            <span className="block truncate font-mono text-muted-foreground">
                              {item.number}
                            </span>
                          ) : null
                        ) : item.customerName !== '' && item.kind !== 'createdBatch' ? (
                          <span className="block truncate text-muted-foreground">
                            {item.customerName}
                          </span>
                        ) : null}
                        {item.preview !== '' ? (
                          <span className="line-clamp-2 block text-muted-foreground">
                            {item.preview}
                          </span>
                        ) : null}
                        <span className="block text-xs text-muted-foreground">
                          {formatTime(item.createdAt)}
                        </span>
                      </span>
                      {isUnread ? <span className="sr-only">Belum dibaca</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
