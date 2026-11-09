import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { BusinessUnitDetailView } from '@/modules/access/components/business-unit-detail-view';
import { businessUnitsQueryOptions } from '@/modules/access/queries';
import { requirePermission } from '@/modules/auth/permissions';

export const Route = createFileRoute('/_app/access/business-units/$businessUnitId')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'access', 'view'),
  loader: ({ context }) => context.queryClient.ensureQueryData(businessUnitsQueryOptions()),
  component: BusinessUnitDetailPage,
});

function BusinessUnitDetailPage() {
  const { businessUnitId } = Route.useParams();
  const navigate = useNavigate();
  const { data: businessUnits } = useSuspenseQuery(businessUnitsQueryOptions());
  return (
    <BusinessUnitDetailView
      businessUnit={businessUnits.find((bu) => bu.id === businessUnitId)}
      onBack={() => void navigate({ to: '/access/business-units' })}
    />
  );
}
