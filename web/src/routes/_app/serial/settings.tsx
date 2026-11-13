import { createFileRoute, redirect } from '@tanstack/react-router';
import { canManageSerialSettings, requirePermission } from '@/modules/auth/permissions';
import { meQueryOptions } from '@/modules/auth/queries';
import { SerialSettingsView } from '@/modules/serial/components/serial-settings-view';

export const Route = createFileRoute('/_app/serial/settings')({
  beforeLoad: async ({ context }) => {
    await requirePermission(context.queryClient, 'serial', 'manage');
    // Daftar penerima bersifat global: hanya pengelola di semua BU (atau super admin), sama seperti aturan server.
    const me = await context.queryClient.ensureQueryData(meQueryOptions());
    if (!canManageSerialSettings(me)) throw redirect({ to: '/forbidden' });
  },
  component: SerialSettingsView,
});
