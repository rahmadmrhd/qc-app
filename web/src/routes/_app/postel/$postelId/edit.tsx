import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { requirePermission } from '@/modules/auth/permissions';
import { PostelFormPage } from '@/modules/postel/components/postel-form-page';
import { postelQueryOptions } from '@/modules/postel/queries';
import { useFrozen } from '@/modules/qrcode/lib/use-frozen';

export const Route = createFileRoute('/_app/postel/$postelId/edit')({
  staticData: {
    crumb: ({ params, queryClient }) => {
      const name = queryClient.getQueryData(
        postelQueryOptions(params.postelId ?? '').queryKey,
      )?.name;
      return [{ label: name ?? 'Detail', to: '/postel/$postelId', params }, { label: 'Ubah' }];
    },
    pageWidth: 'narrow',
  },
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'sticker', 'edit'),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(postelQueryOptions(params.postelId)),
  component: EditPostelRoute,
});

function EditPostelRoute() {
  const { postelId } = Route.useParams();
  const stack = useStackNavigation();
  const { data } = useSuspenseQuery(postelQueryOptions(postelId));
  // Versi saat halaman dibuka: muat ulang di latar tidak me-reset isian; bila orang lain sudah menyimpan, server
  // menjawab versi usang (bukan ketikan pengguna hilang diam-diam).
  const postel = useFrozen(data);
  return (
    <div>
      <PostelFormPage
        postel={postel}
        soonDays={postel.soonDays}
        today={postel.today}
        onDone={(id) => stack.pop({ to: '/postel/$postelId', params: { postelId: id } })}
        onCancel={() => stack.pop({ to: '/postel/$postelId', params: { postelId } })}
      />
    </div>
  );
}
