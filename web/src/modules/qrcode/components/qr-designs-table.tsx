import type { QrDesignDto, QrFileKind } from '@shared/contract';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatAuditTime } from '@/modules/access/lib/audit-actions';
import { STICKER_STATUS_LABEL } from '@/modules/sticker/lib/status';

export interface QrDesignsTableProps {
  designs: readonly QrDesignDto[];
  canEdit: boolean;
  canManage: boolean;
  /** Konfigurasi yang sedang diproses (tombolnya dinonaktifkan). */
  busyId: string | null;
  onEdit: (design: QrDesignDto) => void;
  onExport: (design: QrDesignDto) => void;
  onDownload: (design: QrDesignDto, kind: QrFileKind) => void;
  onDelete: (design: QrDesignDto) => void;
}

function ItemsCell({ design }: { design: QrDesignDto }) {
  const total = design.items.length + design.hiddenItemCount;
  if (total === 0) return <span className="text-sm text-muted-foreground">Belum ada item</span>;
  const first = design.items[0];
  return (
    <div className="text-sm">
      <div>{total} item</div>
      {first ? (
        <div className="text-xs text-muted-foreground">
          {first.brand} {first.model}
          {total > 1 ? ' …' : ''}
        </div>
      ) : null}
    </div>
  );
}

function VersionCell({ design }: { design: QrDesignDto }) {
  if (design.stickerVersion === 0 || design.stickerStatus === '') {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  return (
    <div className="flex items-center gap-1">
      <span className="text-sm font-medium">v{design.stickerVersion}</span>
      {design.stickerStatus === 'active' ? null : (
        <Badge variant="outline">{STICKER_STATUS_LABEL[design.stickerStatus]}</Badge>
      )}
    </div>
  );
}

function StatusCell({ design }: { design: QrDesignDto }) {
  if (design.exportStatus === 'none') return <Badge variant="secondary">Belum diekspor</Badge>;
  return (
    <div className="space-y-0.5">
      <Badge variant={design.exportStatus === 'stale' ? 'outline' : 'default'}>
        {design.exportStatus === 'stale' ? 'Berubah sejak ekspor' : 'Sudah diekspor'}
      </Badge>
      <p className="text-xs text-muted-foreground">
        {formatAuditTime(design.exportedAt)} · {design.exportedBy}
      </p>
    </div>
  );
}

export function QrDesignsTable({
  designs,
  canEdit,
  canManage,
  busyId,
  onEdit,
  onExport,
  onDownload,
  onDelete,
}: QrDesignsTableProps) {
  if (designs.length === 0) {
    return (
      <p className="rounded-md border p-6 text-sm text-muted-foreground">
        Belum ada konfigurasi.{' '}
        {canEdit ? 'Buat konfigurasi pertama untuk menghasilkan label QR.' : ''}
      </p>
    );
  }
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Item</TableHead>
            <TableHead>Versi stiker</TableHead>
            <TableHead>Link</TableHead>
            <TableHead>Diperbarui</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {designs.map((design) => {
            const busy = busyId === design.id;
            const exported = design.exportedAt !== '';
            return (
              <TableRow key={design.id}>
                <TableCell className="font-medium">
                  {design.title}
                  {design.subtitle !== '' ? (
                    <div
                      data-testid="design-subtitle"
                      className="text-sm font-normal text-muted-foreground"
                    >
                      {design.subtitle}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell>
                  <ItemsCell design={design} />
                </TableCell>
                <TableCell>
                  <VersionCell design={design} />
                </TableCell>
                <TableCell className="max-w-[16rem] truncate text-sm" title={design.link}>
                  <a
                    href={design.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Buka link ${design.title}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {design.link}
                  </a>
                </TableCell>
                <TableCell className="text-sm">{formatAuditTime(design.updatedAt)}</TableCell>
                <TableCell>
                  <div className="space-y-1">
                    <StatusCell design={design} />
                    {design.overflow ? (
                      <Badge color="destructive" variant="soft">
                        Tidak muat
                      </Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap justify-end gap-1">
                    {exported ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          aria-label="Unduh PDF"
                          onClick={() => onDownload(design, 'pdf')}
                        >
                          PDF
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          aria-label="Unduh PNG"
                          onClick={() => onDownload(design, 'png')}
                        >
                          PNG
                        </Button>
                      </>
                    ) : null}
                    {canEdit ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        aria-label={`Ubah ${design.title}`}
                        onClick={() => onEdit(design)}
                      >
                        Ubah
                      </Button>
                    ) : null}
                    {canEdit ? (
                      <Button
                        size="sm"
                        disabled={busy || design.overflow}
                        title={
                          design.overflow
                            ? 'Isi label tidak muat di kanvas 3 × 3 cm; ubah konfigurasi lalu simpan ulang'
                            : undefined
                        }
                        aria-label={`${exported ? 'Ekspor ulang' : 'Ekspor'} ${design.title}`}
                        onClick={() => onExport(design)}
                      >
                        {exported ? 'Ekspor ulang' : 'Ekspor'}
                      </Button>
                    ) : null}
                    {canManage ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busy}
                        aria-label={`Hapus ${design.title}`}
                        onClick={() => onDelete(design)}
                      >
                        Hapus
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
