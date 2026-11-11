import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { requirePermission } from '@/modules/auth/permissions';
import { PostelFormPage } from '@/modules/postel/components/postel-form-page';
import { postelQueryOptions } from '@/modules/postel/queries';
import { useFrozen } from '@/modules/qrcode/lib/use-frozen';

export const Route = createFileRoute('/_app/postel/$postelId/edit')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'sticker', 'edit'),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(postelQueryOptions(params.postelId)),
  component: EditPostelRoute,
});

function EditPostelRoute() {
  const { postelId } = Route.useParams();
  const navigate = useNavigate();
  const { data } = useSuspenseQuery(postelQueryOptions(postelId));
  // Versi saat halaman dibuka: muat ulang di latar tidak me-reset isian; bila orang lain sudah menyimpan, server
  // menjawab versi usang (bukan ketikan pengguna hilang diam-diam).
  const postel = useFrozen(data);
  return (
    <div className="max-w-4xl">
      <PostelFormPage
        postel={postel}
        soonDays={postel.soonDays}
        today={postel.today}
        onDone={(id) => navigate({ to: '/postel/$postelId', params: { postelId: id } })}
        onCancel={() => void navigate({ to: '/postel/$postelId', params: { postelId } })}
      />
    </div>
  );
}
