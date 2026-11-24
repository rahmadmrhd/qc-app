import type { NotificationDto } from '@shared/notifications';
import { isSerialNotificationKind, notificationTitle } from '@shared/notifications';
import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsMobile } from '@/hooks/use-mobile';
import { formatStamp } from '@/lib/format-stamp';
import { runAfterOverlays } from '@/lib/nav-stack';
import { cn } from '@/lib/utils';
import { useTourMenu } from '@/modules/guide/lib/tour-menu';
import { notificationsQueryOptions, useMarkAllRead } from './queries';
import { useNotificationStream } from './stream';
import { useNotificationToasts } from './toast';
import { useOpenNotification } from './use-open-notification';

/** Jumlah pada ikon dibatasi agar tidak melebar. */
const BADGE_MAX = 99;

/**
 * Lonceng notifikasi di header (Serah Terima dan Serial Number): jumlah belum dibaca, daftar terbaru, tandai dibaca, dan
 * buka task atau Serial Number terkait. Selalu bekerja (tanpa izin peramban). Cuplikan `preview` ditampilkan sebagai teks biasa.
 * Desktop = popover; ponsel (< 768 px, P9) = lembar bawah dengan tombol kembali menutupnya.
 */
export function NotificationBell() {
  const tourMenu = useTourMenu('notification-bell');
  const setOpen = tourMenu.setOpen;
  const query = useQuery(notificationsQueryOptions());
  useNotificationStream();
  useNotificationToasts();
  const open = useOpenNotification();
  const markAll = useMarkAllRead();
  const phone = useIsMobile();
  const unread = query.data?.unread ?? 0;
  const items = query.data?.items ?? [];

  const openItem = (item: NotificationDto) => {
    if (phone) {
      // Lembar dilepas dari riwayat lebih dulu (`runAfterOverlays` menutupnya), baru berpindah halaman.
      runAfterOverlays(() => open(item));
      return;
    }
    setOpen(false);
    open(item);
  };

  const trigger = (
    <Button
      variant="ghost"
      color="primary"
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
  );

  const body = (
    <>
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <h2 className="text-sm font-medium">Notifikasi</h2>
        <Button
          variant="ghost"
          color="primary"
          size="sm"
          disabled={unread === 0 || markAll.isPending}
          onClick={() => markAll.mutate()}
        >
          Tandai semua dibaca
        </Button>
      </div>
      <div className={cn('overflow-y-auto', phone ? 'min-h-0 flex-1' : 'max-h-96')}>
        {query.isPending ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : query.isError ? (
          <p role="alert" className="p-4 text-sm text-destructive-text">
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
                        {formatStamp(item.createdAt)}
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
    </>
  );

  if (phone) {
    return (
      <Sheet {...tourMenu.rootProps}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="max-h-[85dvh] gap-0 p-0 pb-[env(safe-area-inset-bottom)]"
          data-tour="notification-menu"
          {...tourMenu.contentProps}
        >
          <SheetTitle className="sr-only">Notifikasi</SheetTitle>
          <SheetDescription className="sr-only">Daftar notifikasi terbaru.</SheetDescription>
          {body}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover {...tourMenu.rootProps}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 gap-0 p-0 sm:w-96"
        data-tour="notification-menu"
        {...tourMenu.contentProps}
      >
        {body}
      </PopoverContent>
    </Popover>
  );
}
