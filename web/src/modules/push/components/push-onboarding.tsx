import { useQuery } from '@tanstack/react-query';
import { BellOff } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
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
  pushAvailable,
  reenableSteps,
} from '../lib/support';
import { syncThisDevice } from '../lib/sync';
import { pushConfigQueryOptions, reportPushPermission } from '../queries';

/** Batas percobaan penautan yang gagal per pemasangan komponen (mis. host layanan push ditolak server). */
const MAX_SYNC_FAILURES = 3;

// Status "dialog/banner onboarding sedang (atau akan segera) tampil", dibaca komponen lain (mis. sapaan panduan)
// agar tidak menumpuk dua dialog sekaligus. Diisi `PushOnboarding` lewat layout effect supaya pembaca tak sempat
// merender satu bingkai pun dengan nilai usang.
let blockingActive = false;
const blockingListeners = new Set<() => void>();

function setBlockingActive(value: boolean): void {
  if (blockingActive === value) return;
  blockingActive = value;
  for (const listener of blockingListeners) listener();
}

function subscribeBlocking(listener: () => void): () => void {
  blockingListeners.add(listener);
  return () => {
    blockingListeners.delete(listener);
  };
}

/**
 * True selama `PushOnboarding` menampilkan dialog pra-izin atau banner izin ditolak, atau akan menampilkannya
 * (konfigurasi push belum termuat, atau syaratnya terpenuhi dan efeknya belum jalan). Tanpa `PushOnboarding`
 * terpasang nilainya false.
 */
export function useBlockingOnboardingActive(): boolean {
  return useSyncExternalStore(
    subscribeBlocking,
    () => blockingActive,
    () => false,
  );
}

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
      data-app-banner=""
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
      <Button size="sm" variant="ghost" color="primary" onClick={onClose}>
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
  const { data: config, isPending: configPending } = useQuery(pushConfigQueryOptions());
  const [permission, setPermission] = useState<DevicePermission>(() => devicePermission());
  const [askOpen, setAskOpen] = useState(false);
  const [bannerOpen, setBannerOpen] = useState(false);
  // Efek pembuka dialog/banner sudah memutuskan (lihat `blocking`).
  const [askEvaluated, setAskEvaluated] = useState(false);
  const [bannerEvaluated, setBannerEvaluated] = useState(false);
  const [busy, setBusy] = useState(false);
  // Naik tiap jendela fokus: memberi kesempatan mencoba lagi penautan yang gagal dalam sesi yang sama.
  const [focusTick, setFocusTick] = useState(0);
  const reported = useRef<string | null>(null);
  const syncing = useRef(false);
  const syncFailures = useRef(0);

  useEffect(() => {
    const refresh = () => {
      setPermission(devicePermission());
      // Hanya saat terlihat: berpindah ke latar (visibilitychange hidden) tidak boleh memicu percobaan ulang.
      if (document.visibilityState === 'visible') setFocusTick((tick) => tick + 1);
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  const active = pushAvailable(config, permission);
  const userEnabled = config?.userEnabled === true;

  // Sinyal untuk komponen lain (lihat `useBlockingOnboardingActive`): dialog/banner benar-benar terbuka (state),
  // atau syaratnya terpenuhi dan efek yang memutuskan membukanya belum sempat jalan (`*Evaluated`, state agar
  // render ulang terjadi begitu efek selesai). Sengaja TIDAK membaca ulang storage tiap render: bila penyimpanan
  // terblokir, penanda "sudah ditanya/ditampilkan" tak pernah tersimpan dan sinyal akan macet true.
  const askCandidate = active && permission === 'default' && userEnabled && isStandalone(window);
  const askPending = askCandidate && !askEvaluated;
  const bannerPending = active && permission === 'denied' && userEnabled && !bannerEvaluated;
  const blocking =
    configPending ||
    askOpen ||
    askPending ||
    bannerPending ||
    (bannerOpen && permission === 'denied');
  useLayoutEffect(() => {
    setBlockingActive(blocking);
  }, [blocking]);
  useLayoutEffect(() => () => setBlockingActive(false), []);

  // Laporkan izin peramban ke server sekali per nilai per sesi. Hanya dari PWA terpasang (konteks yang memang diminta
  // izin) dan tanpa `default`: tab peramban lain atau perangkat lain milik pengguna yang sama tidak boleh menimpa
  // satu nilai per pengguna di server (mis. `denied` dari ponsel tertimpa `default` dari tab desktop).
  useEffect(() => {
    // `unsupported` sudah tersingkir oleh `active` (`pushAvailable`); diulang agar tipenya menyempit.
    if (!active || permission === 'default' || permission === 'unsupported') return;
    if (!isStandalone(window)) return;
    const marker = `${email}:${permission}`;
    if (reported.current === marker) return;
    reported.current = marker;
    reportPushPermission(permission).catch(() => {
      reported.current = null;
    });
  }, [active, permission, email]);

  // Izin sudah ada: tautkan perangkat ke akun ini (idempoten), sekali per sesi tab.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `focusTick` sengaja hanya pemicu percobaan ulang
  useEffect(() => {
    if (!active || !config || permission !== 'granted' || !userEnabled) return;
    if (wasSynced(email) || syncing.current || syncFailures.current >= MAX_SYNC_FAILURES) return;
    syncing.current = true;
    syncThisDevice(config, email)
      .then((result) => {
        if (result === 'subscribed') markSynced(email);
        else syncFailures.current += 1;
      })
      .catch(() => {
        // Gagal berlangganan (layanan push tak terjangkau, dsb.): dicoba lagi saat jendela fokus, paling banyak
        // `MAX_SYNC_FAILURES` kali per pemasangan; selebihnya pada sesi berikutnya.
        syncFailures.current += 1;
      })
      .finally(() => {
        syncing.current = false;
      });
  }, [active, config, permission, userEnabled, email, focusTick]);

  // Dialog pra-izin: hanya PWA terpasang, izin belum pernah ditentukan, dan belum pernah ditanya.
  useEffect(() => {
    if (!active || permission !== 'default' || !userEnabled) return;
    if (!isStandalone(window)) return;
    setAskEvaluated(true);
    if (wasAsked(email)) return;
    setAskOpen(true);
  }, [active, permission, userEnabled, email]);

  // Banner izin ditolak: dicatat saat ditampilkan, jadi muat ulang tidak menampilkannya lagi dalam 7 hari.
  useEffect(() => {
    if (!active || permission !== 'denied' || !userEnabled) return;
    setBannerEvaluated(true);
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
            <Button variant="outline" color="primary" onClick={dismissAsk}>
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
