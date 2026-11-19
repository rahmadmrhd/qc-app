import { createFileRoute, redirect } from '@tanstack/react-router';
import { canManageSerialSettings, requirePermission } from '@/modules/auth/permissions';
import { meQueryOptions } from '@/modules/auth/queries';
import { SerialSettingsView } from '@/modules/serial/components/serial-settings-view';

export const Route = createFileRoute('/_app/serial/settings')({
  staticData: { pageWidth: 'narrow' },
  beforeLoad: async ({ context }) => {
    await requirePermission(context.queryClient, 'serial', 'manage');
    // Daftar penerima bersifat global: penandanya dihitung server di `auth.me` (aturan yang sama dengan penjaga rute).
    // `me` lama dari localStorage (sebelum penanda ada) dimuat ulang dulu agar pengelola sah tidak salah ditolak.
    let me = await context.queryClient.ensureQueryData(meQueryOptions());
    if (me.canManageSerialSettings === undefined) {
      me = await context.queryClient.fetchQuery({ ...meQueryOptions(), staleTime: 0 });
    }
    if (!canManageSerialSettings(me)) throw redirect({ to: '/forbidden' });
  },
  component: SerialSettingsView,
});
