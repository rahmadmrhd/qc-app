import type { QrDesignDto, QrFileKind } from '@shared/rpc';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { rpc } from '@/lib/rpc';
import { describeError } from '@/lib/rpc/describe-error';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { fileQueryOptions } from '@/modules/files/queries';
import { ExportDialog } from '@/modules/qrcode/components/export-dialog';
import { QrDesignsTable } from '@/modules/qrcode/components/qr-designs-table';
import { saveBase64File } from '@/modules/qrcode/lib/download';
import { renderExportFiles } from '@/modules/qrcode/lib/export-files';
import {
  qrDesignsQueryOptions,
  useDeleteQrDesign,
  useExportQrDesign,
} from '@/modules/qrcode/queries';

export const Route = createFileRoute('/_app/qrcode/')({
  // `export=<id>`: dibuka dari "Simpan dan ekspor" pada form; dialog konfirmasi ekspor tampil otomatis.
  validateSearch: (search: Record<string, unknown>): { export?: string } =>
    typeof search.export === 'string' ? { export: search.export } : {},
  beforeLoad: ({ context }) => requirePermission(context.queryClient, 'qrcode', 'view'),
  loader: ({ context }) => context.queryClient.ensureQueryData(qrDesignsQueryOptions()),
  component: QrCodesPage,
});

function QrCodesPage() {
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: designs } = useSuspenseQuery(qrDesignsQueryOptions());
  const exportMutation = useExportQrDesign();
  const deleteMutation = useDeleteQrDesign();
  const [exporting, setExporting] = useState<QrDesignDto | null>(null);
  const [deleting, setDeleting] = useState<QrDesignDto | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { export: exportId } = Route.useSearch();
  // biome-ignore lint/correctness/useExhaustiveDependencies: hanya bereaksi pada parameter export
  useEffect(() => {
    if (!exportId) return;
    const target = designs.find((design) => design.id === exportId);
    if (target && can(me, 'qrcode', 'manage') && !target.overflow) setExporting(target);
    void navigate({ to: '/qrcode', search: {}, replace: true });
  }, [exportId]);

  async function confirmExport(design: QrDesignDto) {
    const logo =
      design.logoFileId === ''
        ? null
        : await queryClient.fetchQuery(fileQueryOptions(design.logoFileId));
    const files = await renderExportFiles(design, logo);
    await exportMutation.mutateAsync({
      id: design.id,
      expectedUpdatedAt: design.updatedAt,
      pdfBase64: files.pdfBase64,
      pngBase64: files.pngBase64,
    });
    toast.success('Hasil ekspor disimpan di Drive');
  }

  async function download(design: QrDesignDto, kind: QrFileKind) {
    setBusyId(design.id);
    try {
      saveBase64File(await rpc('qrcodes.file', { id: design.id, kind }));
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">QR Code Label</h1>
        {can(me, 'qrcode', 'edit') ? (
          <Button onClick={() => void navigate({ to: '/qrcode/new' })}>Buat konfigurasi</Button>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">
        Label 3 × 3 cm dari sebuah link. Ekspor menghasilkan PDF lembar 10 × 14 (300 × 420 mm) dan
        PNG, disimpan ke Drive setelah Anda konfirmasi.
      </p>
      <QrDesignsTable
        designs={designs}
        canEdit={can(me, 'qrcode', 'edit')}
        canManage={can(me, 'qrcode', 'manage')}
        busyId={busyId}
        onEdit={(design) =>
          void navigate({ to: '/qrcode/$designId/edit', params: { designId: design.id } })
        }
        onDuplicate={(design) => void navigate({ to: '/qrcode/new', search: { from: design.id } })}
        onExport={setExporting}
        onDownload={(design, kind) => void download(design, kind)}
        onDelete={setDeleting}
      />
      {exporting ? (
        <ExportDialog
          design={exporting}
          open
          onOpenChange={(open) => (open ? undefined : setExporting(null))}
          onConfirm={() => confirmExport(exporting)}
        />
      ) : null}
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus konfigurasi?</DialogTitle>
            <DialogDescription>
              "{deleting?.title}" dihapus beserta berkas hasil ekspornya di Drive. Logo dan PDF
              sumber tidak dihapus (label yang sudah tercetak tetap dapat dibuka).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Batal
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (!deleting) return;
                deleteMutation.mutate(
                  { id: deleting.id },
                  {
                    onSuccess: () => toast.success('Konfigurasi dihapus'),
                    onError: (error) => toast.error(describeError(error)),
                    onSettled: () => setDeleting(null),
                  },
                );
              }}
            >
              Hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
