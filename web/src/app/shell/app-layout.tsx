import { AppShell } from './app-shell';
import { DesktopUpdateGate } from './desktop-update-gate';

/**
 * Layout rute `_app`: cangkang aplikasi di dalam penahan "Perlu pembaruan" desktop. Penahan dipasang DI SINI, bukan di
 * `AppShell`, karena `/country-lock` (di luar `_app`) ikut memakai `AppShell` dan tidak boleh tertahan.
 */
export function AppLayout() {
  return (
    <DesktopUpdateGate>
      <AppShell />
    </DesktopUpdateGate>
  );
}
