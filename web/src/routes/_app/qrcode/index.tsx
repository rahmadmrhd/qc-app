import type { QrDesignDto, QrFileKind } from '@shared/contract';
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
import { api } from '@/lib/api';
import { describeError } from '@/lib/api/describe-error';
import { can, requirePermission } from '@/modules/auth/permissions';
import { useMe } from '@/modules/auth/use-me';
import { ExportDialog } from '@/modules/qrcode/components/export-dialog';
import { QrDesignsTable } from '@/modules/qrcode/components/qr-designs-table';
import { designLabel } from '@/modules/qrcode/lib/design-label';
import { saveFileDownload } from '@/modules/qrcode/lib/download';
import { shouldRefreshAfterExportError } from '@/modules/qrcode/lib/export-error';
import { prepareExportFiles } from '@/modules/qrcode/lib/prepare-export';
import {
  qrDesignsQueryOptions,
  refreshQrDesign,
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
    // Bersihkan parameter dulu, baru buka dialog: dialog ber-entri riwayat tak boleh tertimpa `replace` (review nav I2).
    void navigate({ to: '/qrcode', search: {}, replace: true }).then(() => {
      if (target && can(me, 'qrcode', 'edit') && !target.overflow) setExporting(target);
    });
  }, [exportId]);

  async function confirmExport(
    design: QrDesignDto,
    report: (step: string) => void,
    reason: string,
  ) {
    const files = await prepareExportFiles(queryClient, design, report);
    report('Mengirim PDF dan PNG ke server…');
    try {
      await exportMutation.mutateAsync({
        id: design.id,
        expectedUpdatedAt: design.updatedAt,
        pdf: files.pdf,
        png: files.png,
        // Gambar contoh stiker dikirim selalu (server mengabaikannya bila ekspor ini tidak melahirkan versi baru).
        preview: files.preview,
        reason,
        onProgress: (job) => report(`Server memproses ekspor ke Drive (${job.progress}%)…`),
      });
    } catch (error) {
      // DTO di dialog basi (versi usang, label berubah sehingga alasan kini wajib, atau job gagal di langkah komit
      // karena konfigurasi diubah selama job): muat ulang agar dialog
      // memakai data terbaru (kotak alasan muncul bila perlu), lalu teruskan galat ke dialog.
      if (shouldRefreshAfterExportError(error)) {
        const fresh = await refreshQrDesign(queryClient, design.id).catch(() => null);
        if (fresh) setExporting(fresh);
      }
      throw error;
    }
    toast.success('Hasil ekspor disimpan di Drive');
  }

  async function download(design: QrDesignDto, kind: QrFileKind) {
    setBusyId(design.id);
    try {
      saveFileDownload(await api('qrcodes.file', { id: design.id, kind }));
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div data-tour="qr-header" className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">QR Code Label</h1>
        <div className="flex flex-wrap gap-2">
          {can(me, 'qrcode', 'manage') ? (
            <Button variant="outline" onClick={() => void navigate({ to: '/qrcode/default' })}>
              Konfigurasi default
            </Button>
          ) : null}
          {can(me, 'qrcode', 'edit') ? (
            <Button data-tour="qr-new" onClick={() => void navigate({ to: '/qrcode/new' })}>
              Buat konfigurasi
            </Button>
          ) : null}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Label 3 × 3 cm dari sebuah link. Ekspor menghasilkan PDF lembar 10 × 14 (300 × 420 mm) dan
        PNG, disimpan ke Drive setelah Anda konfirmasi.
      </p>
      <div data-tour="qr-table">
        <QrDesignsTable
          designs={designs}
          canEdit={can(me, 'qrcode', 'edit')}
          canManage={can(me, 'qrcode', 'manage')}
          busyId={busyId}
          onEdit={(design) =>
            void navigate({ to: '/qrcode/$designId/edit', params: { designId: design.id } })
          }
          onExport={setExporting}
          onDownload={(design, kind) => void download(design, kind)}
          onDelete={setDeleting}
        />
      </div>
      {exporting ? (
        <ExportDialog
          design={exporting}
          open
          onOpenChange={(open) => (open ? undefined : setExporting(null))}
          onConfirm={(report, reason) => confirmExport(exporting, report, reason)}
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
              "{deleting ? designLabel(deleting) : ''}" dihapus beserta berkas hasil ekspornya di
              Drive. Logo bersama dan berkas PDF sumber tidak dihapus dari Drive, tetapi berbagi PDF
              dicabut bila tidak dipakai konfigurasi lain (link pada label yang sudah tercetak tidak
              lagi dapat dibuka publik).
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
