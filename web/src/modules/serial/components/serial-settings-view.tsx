import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { describeError } from '@/lib/api/describe-error';
import { usersQueryOptions } from '@/modules/access/queries';
import { can } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { isStaleSaveError, STALE_SAVE_MESSAGE } from '@/modules/sticker/lib/stale';
import { serialKeys } from '../keys';
import { serialSettingsQueryOptions, useSaveSerialSettings } from '../queries';
import { SerialSettingsPage } from './serial-settings-page';
import { ServiceLocationsSettings } from './service-locations-settings';

/**
 * Memuat pengaturan (hanya pengelola di semua BU; server menolak yang lain, pesannya tampil apa adanya) dan menyimpan.
 * Versi usang (412): pesan tampil dan pengaturan dimuat ulang, jadi isian berikutnya mulai dari data terbaru.
 */
export function SerialSettingsView() {
  const me = useMe();
  const queryClient = useQueryClient();
  const settings = useQuery(serialSettingsQueryOptions());
  // Saran penerima dari daftar user hanya bagi yang boleh melihat Akses; selainnya cukup mengetik email.
  const canReadUsers = can(me, 'access', 'view');
  const users = useQuery({ ...usersQueryOptions(), enabled: canReadUsers, retry: false });
  const save = useSaveSerialSettings();

  if (settings.isPending) return <p className="text-sm text-muted-foreground">Memuat…</p>;
  if (settings.isError || !settings.data) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {settings.error ? describeError(settings.error) : 'Pengaturan tidak bisa dimuat.'}
      </p>
    );
  }
  return (
    <SerialSettingsPage
      settings={settings.data}
      users={canReadUsers ? (users.data ?? null) : null}
      onSave={async (input) => {
        try {
          await save.mutateAsync(input);
          toast.success('Pengaturan Serial Number disimpan');
          return null;
        } catch (error) {
          if (isStaleSaveError(error)) {
            void queryClient.invalidateQueries({ queryKey: serialKeys.settings });
            return `${STALE_SAVE_MESSAGE}. Pengaturan sudah dimuat ulang; cek isiannya lalu simpan lagi.`;
          }
          return describeError(error);
        }
      }}
    >
      <ServiceLocationsSettings />
    </SerialSettingsPage>
  );
}
