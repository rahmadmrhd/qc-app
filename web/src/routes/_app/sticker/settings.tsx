import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { toast } from 'sonner';
import { describeError } from '@/lib/api/describe-error';
import { usersQueryOptions } from '@/modules/access/queries';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { PostelAlertSettings } from '@/modules/sticker/components/postel-alert-settings';
import { StickerSettingsPage } from '@/modules/sticker/components/sticker-settings-page';
import { isStaleSaveError, STALE_SAVE_MESSAGE } from '@/modules/sticker/lib/stale';
import {
  postelSettingsQueryOptions,
  stickerSettingsQuery,
  useSavePostelSettings,
  useSaveStickerSettings,
} from '@/modules/sticker/queries';

export const Route = createFileRoute('/_app/sticker/settings')({
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
  const { data: settings } = useSuspenseQuery(stickerSettingsQuery());
  const { data: postelSettings } = useSuspenseQuery(postelSettingsQueryOptions());
  // Saran penerima dari daftar user hanya bagi yang boleh melihat Akses; selainnya cukup mengetik email.
  const canReadUsers = can(me, 'access', 'view');
  const users = useQuery({ ...usersQueryOptions(), enabled: canReadUsers, retry: false });
  const save = useSaveStickerSettings();
  const savePostel = useSavePostelSettings();

  return (
    <div className="space-y-8">
      <StickerSettingsPage
        settings={settings}
        users={canReadUsers ? (users.data ?? null) : null}
        onSave={async (input) => {
          try {
            await save.mutateAsync(input);
            toast.success('Konfigurasi stiker disimpan');
            return null;
          } catch (error) {
            return isStaleSaveError(error) ? STALE_SAVE_MESSAGE : describeError(error);
          }
        }}
      />
      <PostelAlertSettings
        settings={postelSettings}
        users={canReadUsers ? (users.data ?? null) : null}
        onSave={async (input) => {
          try {
            await savePostel.mutateAsync(input);
            toast.success('Pengaturan peringatan Postel disimpan');
            return null;
          } catch (error) {
            return isStaleSaveError(error) ? STALE_SAVE_MESSAGE : describeError(error);
          }
        }}
      />
    </div>
  );
}
