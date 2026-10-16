import { Outlet } from '@tanstack/react-router';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ActiveLocationsProvider } from '@/modules/location/active-locations-context';
import { LocationPicker } from '@/modules/location/location-picker';
import { ThemeToggle } from '@/modules/theme/theme-toggle';
import { AppSidebar } from './app-sidebar';
import { UserMenu } from './user-menu';

export function AppShell() {
  return (
    <TooltipProvider>
      <ActiveLocationsProvider>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset>
            <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
              <SidebarTrigger />
              <div className="ml-auto flex items-center gap-1">
                <LocationPicker />
                <ThemeToggle />
                <UserMenu />
              </div>
            </header>
            <main className="flex-1 p-4 md:p-6">
              <Outlet />
            </main>
          </SidebarInset>
        </SidebarProvider>
      </ActiveLocationsProvider>
    </TooltipProvider>
  );
}
