import type { PushConfigDto } from '@shared/contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { isIosBrowser, isStandalone } from '@/app/pwa/install';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/modules/auth/use-me';
import { markAsked, markSynced, SYNCED_EVENT, wasSynced } from '../lib/storage';
import { getPushRegistration } from '../lib/subscribe';
import { type DevicePermission, devicePermission, platformOf, reenableSteps } from '../lib/support';
import { syncThisDevice } from '../lib/sync';
import { pushConfigQueryOptions, reportPushPermission, usePushPreference } from '../queries';

export type DeviceKind =
  | 'server-off'
  | 'ios-install'
  | 'unsupported'
  | 'denied'
  | 'default'
  | 'checking'
  | 'linked'
  | 'unlinked';

/** Status push perangkat ini. `linked` = langganan peramban ada (undefined = belum selesai diperiksa). */
export function deviceKind(input: {
  config: PushConfigDto;
  permission: DevicePermission;
  standalone: boolean;
  ios: boolean;
  linked: boolean | undefined;
}): DeviceKind {
  if (!input.config.enabled) return 'server-off';
  if (input.permission === 'unsupported') {
    return input.ios && !input.standalone ? 'ios-install' : 'unsupported';
  }
  if (input.permission === 'denied') return 'denied';
  if (input.permission === 'default') return 'default';
  if (input.linked === undefined) return 'checking';
  return input.linked ? 'linked' : 'unlinked';
}

const DEVICE_TEXT: Record<Exclude<DeviceKind, 'denied'>, string> = {
  'server-off': 'Notifikasi push belum disiapkan di server. Lonceng tetap jalan seperti biasa.',
  'ios-install':
    'Di iPhone/iPad, notifikasi push hanya jalan setelah aplikasi dipasang ke layar utama (Bagikan, lalu Tambahkan ke Layar Utama). Buka dari ikon di layar utama, lalu coba lagi.',
  unsupported: 'Peramban ini belum mendukung notifikasi push. Lonceng tetap jalan seperti biasa.',
  default: 'Belum diaktifkan di perangkat ini.',
  checking: 'Memeriksa perangkat ini…',
  linked: 'Aktif di perangkat ini.',
  unlinked: 'Izin sudah diberikan, tetapi perangkat ini belum tertaut ke akunmu.',
};

/**
 * Pengaturan notifikasi push pengguna (dari menu profil): saklar preferensi (lonceng tak ikut terpengaruh), status
 * perangkat ini, dan tombol aktifkan (butuh gestur pengguna, jadi izin peramban hanya diminta dari klik di sini).
 */
export function PushSettingsDialog({ onClose }: { onClose: () => void }) {
  const { email } = useMe();
  const queryClient = useQueryClient();
  const config = useQuery(pushConfigQueryOptions());
  const preference = usePushPreference();
  const [permission, setPermission] = useState<DevicePermission>(() => devicePermission());
  const standalone = isStandalone(window);
  const ios = isIosBrowser(navigator);

  const device = useQuery({
    queryKey: ['push', 'device'],
    enabled: permission === 'granted',
    queryFn: async () => {
      const registration = await getPushRegistration();
      return (await registration?.pushManager.getSubscription()) != null;
    },
  });

  const activate = useMutation({
    mutationFn: async (current: PushConfigDto) => {
      markAsked(email);
      let result = devicePermission();
      if (result === 'default') result = await window.Notification.requestPermission();
      if (result === 'unsupported') throw new Error('push tidak didukung');
      setPermission(result);
      // Sama seperti onboarding: hanya dari PWA terpasang dan tanpa `default`, agar tab peramban tidak menimpa nilai
      // satu pengguna di server dari perangkat lain.
      if (result !== 'default' && isStandalone(window)) {
        reportPushPermission(result).catch(() => undefined);
      }
      if (result === 'granted') {
        if ((await syncThisDevice(current, email)) === 'unavailable')
          throw new Error('langganan gagal');
        markSynced(email);
      }
      return result;
    },
    onSuccess: (result) => {
      if (result === 'granted') toast.success('Notifikasi push aktif di perangkat ini');
      void queryClient.invalidateQueries({ queryKey: ['push', 'device'] });
    },
    onError: () => toast.error('Gagal mengaktifkan notifikasi push. Coba lagi nanti.'),
  });

  // Penautan oleh onboarding (atau tombol di sini) selesai saat dialog terbuka: segarkan status.
  const [, setSyncTick] = useState(0);
  useEffect(() => {
    const onSynced = () => {
      setSyncTick((tick) => tick + 1);
      void queryClient.invalidateQueries({ queryKey: ['push', 'device'] });
    };
    window.addEventListener(SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SYNCED_EVENT, onSynced);
  }, [queryClient]);

  // Tertaut = ada langganan peramban DAN sudah disinkronkan ke akun ini pada sesi ini; langganan milik akun lain di
  // perangkat yang sama tidak cukup (akun ini belum tentu punya barisnya di server).
  const linked = device.data === undefined ? undefined : device.data && wasSynced(email);
  const data = config.data;
  const kind =
    data === undefined
      ? undefined
      : deviceKind({ config: data, permission, standalone, ios, linked: linked });
  // Preferensi dimatikan: status tertaut/belum tertaut tak relevan (dan menyesatkan), tampilkan alasannya saja.
  const pushOff =
    data !== undefined &&
    !data.userEnabled &&
    (kind === 'default' || kind === 'checking' || kind === 'linked' || kind === 'unlinked');
  const canActivate = kind === 'default' || kind === 'unlinked';

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Notifikasi push</DialogTitle>
          <DialogDescription>
            Kabar task baru, komentar, dan perubahan langsung ke perangkatmu. Lonceng di header
            selalu aktif dan tidak ikut terpengaruh.
          </DialogDescription>
        </DialogHeader>
        {data === undefined || kind === undefined ? (
          config.isError ? (
            <p role="alert" className="text-sm text-destructive">
              Gagal memuat pengaturan notifikasi push.
            </p>
          ) : (
            <Skeleton className="h-16 w-full" />
          )
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id="push-preference"
                checked={data.userEnabled}
                disabled={!data.enabled || preference.isPending}
                onCheckedChange={(value) => preference.mutate(value === true)}
              />
              <Label htmlFor="push-preference">Terima notifikasi push</Label>
            </div>
            <div className="rounded-md border p-3 text-sm" data-testid="push-device-status">
              <p className="font-medium">Perangkat ini</p>
              <p className="text-muted-foreground">
                {kind === 'denied'
                  ? `Izin ditolak di peramban. ${reenableSteps(platformOf())}`
                  : pushOff
                    ? 'Push sedang dimatikan untuk akunmu; nyalakan kotak di atas untuk menerimanya.'
                    : DEVICE_TEXT[kind]}
              </p>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Tutup
          </Button>
          {data?.userEnabled && canActivate && (
            <Button onClick={() => activate.mutate(data)} disabled={activate.isPending}>
              Aktifkan di perangkat ini
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
