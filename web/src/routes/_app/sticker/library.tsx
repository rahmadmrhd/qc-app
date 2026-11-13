import { createFileRoute } from '@tanstack/react-router';
import { can, requireAnyPermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { GuideLibraryPage } from '@/modules/sticker/components/guide-library-page';

export const Route = createFileRoute('/_app/sticker/library')({
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
  return <GuideLibraryPage canUpload={can(me, 'item', 'edit')} />;
}
