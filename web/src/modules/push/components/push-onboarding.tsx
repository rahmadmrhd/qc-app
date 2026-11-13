import { useQuery } from '@tanstack/react-query';
import { BellOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { isStandalone } from '@/app/pwa/install';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useMe } from '@/modules/auth/use-me';
import {
  bannerDue,
  markAsked,
  markBannerShown,
  markSynced,
  wasAsked,
  wasSynced,
} from '../lib/storage';
import {
  type DevicePermission,
  devicePermission,
  type PushPlatform,
  platformOf,
  reenableSteps,
} from '../lib/support';
import { syncThisDevice } from '../lib/sync';
import { pushConfigQueryOptions, reportPushPermission } from '../queries';

/** Spanduk pengingat saat izin notifikasi ditolak: lonceng tetap jalan, langkah menyalakan kembali menurut perangkat. */
export function DeniedBanner({
  platform,
  onClose,
}: {
  platform: PushPlatform;
  onClose: () => void;
}) {
  return (
    <div
      role="status"
      data-testid="push-denied-banner"
      className="flex items-start gap-3 border-b bg-muted/60 px-4 py-3 text-sm"
    >
      <BellOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Notifikasi push belum aktif di perangkat ini</p>
        <p className="text-muted-foreground">
          Lonceng di atas tetap menerima semuanya. Mau dapat kabar lebih cepat?{' '}
          {reenableSteps(platform)}
        </p>
      </div>
      <Button size="sm" variant="ghost" onClick={onClose}>
        Tutup
      </Button>
    </div>
  );
}

/**
 * Onboarding push (spek §5.2), dipasang sekali di cangkang aplikasi:
 * - izin `granted` dan preferensi aktif: menautkan perangkat ke akun diam-diam, sekali per sesi tab (akun kedua di
 *   perangkat yang sama ikut tertaut tanpa dialog);
 * - izin `default` pada PWA terpasang dan belum pernah ditanya: dialog pra-izin (gestur pengguna dibutuhkan peramban),
 *   izin peramban diminta SATU kali lewat tombol Aktifkan; Nanti/menutup = tak ditanya lagi di perangkat ini;
 * - izin `denied`: tidak pernah diminta ulang (peramban menyembunyikan dialog bila diminta berulang), banner pengingat
 *   paling sering sekali per 7 hari;
 * - izin peramban dilaporkan ke server tiap berubah (untuk status admin) dan dicek ulang saat jendela fokus.
 * Tidak merender apa pun bila push tak tersedia (server tanpa VAPID, peramban tanpa dukungan, preferensi dimatikan).
 */
export function PushOnboarding() {
  const { email } = useMe();
  const { data: config } = useQuery(pushConfigQueryOptions());
  const [permission, setPermission] = useState<DevicePermission>(() => devicePermission());
  const [askOpen, setAskOpen] = useState(false);
  const [bannerOpen, setBannerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const reported = useRef<string | null>(null);
  const syncing = useRef(false);

  useEffect(() => {
    const refresh = () => setPermission(devicePermission());
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  const active = config?.enabled === true && permission !== 'unsupported';
  const userEnabled = config?.userEnabled === true;

  // Laporkan izin peramban ke server sekali per nilai per sesi.
  useEffect(() => {
    if (!active || permission === 'unsupported') return;
    const marker = `${email}:${permission}`;
    if (reported.current === marker) return;
    reported.current = marker;
    reportPushPermission(permission).catch(() => {
      reported.current = null;
    });
  }, [active, permission, email]);

  // Izin sudah ada: tautkan perangkat ke akun ini (idempoten), sekali per sesi tab.
  useEffect(() => {
    if (!active || !config || permission !== 'granted' || !userEnabled) return;
    if (wasSynced(email) || syncing.current) return;
    syncing.current = true;
    syncThisDevice(config)
      .then((result) => {
        if (result === 'subscribed') markSynced(email);
      })
      .catch(() => {
        // Gagal berlangganan (layanan push tak terjangkau, dsb.): dicoba lagi pada sesi berikutnya.
      })
      .finally(() => {
        syncing.current = false;
      });
  }, [active, config, permission, userEnabled, email]);

  // Dialog pra-izin: hanya PWA terpasang, izin belum pernah ditentukan, dan belum pernah ditanya.
  useEffect(() => {
    if (!active || permission !== 'default' || !userEnabled) return;
    if (!isStandalone(window) || wasAsked(email)) return;
    setAskOpen(true);
  }, [active, permission, userEnabled, email]);

  // Banner izin ditolak: dicatat saat ditampilkan, jadi muat ulang tidak menampilkannya lagi dalam 7 hari.
  useEffect(() => {
    if (!active || permission !== 'denied' || !userEnabled) return;
    const now = Date.now();
    if (!bannerDue(email, now)) return;
    markBannerShown(email, now);
    setBannerOpen(true);
  }, [active, permission, userEnabled, email]);

  const dismissAsk = () => {
    markAsked(email);
    setAskOpen(false);
  };

  const enable = async () => {
    markAsked(email);
    setBusy(true);
    try {
      setPermission(await window.Notification.requestPermission());
    } catch {
      // Peramban menolak memunculkan dialog: biarkan izin apa adanya.
    } finally {
      setBusy(false);
      setAskOpen(false);
    }
  };

  return (
    <>
      {bannerOpen && permission === 'denied' && (
        <DeniedBanner platform={platformOf()} onClose={() => setBannerOpen(false)} />
      )}
      <Dialog
        open={askOpen}
        onOpenChange={(open) => {
          if (!open) dismissAsk();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aktifkan notifikasi?</DialogTitle>
            <DialogDescription>
              Dapat kabar task baru, komentar, dan perubahan langsung di perangkat ini, bahkan saat
              aplikasi sedang tertutup.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Setelah ini peramban akan menanyakan izin satu kali. Kamu bisa mengubahnya kapan saja
            dari menu profil. Lonceng di atas tetap jalan tanpa izin ini.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={dismissAsk}>
              Nanti
            </Button>
            <Button onClick={() => void enable()} disabled={busy}>
              Aktifkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
