import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import type { LibraryQuery } from '@/components/file-dialog';
import { can, requireAnyPermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { GuideLibraryPage } from '@/modules/sticker/components/guide-library-page';

const SORTS = ['newest', 'oldest', 'nameAsc', 'nameDesc', 'sizeDesc', 'usageDesc'] as const;

/** Cari/urut/filter Pustaka Gambar di URL; nilai bawaan tak ditulis (URL tetap bersih). */
const librarySearchSchema = z.object({
  q: z.string().optional().catch(undefined),
  sort: z.enum(SORTS).optional().catch(undefined),
  mine: z.boolean().optional().catch(undefined),
  unused: z.boolean().optional().catch(undefined),
});

export const Route = createFileRoute('/_app/sticker/library')({
  validateSearch: librarySearchSchema,
  // Baca pustaka: `item: view` ATAU `sticker: view` (tanpa modul izin baru).
  beforeLoad: ({ context }) =>
    requireAnyPermission(context.queryClient, [
      { module: 'item', level: 'view' },
      { module: 'sticker', level: 'view' },
    ]),
  component: GuideLibraryRoute,
});

function GuideLibraryRoute() {
  const me = useMe();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const query: LibraryQuery = {
    search: search.q ?? '',
    sort: search.sort ?? 'newest',
    mine: search.mine ?? false,
    unused: search.unused ?? false,
  };
  return (
    <GuideLibraryPage
      canUpload={can(me, 'item', 'edit')}
      query={query}
      onQueryChange={(next) =>
        navigate({
          search: {
            q: next.search || undefined,
            sort: next.sort === 'newest' ? undefined : next.sort,
            mine: next.mine || undefined,
            unused: next.unused || undefined,
          },
          replace: true,
        })
      }
    />
  );
}
