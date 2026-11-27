import { createFileRoute } from '@tanstack/react-router';
import { requirePermission } from '@/modules/auth/permissions';
import { FirmwarePage } from '@/modules/countrylock-admin/components/firmware-page';
import { firmwaresQueryOptions } from '@/modules/countrylock-admin/queries';

export const Route = createFileRoute('/_app/countrylock/firmware')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'countrylock', 'edit'),
  loader: ({ context }) => context.queryClient.ensureQueryData(firmwaresQueryOptions()),
  component: FirmwareRoute,
});

function FirmwareRoute() {
  return <FirmwarePage />;
}
