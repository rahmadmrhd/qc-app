import type { ItemNameOptionDto, MeDto } from '@shared/contract';
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query';
import { useContext } from 'react';
import { api } from '@/lib/api';
import { can } from '@/modules/auth/permissions';
import { meQueryKey } from '@/modules/auth/queries';

export const itemNameKeys = { all: ['items', 'name-options'] as const };

const NO_ITEMS: readonly ItemNameOptionDto[] = [];
// Penampung untuk render tanpa QueryClientProvider (mis. tes komponen); query dimatikan di sana.
const DETACHED_CLIENT = new QueryClient();

/**
 * Katalog nama Item untuk saran dan lencana di editor/tampilan catatan (Keluar Gudang 5.15). Dimuat SEKALI
 * (cache 5 menit), hanya bila pengguna punya `item: view`; tanpa hak itu daftar kosong dan rute tak dipanggil.
 * `enabled` false (kartu papan: tanpa lencana) = tak dimuat dan tak dipakai.
 */
export function useItemNames(enabled = true): readonly ItemNameOptionDto[] {
  const client = useContext(QueryClientContext);
  const me = client?.getQueryData<MeDto>(meQueryKey);
  const allowed = enabled && client !== undefined && can(me, 'item', 'view');
  const query = useQuery(
    {
      queryKey: itemNameKeys.all,
      queryFn: () => api('items.nameOptions', null),
      enabled: allowed,
      staleTime: 5 * 60 * 1000,
    },
    client ?? DETACHED_CLIENT,
  );
  return allowed ? (query.data?.items ?? NO_ITEMS) : NO_ITEMS;
}
