import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
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
  const navigate = useNavigate();
  const { data: list } = useSuspenseQuery(postelListQueryOptions());
  return (
    <div>
      <PostelFormPage
        soonDays={list.soonDays}
        today={list.today}
        onDone={(id) => navigate({ to: '/postel/$postelId', params: { postelId: id } })}
        onCancel={() => void navigate({ to: '/postel' })}
      />
    </div>
  );
}
