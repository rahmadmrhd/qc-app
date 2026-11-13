import { BellRing, Download, LogOut } from 'lucide-react';
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
import { useLogout } from '@/modules/auth/use-logout';
import { useMe } from '@/modules/auth/use-me';
import { PushSettingsDialog } from '@/modules/push/components/push-settings-dialog';

export function UserMenu() {
  const me = useMe();
  const logout = useLogout();
  const install = useInstall();
  const [iosHelpOpen, setIosHelpOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const initials = (me.name || me.email).slice(0, 2).toUpperCase();
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="gap-2 px-2">
            <Avatar className="size-7">
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <span className="hidden text-sm sm:inline">{me.name}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="flex flex-col">
            <span>{me.name}</span>
            <span className="text-xs font-normal text-muted-foreground">{me.email}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {install.state !== 'unavailable' && (
            <DropdownMenuItem
              onSelect={() => {
                if (install.state === 'prompt') void install.install();
                else setIosHelpOpen(true);
              }}
            >
              <Download />
              Pasang aplikasi
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setPushOpen(true)}>
            <BellRing />
            Notifikasi push
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={logout}>
            <LogOut />
            Keluar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Di luar DropdownMenu agar tidak ikut tertutup bersama menu. */}
      <InstallIosDialog open={iosHelpOpen} onOpenChange={setIosHelpOpen} />
      {pushOpen && <PushSettingsDialog onClose={() => setPushOpen(false)} />}
    </>
  );
}
