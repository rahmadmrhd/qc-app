import type { SerialLocationOptionDto } from '@shared/contract';
import { useQuery } from '@tanstack/react-query';
import { canUseSerialLocationOptions } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { serialLocationOptionsQueryOptions } from '../queries';

/**
 * Lokasi yang dapat dipilih/dikenali di modul serial: semua lokasi aktif dari `serials.locationOptions` bagi pengguna
 * `serial: edit`; bagi pembaca lain lokasi dari `me.locations` (agar tidak memicu 403).
 */
export function useSerialLocations(): { locations: SerialLocationOptionDto[]; isPending: boolean } {
  const me = useMe();
  const fromServer = canUseSerialLocationOptions(me);
  const { data, isPending } = useQuery({
    ...serialLocationOptionsQueryOptions(),
    enabled: fromServer,
  });
  const locations = fromServer
    ? (data?.locations ?? [])
    : me.locations.map(({ id, code, name }) => ({ id, code, name }));
  return { locations, isPending: fromServer && isPending };
}
