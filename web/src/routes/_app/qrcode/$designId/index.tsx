import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { PageContent } from '@/components/page/page-container';
import { useAfterDelete } from '@/components/page/use-after-delete';
import { ConfirmDeleteDialog } from '@/components/soft-delete/confirm-delete-dialog';
import { useStackNavigation } from '@/hooks/use-stack-navigation';
import { ApiError } from '@/lib/api/api-error';
import { describeError } from '@/lib/api/describe-error';
import { itemLinkAccess, qrPresetLinkAccess } from '@/lib/link-access';
import { businessUnitOptionsQueryOptions } from '@/modules/access/queries';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { QR_VIEW_TABS, QrDesignView } from '@/modules/qrcode/components/qr-design-view';
import { takeExportRequest } from '@/modules/qrcode/lib/export-request';
import { useQrExport } from '@/modules/qrcode/lib/use-qr-export';
import {
  qrDesignQueryOptions,
  qrDesignViewQueryOptions,
  qrPresetQueryOptions,
  useRemoveQrDesigns,
  useRestoreQrDesigns,
} from '@/modules/qrcode/queries';

const searchSchema = z.object({
  tab: z.enum(QR_VIEW_TABS).optional().catch(undefined),
  // Dibuka dari "Simpan dan ekspor" pada form: dialog konfirmasi ekspor tampil otomatis, lalu parameter dibuang.
  // `?export=1` tulisan tangan terbaca angka 1 oleh parser rute; navigasi aplikasi mengirim string '1'.
  export: z
    .union([z.literal('1'), z.literal(1).transform(() => '1' as const)])
    .optional()
    .catch(undefined),
});

export const Route = createFileRoute('/_app/qrcode/$designId/')({
  staticData: {
    crumb: ({ params, queryClient }) => {
      const design = queryClient.getQueryData(qrDesignQueryOptions(params.designId ?? '').queryKey);
      return { label: design ? design.name || design.title : 'Detail' };
    },
  },
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'qrcode', 'view'),
  // Konfigurasi yang tak ada/terhapus (bagi yang tak berhak) ditangani halaman sebagai "tidak ditemukan".
  loader: ({ context, params }) =>
    context.queryClient
      .ensureQueryData(qrDesignViewQueryOptions(params.designId))
      .catch(() => undefined),
  component: QrDesignDetailPage,
});

/** Galat "konfigurasi tidak ada" (id salah, atau terhapus bagi yang tak boleh melihatnya). */
function isMissing(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN');
}

function QrDesignDetailPage() {
  const { designId } = Route.useParams();
  const { tab, export: exportFlag } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const stack = useStackNavigation();
  const queryClient = useQueryClient();
  const me = useMe();
  const query = useQuery(qrDesignViewQueryOptions(designId));
  const design = query.data;
  const removeDesigns = useRemoveQrDesigns();
  const restoreDesigns = useRestoreQrDesigns();
  const { busyId, exportAction, download, exportDialog } = useQrExport();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canEdit = can(me, 'qrcode', 'edit');
  const canManage = can(me, 'qrcode', 'manage');
  const itemAccess = itemLinkAccess(me);
  // Nama konfigurasi default asal; terhapus bagi yang tak berhak = `NOT_FOUND`, nama tak diketahui (tak apa-apa).
  const presetId = design?.presetId ?? '';
  const preset = useQuery({
    ...qrPresetQueryOptions(queryClient, presetId),
    enabled: presetId !== '',
  });
  // BU konfigurasi = BU preset asalnya (konfigurasi QR tidak menyimpan BU sendiri).
  const presetBuId = preset.data?.buId ?? '';
  const businessUnits = useQuery({
    ...businessUnitOptionsQueryOptions(),
    enabled: presetBuId !== '',
  });
  const presetBu = businessUnits.data?.find((unit) => unit.id === presetBuId);

  function restore() {
    // `mutateAsync` + toast di closure: aksi "Pulihkan" pada toast "Dihapus" dipanggil setelah navigasi, saat
    // komponen ini sudah dilepas (callback per-`mutate` tidak berjalan lagi).
    restoreDesigns
      .mutateAsync({ ids: [designId] })
      .then(() => toast.success('Konfigurasi dipulihkan'))
      .catch((error: unknown) => toast.error(describeError(error)));
  }

  const afterDelete = useAfterDelete({
    indexTo: '/qrcode',
    canRestore: canManage,
    onRestore: restore,
  });

  // `export=1`: bersihkan parameter dulu, baru buka dialog (entri riwayat dialog tak boleh tertimpa `replace`).
  // biome-ignore lint/correctness/useExhaustiveDependencies: hanya bereaksi pada parameter export dan data yang termuat
  useEffect(() => {
    if (!exportFlag || !design) return;
    void navigate({ search: (prev) => ({ ...prev, export: undefined }), replace: true }).then(
      () => {
        if (canEdit && !design.overflow && !design.deleted) exportAction(design);
      },
    );
  }, [exportFlag, design?.id]);

  // Dari form Ubah ("Simpan dan ekspor", kembali lewat `pop`): permintaan satu kali yang dititipkan form itu.
  // biome-ignore lint/correctness/useExhaustiveDependencies: hanya bereaksi pada data yang termuat
  useEffect(() => {
    if (!design || !takeExportRequest(designId)) return;
    if (canEdit && !design.overflow && !design.deleted) exportAction(design);
  }, [designId, design?.id]);

  if (query.isError && !isMissing(query.error)) throw query.error;
  if (query.isPending) {
    return (
      <PageContent>
        <p className="text-sm text-muted-foreground">Memuat…</p>
      </PageContent>
    );
  }

  function remove() {
    removeDesigns.mutate(
      { ids: [designId] },
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

  const usedItems = design
    ? design.items.filter((item) => !item.deleted).length + design.hiddenItemCount
    : 0;

  return (
    <>
      <QrDesignView
        design={design}
        presetName={preset.data?.name}
        presetBusinessUnit={presetBu ? { name: presetBu.name, code: presetBu.code } : undefined}
        canOpenPreset={qrPresetLinkAccess(me).openPresetHref !== undefined}
        canEdit={canEdit}
        canManage={canManage}
        canOpenItem={itemAccess.openItemHref !== undefined}
        canOpenDeletedItem={itemAccess.canOpenDeleted}
        canViewImages={can(me, 'sticker', 'view') || can(me, 'item', 'view')}
        downloadBusy={busyId === designId}
        restorePending={restoreDesigns.isPending}
        tab={tab}
        onTabChange={(next) =>
          void navigate({ search: (prev) => ({ ...prev, tab: next }), replace: true })
        }
        onBack={() => stack.pop({ to: '/qrcode' })}
        onEdit={() => stack.push({ to: '/qrcode/$designId/edit', params: { designId } })}
        onExport={() => design && exportAction(design)}
        onDownload={(kind) => design && void download(design, kind)}
        onDelete={() => setConfirmDelete(true)}
        onRestore={restore}
      />
      {exportDialog}
      {design ? (
        <ConfirmDeleteDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          count={1}
          subject="konfigurasi"
          {...(usedItems > 0 ? { usage: `Memuat ${usedItems} item` } : {})}
          onConfirm={remove}
          busy={removeDesigns.isPending}
        />
      ) : null}
    </>
  );
}
