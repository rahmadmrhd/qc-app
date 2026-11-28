import { createFileRoute } from '@tanstack/react-router';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { requirePermission } from '@/modules/auth/permissions';
import { BundleView } from '@/modules/countrylock-admin/components/bundle-view';
import { bundleQueryOptions } from '@/modules/countrylock-admin/queries';

export const Route = createFileRoute('/_app/countrylock/bundles/$number')({
  staticData: {
    crumb: ({ params }) => ({ label: `Bundel #${params.number ?? ''}` }),
  },
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'countrylock', 'edit'),
  // Bundel yang tak ada ditangani halaman sebagai "tidak ditemukan".
  loader: ({ context, params }) =>
    context.queryClient
      .ensureQueryData(bundleQueryOptions(Number(params.number)))
      .catch(() => undefined),
  component: BundleRoute,
});

function BundleRoute() {
  const { number } = Route.useParams();
  const stack = useStackNavigation();
  return (
    <BundleView
      key={number}
      number={Number(number)}
      onBack={() => stack.pop({ to: '/countrylock/bundles' })}
    />
  );
}
