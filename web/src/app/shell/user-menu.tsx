import { BellRing, Download, GraduationCap, LogOut } from 'lucide-react';
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
import { isDesktop } from '@/lib/platform';
import { LogoutConfirmDialog } from '@/modules/auth/logout-confirm-dialog';
import { useLogout } from '@/modules/auth/use-logout';
import { useMe } from '@/modules/auth/use-me';
import { GuideMenuDialog } from '@/modules/guide/components/guide-menu-dialog';
import { useTourMenu } from '@/modules/guide/lib/tour-menu';
import { countAllOutboxEntries } from '@/modules/handover/lib/outbox';
import { PushSettingsDialog } from '@/modules/push/components/push-settings-dialog';

export function UserMenu() {
  const me = useMe();
  const logout = useLogout();
  const install = useInstall();
  const [iosHelpOpen, setIosHelpOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const tourMenu = useTourMenu('user-menu');
  const initials = (me.name || me.email).slice(0, 2).toUpperCase();
  return (
    <>
      <DropdownMenu {...tourMenu.rootProps}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="gap-2 px-2" data-tour="user-menu">
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
              if (count > 0) setLogoutOpen(true);
              else logout();
            }}
          >
            <LogOut />
            Keluar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
