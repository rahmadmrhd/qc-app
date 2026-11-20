import { useRouterState } from '@tanstack/react-router';
import { useState } from 'react';
import { isNavParent, NAV_GROUPS } from '@/app/navigation';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useMe } from '@/modules/auth/use-me';
import { useBlockingOnboardingActive } from '@/modules/push/components/push-onboarding';
import { guideForRoute } from '../lib/guide-for-route';
import type { GuideOffer } from '../lib/offer';
import { useGuideStore } from '../lib/use-guide-store';
import { useOfferedGuides } from '../lib/use-offered-guides';
import { useTour } from './tour/tour-provider';

const LATER_KEY = 'qc.guide.later:';

function laterKey(email: string): string {
  return `${LATER_KEY}${email.trim().toLowerCase()}`;
}

/** Id panduan yang ditunda ("Nanti") dalam sesi tab ini; penyimpanan terblokir = kosong. */
function readLater(email: string): string[] {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(laterKey(email)) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeLater(email: string, ids: readonly string[]): void {
  try {
    sessionStorage.setItem(laterKey(email), JSON.stringify(ids));
  } catch {
    // Penyimpanan tak tersedia: banner tetap tersembunyi selama komponen ini hidup (state lokal).
  }
}

/** Label anak menu yang tak bermakna tanpa induknya ("Daftar", "Laporan", "Pengaturan"): dipakai bersama label induk. */
const GENERIC_CHILD_LABELS: ReadonlySet<string> = new Set(['Daftar', 'Laporan', 'Pengaturan']);

/**
 * Nama halaman untuk teks banner: label menu yang tujuannya `halaman` (label anak generik digabung dengan label
 * induknya, mis. "Daftar Serial Number"); selain itu judul panduan.
 */
export function pageLabelFor(halaman: string | undefined, title: string): string {
  for (const group of NAV_GROUPS) {
    for (const entry of group.items) {
      const children = isNavParent(entry) ? entry.children : [entry];
      const item = children.find((candidate) => candidate.to === halaman);
      if (!item) continue;
      return isNavParent(entry) && GENERIC_CHILD_LABELS.has(item.label)
        ? `${item.label} ${entry.label}`
        : item.label;
    }
  }
  return title;
}

function pageLabel(offer: GuideOffer): string {
  return pageLabelFor(offer.entry.halaman, offer.entry.title);
}

/**
 * Banner panduan kontekstual di atas halaman (spek 4.4): satu banner untuk panduan pertama yang `halaman`-nya
 * cocok dengan rute dan belum selesai. Mulai = jalankan tur; Nanti = sembunyikan untuk sesi tab ini (tanpa penanda
 * selesai); Sudah paham = tulis penanda selesai (beserta panduan tercakup). Ditunda selama tur berjalan atau
 * dialog/banner onboarding push tampil.
 */
export function GuideBanner() {
  const { email } = useMe();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { ready, offers } = useOfferedGuides();
  const { mark } = useGuideStore();
  const tour = useTour();
  const blocked = useBlockingOnboardingActive();
  // Id yang disembunyikan; diinisialisasi dari sesi tab dan ditambah langsung agar tak menunggu penyimpanan.
  const [hidden, setHidden] = useState<readonly string[]>(() => readLater(email));

  if (!ready || tour.active || blocked) return null;
  const offer = guideForRoute(
    offers.filter(({ entry }) => !hidden.includes(entry.id)),
    pathname,
  );
  if (!offer) return null;
  const { entry, stepCount } = offer;

  const hide = () => {
    const next = [...hidden, entry.id];
    setHidden(next);
    writeLater(email, next);
  };
  const understood = () => {
    hide();
    // Panduan `diturunkan` tak punya penanda tersimpan: cukup disembunyikan.
    if (entry.status === 'disimpan')
      mark(entry.id, entry.version, entry.covers).catch(() => undefined);
  };

  return (
    <Alert
      color="info"
      role="status"
      data-testid="guide-banner"
      className="rounded-none border-x-0 border-t-0 px-4 py-3"
    >
      <div className="flex flex-col gap-2 text-foreground sm:flex-row sm:items-center sm:gap-3">
        <p className="min-w-0 flex-1">
          <span className="font-medium">Pertama kali di {pageLabel(offer)}?</span>{' '}
          <span className="text-foreground">Ada panduan {stepCount} langkah.</span>
          {offer.updated ? (
            <Badge variant="secondary" className="ml-2 align-middle">
              Diperbarui
            </Badge>
          ) : null}
        </p>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => tour.start(entry)}>
            Mulai
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={hide}>
            Nanti
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={understood}>
            Sudah paham
          </Button>
        </div>
      </div>
    </Alert>
  );
}
