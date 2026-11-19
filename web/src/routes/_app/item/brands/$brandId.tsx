import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { businessUnitOptionsQueryOptions } from '@/modules/access/queries';
import { requirePermission } from '@/modules/auth/permissions';
import { BrandDetailView } from '@/modules/brand/components/brand-detail-view';
import { brandsQueryOptions } from '@/modules/brand/queries';

export const Route = createFileRoute('/_app/item/brands/$brandId')({
  staticData: {
    crumb: ({ params, queryClient }) => ({
      label:
        queryClient
          .getQueryData(brandsQueryOptions().queryKey)
          ?.find((brand) => brand.id === params.brandId)?.name ?? 'Detail',
    }),
  },
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'item', 'view'),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(brandsQueryOptions()),
      context.queryClient.ensureQueryData(businessUnitOptionsQueryOptions()),
    ]),
  component: BrandDetailPage,
});

function BrandDetailPage() {
  const { brandId } = Route.useParams();
  const navigate = useNavigate();
  const { data: brands } = useSuspenseQuery(brandsQueryOptions());
  const { data: businessUnits } = useSuspenseQuery(businessUnitOptionsQueryOptions());
  return (
    <BrandDetailView
      brand={brands.find((brand) => brand.id === brandId)}
      businessUnits={businessUnits}
      onBack={() => void navigate({ to: '/item/brands' })}
    />
  );
}
