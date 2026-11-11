import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { toast } from 'sonner';
import { describeError } from '@/lib/api/describe-error';
import { usersQueryOptions } from '@/modules/access/queries';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { StickerSettingsPage } from '@/modules/sticker/components/sticker-settings-page';
import { isStaleSaveError, STALE_SAVE_MESSAGE } from '@/modules/sticker/lib/stale';
import { stickerSettingsQuery, useSaveStickerSettings } from '@/modules/sticker/queries';

export const Route = createFileRoute('/_app/sticker/settings')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'sticker', 'manage'),
  loader: ({ context }) => context.queryClient.ensureQueryData(stickerSettingsQuery()),
  component: StickerSettingsRoute,
});

function StickerSettingsRoute() {
  const me = useMe();
  const { data: settings } = useSuspenseQuery(stickerSettingsQuery());
  // Saran penerima dari daftar user hanya bagi yang boleh melihat Akses; selainnya cukup mengetik email.
  const canReadUsers = can(me, 'access', 'view');
  const users = useQuery({ ...usersQueryOptions(), enabled: canReadUsers, retry: false });
  const save = useSaveStickerSettings();

  return (
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
  );
}
