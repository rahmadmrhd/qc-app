import type { ItemStickerMarkDto, StickerDto, StickerTypeDto } from '@shared/contract';
import { INSTRUCTION_LIMITS } from '@shared/stickers';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { describeError } from '@/lib/api/describe-error';
import { stickerGuideUsagesQuery } from '@/modules/sticker/queries';
import { copyMarks, isInactiveTarget, markLabel } from '../lib/sticker-instructions';
import { itemQueryOptions } from '../queries';

export interface CopyMarksDialogProps {
  /** Gambar pustaka yang baru dipilih dan sudah dipakai item lain. */
  guideId: string;
  guideName: string;
  /** Item yang sedang diubah: tidak ditawarkan sebagai sumber. */
  currentItemId?: string | undefined;
  /** Katalog untuk menandai penanda bersasaran nonaktif sebelum disalin (kosong = tanpa pemeriksaan). */
  stickers?: readonly StickerDto[];
  types?: readonly StickerTypeDto[];
  /** Penanda sumber, disalin apa adanya (tanpa catatan foto). */
  onCopy: (marks: ItemStickerMarkDto[]) => void;
  onClose: () => void;
}

interface Pending {
  label: string;
  marks: ItemStickerMarkDto[];
}

/**
 * Menawarkan "Salin penanda dari item …" untuk gambar pustaka yang sudah dipakai item lain. Daftar item dari
 * `stickerGuides.usages` (sudah disaring hak BU); penanda dibaca lewat `items.get` item sumber dan disalin apa adanya
 * (penanda jenis dan penanda ke stiker tertentu); catatan foto tidak ikut. Bila ada penanda bersasaran nonaktif,
 * ringkasan penanda ditampilkan dengan tanda "nonaktif" dan penyalinan menunggu konfirmasi (simpan akan menolak
 * sasaran nonaktif yang baru bagi item). Tanpa sumber yang dapat dilihat, menutup sendiri.
 */
export function CopyMarksDialog({
  guideId,
  guideName,
  currentItemId,
  stickers = [],
  types = [],
  onCopy,
  onClose,
}: CopyMarksDialogProps) {
  const queryClient = useQueryClient();
  const usages = useQuery(stickerGuideUsagesQuery(guideId));
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const sources = (usages.data ?? []).filter((usage) => usage.itemId !== currentItemId);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const noSources = usages.isSuccess && sources.length === 0;
  useEffect(() => {
    if (noSources) closeRef.current();
  }, [noSources]);

  async function copyFrom(itemId: string, label: string) {
    if (busyId !== null) return;
    setBusyId(itemId);
    setError(null);
    try {
      const item = await queryClient.fetchQuery(itemQueryOptions(itemId));
      const photo = item.stickerPhotos.find((candidate) => candidate.guideId === guideId);
      if (!photo || photo.marks.length === 0) {
        setError('Item itu tidak memiliki penanda pada gambar ini.');
        return;
      }
      const marks = copyMarks(photo.marks.slice(0, INSTRUCTION_LIMITS.marks));
      if (marks.some((mark) => isInactiveTarget(mark.target, stickers, types))) {
        setPending({ label, marks });
        return;
      }
      onCopy(marks);
    } catch (failure) {
      setError(describeError(failure));
    } finally {
      setBusyId(null);
    }
  }

  const inactiveCount = pending
    ? pending.marks.filter((mark) => isInactiveTarget(mark.target, stickers, types)).length
    : 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Salin penanda dari item lain</DialogTitle>
          <DialogDescription>
            Gambar “{guideName}” sudah dipakai item lain. Salin penandanya sebagai titik awal;
            catatan foto tidak ikut disalin dan semuanya dapat diubah.
          </DialogDescription>
        </DialogHeader>
        {pending ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">Penanda dari {pending.label}</p>
            <ol
              aria-label="Penanda yang akan disalin"
              className="max-h-64 space-y-1 overflow-y-auto text-sm"
            >
              {pending.marks.map((mark, index) => (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: penanda tak punya id; nomor = urutan
                  key={index}
                  className="rounded-md border px-2 py-1"
                >
                  {index + 1}. {markLabel(mark.target, stickers, types)}
                  {mark.note !== '' ? (
                    <span className="text-muted-foreground"> · {mark.note}</span>
                  ) : null}
                </li>
              ))}
            </ol>
            <p role="status" className="text-sm text-amber-600 dark:text-amber-400">
              {inactiveCount} penanda bersasaran nonaktif. Simpan akan menolak sasaran nonaktif yang
              baru bagi item ini; ganti sasarannya setelah disalin.
            </p>
          </div>
        ) : usages.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {describeError(usages.error)}
          </p>
        ) : usages.isPending ? (
          <p className="text-sm text-muted-foreground">Memuat…</p>
        ) : (
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {sources.map((usage) => (
              <li
                key={usage.itemId}
                className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5"
              >
                <span className="min-w-0 truncate text-sm">
                  {usage.label}
                  {usage.status === 'inactive' ? (
                    <span className="ml-2 text-xs text-muted-foreground">nonaktif</span>
                  ) : null}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busyId !== null}
                  aria-label={`Salin penanda dari ${usage.label}`}
                  onClick={() => void copyFrom(usage.itemId, usage.label)}
                >
                  {busyId === usage.itemId ? 'Menyalin…' : 'Salin'}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          {pending ? (
            <>
              <Button type="button" variant="outline" onClick={() => setPending(null)}>
                Kembali
              </Button>
              <Button
                type="button"
                onClick={() => onCopy(pending.marks)}
              >{`Tetap salin ${pending.marks.length} penanda`}</Button>
            </>
          ) : (
            <Button type="button" variant="outline" onClick={onClose}>
              Lewati
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
