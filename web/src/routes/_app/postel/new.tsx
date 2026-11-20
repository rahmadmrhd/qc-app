import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { requirePermission } from '@/modules/auth/permissions';
import { PostelFormPage } from '@/modules/postel/components/postel-form-page';
import { postelListQueryOptions } from '@/modules/postel/queries';

export const Route = createFileRoute('/_app/postel/new')({
  staticData: { crumb: 'Tambah', pageWidth: 'narrow' },
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'sticker', 'edit'),
  // `today` dan `soonDays` (dasar lencana kondisi) diambil dari daftar yang sama dengan halaman Postel.
  loader: ({ context }) => context.queryClient.ensureQueryData(postelListQueryOptions()),
  component: NewPostelRoute,
});

function NewPostelRoute() {
  const stack = useStackNavigation();
  const { data: list } = useSuspenseQuery(postelListQueryOptions());
  return (
    <div>
      <PostelFormPage
        soonDays={list.soonDays}
        today={list.today}
        onDone={(id) => stack.replace({ to: '/postel/$postelId', params: { postelId: id } })}
        onCancel={() => stack.pop({ to: '/postel' })}
      />
    </div>
  );
}
