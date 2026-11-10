import type { BrandDto } from '@shared/contract';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { describeError } from '@/lib/api/describe-error';
import { businessUnitLinkAccess } from '@/lib/link-access';
import { businessUnitOptionsQueryOptions, useSaveBusinessUnit } from '@/modules/access/queries';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import {
  type BrandSaveInput,
  type BrandSaveResult,
  brandSaveFailure,
} from '@/modules/brand/components/brand-form-dialog';
import { BrandsManager } from '@/modules/brand/components/brands-manager';
import { brandsQueryOptions, useSaveBrand, useSetBrandStatus } from '@/modules/brand/queries';

export const Route = createFileRoute('/_app/item/brands/')({
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'item', 'view'),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(brandsQueryOptions()),
      context.queryClient.ensureQueryData(businessUnitOptionsQueryOptions()),
    ]),
  component: BrandsPage,
});

function BrandsPage() {
  const navigate = useNavigate();
  const me = useMe();
  const { data: brands } = useSuspenseQuery(brandsQueryOptions());
  const { data: businessUnits } = useSuspenseQuery(businessUnitOptionsQueryOptions());
  const save = useSaveBrand();
  const setStatus = useSetBrandStatus();
  const saveBusinessUnit = useSaveBusinessUnit();
  const buLinks = businessUnitLinkAccess(me);

  async function handleSave(input: BrandSaveInput): Promise<BrandSaveResult> {
    try {
      await save.mutateAsync(input);
      toast.success(input.id ? 'Merk diperbarui' : 'Merk ditambahkan');
      return null;
    } catch (error) {
      return brandSaveFailure(error);
    }
  }

  function toggleStatus(brand: BrandDto) {
    const status = brand.status === 'active' ? 'inactive' : 'active';
    setStatus.mutate(
      { id: brand.id, status },
      {
        onSuccess: () =>
          toast.success(status === 'active' ? 'Merk diaktifkan' : 'Merk dinonaktifkan'),
        onError: (error) => toast.error(describeError(error)),
      },
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Merk</h1>
        <Button variant="outline" onClick={() => void navigate({ to: '/item' })}>
          Kembali ke Data Item
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Mengganti nama merk berlaku untuk semua item merk itu. Merk tidak dihapus, hanya
        dinonaktifkan.
      </p>
      <BrandsManager
        brands={brands}
        businessUnits={businessUnits}
        canEdit={can(me, 'item', 'edit')}
        canManage={can(me, 'item', 'manage')}
        pendingStatusId={setStatus.isPending ? (setStatus.variables?.id ?? null) : null}
        onSave={handleSave}
        onCreateBusinessUnit={
          buLinks.canCreateBusinessUnit ? (input) => saveBusinessUnit.mutateAsync(input) : undefined
        }
        openBusinessUnitHref={buLinks.openBusinessUnitHref}
        onToggleStatus={toggleStatus}
      />
    </div>
  );
}
