import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { BusinessUnitDetailView } from '@/modules/access/components/business-unit-detail-view';
import { businessUnitsQueryOptions } from '@/modules/access/queries';
import { requirePermission } from '@/modules/auth/permissions';

export const Route = createFileRoute('/_app/access/business-units/$businessUnitId')({
  staticData: {
    crumb: ({ params, queryClient }) => ({
      label:
        queryClient
          .getQueryData(businessUnitsQueryOptions().queryKey)
          ?.find((bu) => bu.id === params.businessUnitId)?.name ?? 'Detail',
    }),
  },
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'access', 'view'),
  loader: ({ context }) => context.queryClient.ensureQueryData(businessUnitsQueryOptions()),
  component: BusinessUnitDetailPage,
});

function BusinessUnitDetailPage() {
  const { businessUnitId } = Route.useParams();
  const navigate = useNavigate();
  const stack = useStackNavigation();
  const { data: businessUnits } = useSuspenseQuery(businessUnitsQueryOptions());
  return (
    <BusinessUnitDetailView
      businessUnit={businessUnits.find((bu) => bu.id === businessUnitId)}
      onBack={() => stack.pop({ to: '/access/business-units' })}
    />
  );
}
