import {
  BellRing,
  Check,
  ChevronRight,
  Clock,
  Download,
  GraduationCap,
  LogOut,
  MapPin,
  Monitor,
  Moon,
  Sun,
} from 'lucide-react';
import { useState } from 'react';
import { useInstall } from '@/app/pwa/install';
import { InstallIosDialog } from '@/app/pwa/install-dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { runAfterOverlays } from '@/lib/nav-stack';
import { isDesktop } from '@/lib/platform';
import { LogoutConfirmDialog } from '@/modules/auth/logout-confirm-dialog';
import { useLogout } from '@/modules/auth/use-logout';
import { useMe } from '@/modules/auth/use-me';
import { GuideMenuDialog } from '@/modules/guide/components/guide-menu-dialog';
import { useTourMenu } from '@/modules/guide/lib/tour-menu';
import { countAllOutboxEntries } from '@/modules/handover/lib/outbox';
import { useOutboxSummary } from '@/modules/handover/lib/use-outbox-summary';
import { activeLocationLabel } from '@/modules/location/active-location-label';
import { useOptionalActiveLocations } from '@/modules/location/active-locations-context';
import { LocationSheet } from '@/modules/location/components/location-sheet';
import { PushSettingsDialog } from '@/modules/push/components/push-settings-dialog';
import { isWarehouseSubmitting } from '@/modules/serialwh/lib/active-submission';
import { useTheme } from '@/modules/theme/theme-provider';
import { OutboxList } from './outbox-chip';

interface PhoneAccountProps {
  name: string;
  email: string;
  initials: string;
  installAvailable: boolean;
  onInstall: () => void;
  onGuide: () => void;
  onPush: () => void;
  onLogout: () => void;
}

const ROW =
  'flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-left text-sm hover:bg-muted';

/**
 * Ponsel (butir 42b): avatar membuka LEMBAR dari bawah berisi kartu pengguna, Lokasi aktif, Antrean offline (bila
 * ada; avatar bertitik selama ada antrean), Tema, Notifikasi push, Panduan, dan Keluar. Dialog/lembar lain dibuka
 * lewat `runAfterOverlays` agar lembar ini lepas dari riwayat lebih dulu (satu entri overlay pada satu waktu).
 */
function PhoneAccount(props: PhoneAccountProps) {
  const tourMenu = useTourMenu('user-menu');
  const { theme, setTheme } = useTheme();
  const locations = useOptionalActiveLocations();
  const { entries, sending } = useOutboxSummary(props.email);
  const [locOpen, setLocOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const pending = entries.length;
  const close = (then: () => void) => {
    runAfterOverlays(() => {
      setOpen(false);
      then();
    });
  };
  return (
    <>
      <Button
        variant="ghost"
        color="primary"
        size="icon"
        className="relative"
        aria-label={pending > 0 ? `Akun, ${pending} belum terkirim` : 'Akun'}
        data-tour="user-menu"
        onClick={() => setOpen(true)}
      >
        <Avatar className="size-7">
          <AvatarFallback>{props.initials}</AvatarFallback>
        </Avatar>
        {pending > 0 ? (
          <span
            data-slot="avatar-dot"
            aria-hidden="true"
            className="absolute top-1.5 right-1.5 size-2.5 rounded-full border-2 border-background bg-warning"
          />
        ) : null}
      </Button>
      <Sheet
        open={open || tourMenu.forced}
        onOpenChange={(next) => {
          setOpen(next);
          tourMenu.rootProps.onOpenChange(next);
        }}
        {...(tourMenu.forced ? { modal: false } : {})}
      >
        <SheetContent
          side="bottom"
          className="max-h-[85dvh] overflow-y-auto rounded-t-xl pb-[env(safe-area-inset-bottom)]"
          data-tour="user-menu-content"
          {...tourMenu.contentProps}
        >
          <SheetHeader>
            <SheetTitle className="sr-only">Akun</SheetTitle>
            <div className="flex items-center gap-3" data-tour="user-menu-account">
              <Avatar className="size-10">
                <AvatarFallback>{props.initials}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="truncate font-medium">{props.name}</div>
                <div className="truncate text-xs text-muted-foreground">{props.email}</div>
              </div>
            </div>
          </SheetHeader>
          <div className="flex flex-col gap-0.5 px-2 pb-3">
            {locations && locations.available.length > 0 ? (
              <button
                type="button"
                className={ROW}
                data-slot="account-location"
                onClick={() => close(() => setLocOpen(true))}
              >
                <MapPin aria-hidden className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-muted-foreground">Lokasi aktif</span>
                  <span className="block truncate">
                    {activeLocationLabel(locations.available, locations.selectedIds)}
                  </span>
                </span>
                <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
              </button>
            ) : null}
            {pending > 0 ? (
              <div className="rounded-md px-2 py-1.5" data-slot="account-outbox">
                <div className="flex min-h-9 items-center gap-3 text-sm">
                  <Clock aria-hidden className="size-4 text-muted-foreground" />
                  <span role="status" aria-live="polite">
                    {sending > 0
                      ? `Mengirim ${sending} dari ${pending}…`
                      : `${pending} belum terkirim`}
                  </span>
                </div>
                <OutboxList entries={entries} />
              </div>
            ) : null}
            <div className="flex items-center gap-3 px-2 py-1.5" data-tour="theme-menu">
              <span className="text-sm" aria-hidden="true">
                Tema
              </span>
              <fieldset className="ml-auto flex gap-1 border-0 p-0">
                <legend className="sr-only">Tema</legend>
                {(
                  [
                    ['light', 'Terang', Sun],
                    ['dark', 'Gelap', Moon],
                    ['system', 'Sistem', Monitor],
                  ] as const
                ).map(([value, label, Icon]) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={theme === value ? 'solid' : 'outline'}
                    color="primary"
                    aria-pressed={theme === value}
                    onClick={() => setTheme(value)}
                  >
                    <Icon aria-hidden />
                    {label}
                  </Button>
                ))}
              </fieldset>
            </div>
            {props.installAvailable ? (
              <button
                type="button"
                className={ROW}
                data-tour="user-menu-install"
                onClick={() => close(props.onInstall)}
              >
                <Download aria-hidden className="size-4" />
                Pasang aplikasi
              </button>
            ) : null}
            <button type="button" className={ROW} onClick={() => close(props.onGuide)}>
              <GraduationCap aria-hidden className="size-4" />
              Panduan
            </button>
            {!isDesktop() && (
              <button
                type="button"
                className={ROW}
                data-tour="user-menu-push"
                onClick={() => close(props.onPush)}
              >
                <BellRing aria-hidden className="size-4" />
                Notifikasi push
              </button>
            )}
            <button type="button" className={ROW} onClick={() => close(props.onLogout)}>
              <LogOut aria-hidden className="size-4" />
              Keluar
            </button>
          </div>
        </SheetContent>
      </Sheet>
      <LocationSheet open={locOpen} onOpenChange={setLocOpen} />
    </>
  );
}

