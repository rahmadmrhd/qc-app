import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAfterDelete } from '@/components/page/use-after-delete';
import { ConfirmDeleteDialog } from '@/components/soft-delete/confirm-delete-dialog';
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';
import { businessUnitLinkAccess } from '@/lib/link-access';
import { businessUnitOptionsQueryOptions, useSaveBusinessUnit } from '@/modules/access/queries';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { BrandDetailView } from '@/modules/brand/components/brand-detail-view';
import { BrandFormDialog } from '@/modules/brand/components/brand-form-dialog';
import { useBrandSave } from '@/modules/brand/lib/use-brand-save';
import {
  brandQueryOptions,
  useRemoveBrands,
  useRestoreBrands,
  useSetBrandStatus,
} from '@/modules/brand/queries';

export const Route = createFileRoute('/_app/item/brands/$brandId')({
  staticData: {
    crumb: ({ params, queryClient }) => ({
      label:
        queryClient.getQueryData(brandQueryOptions(queryClient, params.brandId ?? '').queryKey)
          ?.name ?? 'Detail',
    }),
  },
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'item', 'view'),
  loader: ({ context, params }) =>
    Promise.all([
      // Merk yang tak ada/terhapus (bagi yang tak berhak) ditangani halaman sebagai "tidak ditemukan".
      context.queryClient
        .ensureQueryData(brandQueryOptions(context.queryClient, params.brandId))
        .catch(() => undefined),
      context.queryClient.ensureQueryData(businessUnitOptionsQueryOptions()),
    ]),
  component: BrandDetailPage,
});

/** Galat "merk tidak ada" (id salah, atau terhapus bagi yang tak boleh melihatnya); selain itu dilempar ulang. */
function isMissing(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN');
}

function BrandDetailPage() {
  const { brandId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useMe();
  const { data: businessUnits } = useSuspenseQuery(businessUnitOptionsQueryOptions());
  const query = useQuery(brandQueryOptions(queryClient, brandId));
  const saveBrand = useBrandSave();
  const saveBusinessUnit = useSaveBusinessUnit();
  const setStatus = useSetBrandStatus();
  const removeBrands = useRemoveBrands();
  const restoreBrands = useRestoreBrands();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canManage = can(me, 'item', 'manage');
  const buLinks = businessUnitLinkAccess(me);
  const brand = query.data;

  function restore() {
    // `mutateAsync` + toast di closure: aksi "Pulihkan" pada toast "Dihapus" dipanggil setelah navigasi, saat
    // komponen ini sudah dilepas (callback per-`mutate` tidak berjalan lagi).
    restoreBrands
      .mutateAsync({ ids: [brandId] })
      .then(() => toast.success('Merk dipulihkan (Nonaktif)'))
      .catch((error: unknown) => toast.error(describeError(error)));
  }

  const afterDelete = useAfterDelete({
    indexTo: '/item/brands',
    canRestore: canManage,
    onRestore: restore,
  });

  if (query.isError && !isMissing(query.error)) throw query.error;
  if (query.isPending) return <p className="text-sm text-muted-foreground">Memuat…</p>;

  function toggleStatus() {
    if (!brand) return;
    const next = brand.status === 'active' ? 'inactive' : 'active';
    setStatus.mutate(
      { id: brand.id, status: next },
      {
        onSuccess: () =>
          toast.success(next === 'active' ? 'Merk diaktifkan' : 'Merk dinonaktifkan'),
        onError: (error) => toast.error(describeError(error)),
      },
    );
  }

  function remove() {
    removeBrands.mutate(
      { ids: [brandId] },
      {
        onSuccess: () => {
          setConfirmDelete(false);
          afterDelete();
        },
        onError: (error) => {
          setConfirmDelete(false);
          toast.error(describeError(error));
        },
      },
    );
  }

  return (
    <>
      <BrandDetailView
        brand={brand}
        businessUnits={businessUnits}
        canEdit={can(me, 'item', 'edit')}
        canManage={canManage}
        canOpenBusinessUnit={buLinks.openBusinessUnitHref !== undefined}
        statusPending={setStatus.isPending}
        restorePending={restoreBrands.isPending}
        onBack={() => void navigate({ to: '/item/brands' })}
        onEdit={() => setEditing(true)}
        onToggleStatus={toggleStatus}
        onDelete={() => setConfirmDelete(true)}
        onRestore={restore}
      />
      {brand ? (
        <>
          <BrandFormDialog
            open={editing}
            onOpenChange={setEditing}
            brand={brand}
            businessUnits={businessUnits}
            onSave={saveBrand}
            onCreateBusinessUnit={
              buLinks.canCreateBusinessUnit
                ? (input) => saveBusinessUnit.mutateAsync(input)
                : undefined
            }
            openBusinessUnitHref={buLinks.openBusinessUnitHref}
          />
          <ConfirmDeleteDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            count={1}
            subject="merk"
            {...(brand.itemCount > 0 ? { usage: `Dipakai ${brand.itemCount} item` } : {})}
            onConfirm={remove}
            busy={removeBrands.isPending}
          />
        </>
      ) : null}
    </>
  );
}
