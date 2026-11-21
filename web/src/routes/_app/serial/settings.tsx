import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { canManageSerialSettings, requirePermission } from '@/modules/auth/permissions';
import { meQueryOptions } from '@/modules/auth/queries';
import { SERIAL_SETTINGS_TABS } from '@/modules/serial/components/serial-settings-page';
import { SerialSettingsView } from '@/modules/serial/components/serial-settings-view';

const searchSchema = z.object({
  tab: z.enum(SERIAL_SETTINGS_TABS).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/serial/settings')({
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
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
  component: SerialSettingsRoute,
});

function SerialSettingsRoute() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const stack = useStackNavigation();
  return (
    <SerialSettingsView
      tab={tab ?? 'email'}
      // Berpindah tab = mengganti isi halaman yang sama (replace), bukan langkah riwayat baru.
      onTabChange={(next) =>
        void navigate({
          search: (prev) => ({ ...prev, tab: next === 'email' ? undefined : next }),
          replace: true,
        })
      }
      onCancel={() => stack.pop({ to: '/serial' })}
    />
  );
}
