import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { describeError } from '@/lib/api/describe-error';
import { usersQueryOptions } from '@/modules/access/queries';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import {
  SETTINGS_TABS,
  StickerSettingsPage,
} from '@/modules/sticker/components/sticker-settings-page';
import { isStaleSaveError, STALE_SAVE_MESSAGE } from '@/modules/sticker/lib/stale';
import {
  postelSettingsQueryOptions,
  stickerSettingsQuery,
  useSavePostelSettings,
  useSaveStickerSettings,
} from '@/modules/sticker/queries';

const searchSchema = z.object({
  tab: z.enum(SETTINGS_TABS).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/sticker/settings')({
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  staticData: { pageWidth: 'narrow' },
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'sticker', 'manage'),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(stickerSettingsQuery()),
      context.queryClient.ensureQueryData(postelSettingsQueryOptions()),
    ]),
  component: StickerSettingsRoute,
});

function StickerSettingsRoute() {
  const me = useMe();
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const stack = useStackNavigation();
  const { data: settings } = useSuspenseQuery(stickerSettingsQuery());
  const { data: postelSettings } = useSuspenseQuery(postelSettingsQueryOptions());
  // Saran penerima dari daftar user hanya bagi yang boleh melihat Akses; selainnya cukup mengetik email.
  const canReadUsers = can(me, 'access', 'view');
  const users = useQuery({ ...usersQueryOptions(), enabled: canReadUsers, retry: false });
  const save = useSaveStickerSettings();
  const savePostel = useSavePostelSettings();

  return (
    <StickerSettingsPage
      settings={settings}
      postelSettings={postelSettings}
      users={canReadUsers ? (users.data ?? null) : null}
      tab={tab ?? 'minimum'}
      // Berpindah tab = mengganti isi halaman yang sama (replace), bukan langkah riwayat baru.
      onTabChange={(next) =>
        navigate({
          search: (prev) => ({ ...prev, tab: next === 'minimum' ? undefined : next }),
          replace: true,
        })
      }
      onCancel={() => stack.pop({ to: '/sticker' })}
      onSave={async (input) => {
        try {
          await save.mutateAsync(input);
          toast.success('Konfigurasi stiker disimpan');
          return null;
        } catch (error) {
          return isStaleSaveError(error) ? STALE_SAVE_MESSAGE : describeError(error);
        }
      }}
      onSavePostel={async (input) => {
        try {
          await savePostel.mutateAsync(input);
          toast.success('Pengaturan peringatan Postel disimpan');
          return null;
        } catch (error) {
          return isStaleSaveError(error) ? STALE_SAVE_MESSAGE : describeError(error);
        }
      }}
    />
  );
}