export function UserMenu() {
  const me = useMe();
  const logout = useLogout();
  const install = useInstall();
  const [iosHelpOpen, setIosHelpOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const tourMenu = useTourMenu('user-menu');
  const phone = useIsMobile();
  const initials = (me.name || me.email).slice(0, 2).toUpperCase();
  return (
    <>
      {phone ? (
        <PhoneAccount
          name={me.name}
          email={me.email}
          initials={initials}
          installAvailable={install.state !== 'unavailable'}
          onInstall={() => {
            if (install.state === 'prompt') void install.install();
            else setIosHelpOpen(true);
          }}
          onGuide={() => setGuideOpen(true)}
          onPush={() => setPushOpen(true)}
          onLogout={() => {
            const count = countAllOutboxEntries();
            if (count > 0 || isWarehouseSubmitting()) setLogoutOpen(true);
            else logout();
          }}
        />
      ) : (
        <DropdownMenu {...tourMenu.rootProps}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" color="primary" className="gap-2 px-2" data-tour="user-menu">
              <Avatar className="size-7">
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <span className="hidden text-sm sm:inline">{me.name}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-56"
            data-tour="user-menu-content"
            {...tourMenu.contentProps}
          >
            <DropdownMenuLabel className="flex flex-col" data-tour="user-menu-account">
              <span>{me.name}</span>
              <span className="text-xs font-normal text-muted-foreground">{me.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {install.state !== 'unavailable' && (
              <DropdownMenuItem
                data-tour="user-menu-install"
                onSelect={() => {
                  if (install.state === 'prompt') void install.install();
                  else setIosHelpOpen(true);
                }}
              >
                <Download />
                Pasang aplikasi
              </DropdownMenuItem>
            )}
            {/* Ponsel: pengganti ThemeToggle di header. */}
            <DropdownMenuItem onSelect={() => setGuideOpen(true)}>
              <GraduationCap />
              Panduan
            </DropdownMenuItem>
            {/* Desktop menerima notifikasi lewat aliran server (selalu aktif), tanpa saklar push web. */}
            {!isDesktop() && (
              <DropdownMenuItem data-tour="user-menu-push" onSelect={() => setPushOpen(true)}>
                <BellRing />
                Notifikasi push
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onSelect={() => {
                // Keluar membuang antrean centang di perangkat (semua pemilik): peringatkan dulu bila ada isinya.
                const count = countAllOutboxEntries();
                if (count > 0 || isWarehouseSubmitting()) setLogoutOpen(true);
                else logout();
              }}
            >
              <LogOut />
              Keluar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {/* Di luar DropdownMenu agar tidak ikut tertutup bersama menu. */}
      <InstallIosDialog open={iosHelpOpen} onOpenChange={setIosHelpOpen} />
      {pushOpen && <PushSettingsDialog onClose={() => setPushOpen(false)} />}
      {guideOpen && <GuideMenuDialog onClose={() => setGuideOpen(false)} />}
      {logoutOpen && (
        <LogoutConfirmDialog
          onCancel={() => setLogoutOpen(false)}
          onConfirm={() => {
            setLogoutOpen(false);
            logout();
          }}
        />
      )}
    </>
  );
}
