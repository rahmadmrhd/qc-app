import { Outlet, useMatches } from '@tanstack/react-router';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { PageContainer } from '@/components/page/page-container';
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useEdgeSwipe } from '@/hooks/use-edge-swipe';
import { useIsMobile } from '@/hooks/use-mobile';
import { useFocusIntoView, useVisualViewport } from '@/hooks/use-visual-viewport';
import { isSidebarOverlayViewport, sidebarRange } from '@/lib/layout';
import { useMe } from '@/modules/auth/use-me';
import { GuideBanner } from '@/modules/guide/components/guide-banner';
import { GuideGreeting } from '@/modules/guide/components/guide-greeting';
import { TourProvider } from '@/modules/guide/components/tour/tour-provider';
import { renderTourTip } from '@/modules/guide/components/tour/tour-tip';
import { ItemCreateHost } from '@/modules/item/components/item-create-host';
import { ActiveLocationsProvider } from '@/modules/location/active-locations-context';
import { LocationLine } from '@/modules/location/components/location-line';
import { LocationReconfirm } from '@/modules/location/components/location-reconfirm';
import { LocationPicker } from '@/modules/location/location-picker';
import { NotificationBell } from '@/modules/notification/notification-bell';
import { PushOnboarding } from '@/modules/push/components/push-onboarding';
import { ThemeToggle } from '@/modules/theme/theme-toggle';
import { usePrefetchOnIdle } from '../prefetch';
import { ApiDeprecatedBanner } from '../pwa/api-deprecated-banner';
import { locationAwareOf, pageWidthOf } from '../route-meta';
import { AppBreadcrumb } from './app-breadcrumb';
import { AppSidebar } from './app-sidebar';
import { OutboxChip } from './outbox-chip';
import { ServerStatusBanner } from './server-status-banner';
import { readSidebarState, writeSidebarState } from './sidebar-state';
import { UiUpdateBanner } from './ui-update-banner';
import { UserMenu } from './user-menu';

/** Ponsel: geser dari tepi kiri layar membuka panel menu (butir 41). Di dalam SidebarProvider. */
function EdgeSwipeOpener() {
  const { isMobile, openMobile, setOpenMobile } = useSidebar();
  useEdgeSwipe(() => setOpenMobile(true), isMobile && !openMobile);
  return null;
}

/**
 * Cangkang aplikasi (sidebar + header). Dipakai rute `_app` (isi lewat `<Outlet />`) dan rute di luar `_app` yang
 * tetap boleh tampil tanpa login tetapi memakai cangkang bila sudah login (`/country-lock`): isinya lewat `children`.
 */
export function AppShell({ children }: { children?: ReactNode } = {}) {
  usePrefetchOnIdle(useMe());
  // Papan ketik layar ponsel: variabel --vvh/--vv-top/--kb dan gulir field fokus ke area terlihat.
  useVisualViewport();
  useFocusIntoView();
  // Ponsel (butir 41): header = ☰ + judul tingkat terakhir + tombol kanan (lokasi, lonceng, akun); tanpa tombol kembali.
  const phone = useIsMobile();
  const matches = useMatches();
  const pageWidth = pageWidthOf(matches);
  const locationAware = locationAwareOf(matches);
  // Terkendali (bukan defaultOpen): terbuka/terlipat diingat di localStorage lewat `qc.sidebar`.
  // Rentang overlay (768-959 px): sidebar melayang di atas isi, jadi mulai tertutup dan membuka/menutupnya tak
  // mengubah pilihan tersimpan (yang berlaku untuk layar lebar).
  const [sidebarOpen, setSidebarOpen] = useState(
    () => readSidebarState().open && !isSidebarOverlayViewport(),
  );
  // Lebar jendela berubah (putar tablet, ubah ukuran jendela): keadaan terbuka disinkronkan menurut RENTANG, bukan
  // sekadar overlay/bukan overlay, agar jalur overlay -> ponsel -> lebar pun memulihkan pilihan tersimpan.
  const range = useRef(sidebarRange());
  useEffect(() => {
    const onResize = () => {
      const next = sidebarRange();
      if (next === range.current) return;
      range.current = next;
      // Masuk rentang overlay (dari ponsel maupun lebar): tutup, jangan menutupi isi dengan latar gelap; pilihan
      // tersimpan tak ditulis. Masuk layar lebar tersemat (dari rentang mana pun): pulihkan pilihan tersimpan.
      // Ke ponsel tak perlu: panel ponsel terpisah (`openMobile`).
      if (next === 'overlay') setSidebarOpen(false);
      else if (next === 'wide') setSidebarOpen(readSidebarState().open);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const onSidebarOpenChange = useCallback((open: boolean) => {
    setSidebarOpen(open);
    if (!isSidebarOverlayViewport()) writeSidebarState({ open });
  }, []);
  return (
    <TooltipProvider>
      <ItemCreateHost>
        <ActiveLocationsProvider>
          <SidebarProvider open={sidebarOpen} onOpenChange={onSidebarOpenChange}>
            {/* Di dalam SidebarProvider agar mesin tur dapat membuka sidebar ponsel; overlay-nya dimuat malas. */}
            <TourProvider renderTip={renderTourTip}>
              <AppSidebar />
              <EdgeSwipeOpener />
              <LocationReconfirm />
              <SidebarInset className="min-w-0">
                <UiUpdateBanner />
                <ApiDeprecatedBanner />
                <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
                  <SidebarTrigger data-tour="sidebar-trigger" />
                  {/* Ponsel: judul tingkat terakhir di sebelah ☰ (tanpa tombol kembali: back = tombol sistem). */}
                  {phone ? (
                    <div className="flex min-w-0 flex-1 flex-col justify-center">
                      <AppBreadcrumb />
                      {/* Baris kedua hanya di halaman berlokasi (butir 42c). */}
                      {locationAware ? <LocationLine /> : null}
                    </div>
                  ) : (
                    <AppBreadcrumb />
                  )}
                  <div className="ml-auto flex shrink-0 items-center gap-1">
                    {/* Ponsel (butir 42): lokasi, antrean, dan tema pindah ke baris kedua/lembar avatar. */}
                    {phone ? null : <LocationPicker />}
                    {phone ? null : <OutboxChip />}
                    <NotificationBell />
                    {phone ? null : <ThemeToggle />}
                    <UserMenu />
                  </div>
                </header>
                <ServerStatusBanner />
                <PushOnboarding />
                <GuideGreeting />
                <GuideBanner />
                <main className="flex-1 p-[var(--main-pad)] pb-[calc(var(--main-pad)+var(--action-bar-h,0px))] [--main-pad:1rem] md:[--main-pad:1.5rem]">
                  <PageContainer width={pageWidth}>{children ?? <Outlet />}</PageContainer>
                </main>
              </SidebarInset>
            </TourProvider>
          </SidebarProvider>
        </ActiveLocationsProvider>
      </ItemCreateHost>
    </TooltipProvider>
  );
}
