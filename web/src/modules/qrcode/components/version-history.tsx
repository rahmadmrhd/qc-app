import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { formatAuditTime } from '@/modules/access/lib/audit-actions';
import { ImageThumb } from '@/modules/item/components/image-thumb';
import { STICKER_STATUS_LABEL } from '@/modules/sticker/lib/status';
import { qrVersionsQueryOptions } from '../queries';

/**
 * Riwayat versi Manual Book satu konfigurasi (v1, v2, ...) dengan alasan masing-masing. Gambar contoh hanya
 * ditampilkan bagi pengguna yang boleh membaca berkas stiker (`canViewImages`); selainnya placeholder.
 */
export function VersionHistory({
  designId,
  canViewImages,
}: {
  designId: string;
  canViewImages: boolean;
}) {
  const { data, isLoading, isError } = useQuery(qrVersionsQueryOptions(designId));
  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="text-base font-semibold">Riwayat versi Manual Book</h2>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Memuat riwayat…</p>
      ) : isError ? (
        <p role="alert" className="text-sm text-destructive">
          Riwayat versi tidak dapat dimuat.
        </p>
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Belum ada stiker Manual Book. Versi pertama lahir saat konfigurasi ini diekspor.
        </p>
      ) : (
        <ol className="space-y-3">
          {data.map((entry) => (
            <li key={entry.stickerId} className="flex gap-3">
              {canViewImages && entry.fileId ? (
                <ImageThumb
                  id={entry.fileId}
                  alt={`Gambar contoh ${entry.name}`}
                  className="size-16 shrink-0"
                />
              ) : (
                <div
                  role="img"
                  aria-label="Gambar contoh tidak ditampilkan"
                  className="size-16 shrink-0 rounded-md border bg-muted"
                />
              )}
              <div className="min-w-0 space-y-0.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">v{entry.version}</span>
                  <span>{entry.name}</span>
                  <Badge
                    color={entry.status === 'active' ? 'success' : 'secondary'}
                    variant="soft"
                    dot
                  >
                    {STICKER_STATUS_LABEL[entry.status]}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatAuditTime(entry.createdAt)} · {entry.createdBy}
                </p>
                {entry.reason !== '' ? <p className="break-words">Alasan: {entry.reason}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
