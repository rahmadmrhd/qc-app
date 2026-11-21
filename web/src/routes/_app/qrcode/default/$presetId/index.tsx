import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { useAfterDelete } from '@/components/page/use-after-delete';
import { ConfirmDeleteDialog } from '@/components/soft-delete/confirm-delete-dialog';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';
import { businessUnitLinkAccess } from '@/lib/link-access';
import { businessUnitOptionsQueryOptions } from '@/modules/access/queries';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { ClonePresetDialog } from '@/modules/qrcode/components/clone-preset-dialog';
import { QR_PRESET_VIEW_TABS, QrPresetView } from '@/modules/qrcode/components/qr-preset-view';
import {
  qrDefaultsQueryOptions,
  qrDesignsQueryOptions,
  qrPresetQueryOptions,
  useClonePreset,
  useRemoveQrPresets,
  useRestoreQrPresets,
} from '@/modules/qrcode/queries';

const searchSchema = z.object({
  tab: z.enum(QR_PRESET_VIEW_TABS).optional().catch(undefined),
});

export const Route = createFileRoute('/_app/qrcode/default/$presetId/')({
  staticData: {
    crumb: ({ params, queryClient }) => ({
      label:
        queryClient.getQueryData(qrPresetQueryOptions(queryClient, params.presetId ?? '').queryKey)
          ?.name ?? 'Detail',
    }),
  },
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'qrcode', 'manage'),
  // Preset yang tak ada/terhapus (bagi yang tak berhak) ditangani halaman sebagai "tidak ditemukan".
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient
        .ensureQueryData(qrPresetQueryOptions(context.queryClient, params.presetId))
        .catch(() => undefined),
      context.queryClient.ensureQueryData(businessUnitOptionsQueryOptions()),
    ]),
  component: QrPresetDetailPage,
});

/** Galat "preset tidak ada" (id salah, atau terhapus bagi yang tak boleh melihatnya). */
function isMissing(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN');
}

function QrPresetDetailPage() {
  const { presetId } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const stack = useStackNavigation();
  const queryClient = useQueryClient();
  const me = useMe();
  const query = useQuery(qrPresetQueryOptions(queryClient, presetId));
  const preset = query.data;
  const businessUnits = useQuery(businessUnitOptionsQueryOptions());
  // Konfigurasi QR pemakai preset: dari daftar yang sudah ada di cache (tanpa rute baru).
  const designs = useQuery(qrDesignsQueryOptions());
  const defaults = useQuery(qrDefaultsQueryOptions());
  const removePresets = useRemoveQrPresets();
  const restorePresets = useRestoreQrPresets();
  const clone = useClonePreset();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cloning, setCloning] = useState(false);
  const canManage = can(me, 'qrcode', 'manage');
  const usedBy = designs.data?.filter((design) => design.presetId === presetId);

  function restore() {
    // `mutateAsync` + toast di closure: aksi "Pulihkan" pada toast "Dihapus" dipanggil setelah navigasi, saat
    // komponen ini sudah dilepas (callback per-`mutate` tidak berjalan lagi).
    restorePresets
      .mutateAsync({ ids: [presetId] })
      .then(() => toast.success('Konfigurasi default dipulihkan'))
      .catch((error: unknown) => toast.error(describeError(error)));
  }

  const afterDelete = useAfterDelete({
    indexTo: '/qrcode/default',
    canRestore: canManage,
    onRestore: restore,
  });

  if (query.isError && !isMissing(query.error)) throw query.error;
  if (query.isPending) return <p className="text-sm text-muted-foreground">Memuat…</p>;

  function remove() {
    removePresets.mutate(
      { ids: [presetId] },
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
      <QrPresetView
        preset={preset}
        businessUnits={businessUnits.data ?? []}
        usedBy={usedBy}
        canOpenBusinessUnit={businessUnitLinkAccess(me).openBusinessUnitHref !== undefined}
        canOpenDesign={can(me, 'qrcode', 'view')}
        restorePending={restorePresets.isPending}
        tab={tab}
        onTabChange={(next) =>
          void navigate({ search: (prev) => ({ ...prev, tab: next }), replace: true })
        }
        onBack={() => stack.pop({ to: '/qrcode/default' })}
        onEdit={() => stack.push({ to: '/qrcode/default/$presetId/edit', params: { presetId } })}
        onClone={() => setCloning(true)}
        onDelete={() => setConfirmDelete(true)}
        onRestore={restore}
      />
      {preset && cloning ? (
        <ClonePresetDialog
          key={preset.id}
          open
          onOpenChange={(open) => (open ? undefined : setCloning(false))}
          source={preset}
          businessUnits={businessUnits.data ?? []}
          presets={defaults.data?.presets ?? []}
          onClone={async (input) => {
            const saved = await clone.mutateAsync(input);
            toast.success('Konfigurasi default dikloning');
            stack.push({ to: '/qrcode/default/$presetId', params: { presetId: saved.id } });
          }}
        />
      ) : null}
      {preset ? (
        <ConfirmDeleteDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          count={1}
          subject="konfigurasi default"
          {...((usedBy?.length ?? 0) > 0
            ? { usage: `Dipakai oleh ${usedBy?.length} konfigurasi QR (QR itu tidak berubah)` }
            : {})}
          onConfirm={remove}
          busy={removePresets.isPending}
        />
      ) : null}
    </>
  );
}
