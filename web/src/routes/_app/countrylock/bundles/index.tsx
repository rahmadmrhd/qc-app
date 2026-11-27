import { createFileRoute } from '@tanstack/react-router';
import { requirePermission } from '@/modules/auth/permissions';
import { BundlesPage } from '@/modules/countrylock-admin/components/bundles-page';
import { bundlesQueryOptions } from '@/modules/countrylock-admin/queries';

export const Route = createFileRoute('/_app/countrylock/bundles/')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'countrylock', 'edit'),
  loader: ({ context }) => context.queryClient.ensureQueryData(bundlesQueryOptions()),
  component: BundlesRoute,
});

function BundlesRoute() {
  return <BundlesPage />;
}
