import { createFileRoute, useNavigate } from '@tanstack/react-router';
import type { LibraryQuery } from '@/components/file-dialog';
import { useUrlSyncedText } from '@/modules/access/lib/use-url-synced-text';
import { can, requireAnyPermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { GuideLibraryPage } from '@/modules/sticker/components/guide-library-page';
import { librarySearchSchema } from '@/modules/sticker/lib/library-search';
import { useRemoveGuides } from '@/modules/sticker/queries';

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
  const removeGuides = useRemoveGuides();
  // Kolom cari memakai teks lokal + debounce ke URL (pola proyek); navigate per ketikan membuat kursor melompat.
  const [text, setText] = useUrlSyncedText(search.q ?? '', (value) =>
    navigate({ search: (prev) => ({ ...prev, q: value || undefined }), replace: true }),
  );
  const query: LibraryQuery = {
    search: text,
    sort: search.sort ?? 'newest',
    mine: search.mine ?? false,
    unused: search.unused ?? false,
  };
  return (
    <GuideLibraryPage
      canUpload={can(me, 'item', 'edit')}
      onRemoveBatch={(ids) => removeGuides.mutateAsync({ ids }).then((result) => result.ids)}
      query={query}
      onQueryChange={(next) => {
        if (next.search !== text) setText(next.search);
        if (next.sort === query.sort && next.mine === query.mine && next.unused === query.unused) {
          return;
        }
        navigate({
          search: (prev) => ({
            ...prev,
            sort: next.sort === 'newest' ? undefined : next.sort,
            mine: next.mine || undefined,
            unused: next.unused || undefined,
          }),
          replace: true,
        });
      }}
    />
  );
}
