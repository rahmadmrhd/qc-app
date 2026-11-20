import type { SerialProofPhotoDto } from '@shared/contract';
import { CircleAlert, Download } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { BusyLabel } from '@/components/spinner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
import { EnsureProofReplace, useProofReplace } from '../lib/proof-replace-context';
import { proofThumbUrl } from '../lib/proof-source';
import { usePendingReplaceIds, useRemoveProof, useRetryProof } from '../queries';
import { ProofReplaceDialog, ProofReplaceStatus } from './proof-replace-dialog';

export interface ProofGalleryProps {
  photos: readonly SerialProofPhotoDto[];
}

/**
 * Kisi foto bukti QC pada kartu riwayat: gambar kecil (foto asli selama menunggu cap, hasil bercap setelah selesai),
 * klik membuka tampilan besar dengan tombol unduh. Foto `failed` menampilkan alasan; foto yang sudah tersimpan tidak
 * dapat dibuang kecuali yang gagal.
 */
export function ProofGallery(props: ProofGalleryProps) {
  return (
    <EnsureProofReplace>
      <ProofGalleryBody {...props} />
    </EnsureProofReplace>
  );
}

function ProofGalleryBody({ photos }: ProofGalleryProps) {
  const [open, setOpen] = useState<{ photo: SerialProofPhotoDto; index: number } | null>(null);
  const [discarding, setDiscarding] = useState<SerialProofPhotoDto | null>(null);
  // Foto gagal yang dipilih untuk diganti (dialog terbuka); unggahan dan penggantiannya dipegang hook di komponen ini,
  // jadi tetap berjalan setelah dialog menutup dan dibatalkan bila kartu dilepas (berpindah halaman).
  const [replacing, setReplacing] = useState<SerialProofPhotoDto | null>(null);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const proofReplace = useProofReplace();
  const retry = useRetryProof();
  const remove = useRemoveProof();
  const replacingIds = usePendingReplaceIds();
  const busy = retry.isPending || remove.isPending;

  async function runRetry(photo: SerialProofPhotoDto) {
    try {
      await retry.mutateAsync(photo.id);
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  async function runRemove(photo: SerialProofPhotoDto) {
    try {
      await remove.mutateAsync(photo.id);
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  return (
    <>
      <ul aria-label="Foto bukti QC" className="mt-3 flex flex-wrap gap-3">
        {photos.map((photo, index) => {
          const pending = photo.state === 'queued' || photo.state === 'processing';
          const failed = photo.state === 'failed';
          // Penggantian foto ini sedang berjalan: Coba lagi/Unggah ulang/Buang dikunci agar tak berebut dengan `replace`.
          const replaceState = proofReplace.stateOf(photo.id);
          const uploading = replaceState.entry !== null && replaceState.entry.phase !== 'failed';
          const locked = busy || replacingIds.has(photo.id) || uploading;
          return (
            <li key={photo.id} className="w-28 space-y-1">
              <button
                type="button"
                aria-label={`Buka foto bukti ${index + 1}`}
                className="block overflow-hidden rounded-md border focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setOpen({ photo, index })}
              >
                <img
                  // Hasil bercap memakai id yang sama dengan foto asli: ganti kunci saat status berubah agar dimuat ulang.
                  key={`${photo.id}-${photo.state}`}
                  src={proofThumbUrl(photo.id)}
                  alt={`Foto bukti ${index + 1}`}
                  loading="lazy"
                  className="aspect-square size-28 object-cover"
                />
              </button>
              {pending ? <p className="text-xs text-muted-foreground">Menunggu cap</p> : null}
              {failed ? (
                <div className="space-y-1">
                  <p className="flex items-center gap-1 text-xs font-medium text-destructive">
                    <CircleAlert aria-hidden className="size-3.5" />
                    Gagal
                  </p>
                  {photo.error ? (
                    <p className="text-xs text-muted-foreground">{photo.error}</p>
                  ) : null}
                  <ProofReplaceStatus
                    state={replaceState}
                    replacing={replacingIds.has(photo.id)}
                    onCancel={() => proofReplace.cancel(photo.id)}
                  />
                  {photo.canRetry || photo.canManage ? (
                    <div className="flex flex-wrap gap-1">
                      {photo.canRetry ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          disabled={locked}
                          onClick={() => void runRetry(photo)}
                        >
                          {retry.isPending && retry.variables === photo.id ? (
                            <BusyLabel>Mencoba…</BusyLabel>
                          ) : (
                            'Coba lagi'
                          )}
                        </Button>
                      ) : null}
                      {photo.canManage ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          disabled={locked}
                          onClick={() => {
                            setReplacing(photo);
                            setReplaceOpen(true);
                          }}
                        >
                          Unggah ulang
                        </Button>
                      ) : null}
                      {photo.canManage ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          disabled={locked}
                          onClick={() => setDiscarding(photo)}
                        >
                          Buang
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <ProofReplaceDialog
        open={replaceOpen && replacing !== null}
        onOpenChange={setReplaceOpen}
        onPicked={(files) => {
          if (replacing) proofReplace.start(replacing.id, files);
        }}
      />

      <Dialog open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent className="max-h-[90dvh] max-w-[calc(100%-1rem)] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{open ? `Foto bukti ${open.index + 1}` : 'Foto bukti'}</DialogTitle>
            <DialogDescription className="sr-only">Foto bukti QC ukuran besar</DialogDescription>
          </DialogHeader>
          {open ? (
            <div className="flex max-h-[70dvh] items-center justify-center overflow-auto rounded-md bg-muted">
              <img
                src={proofThumbUrl(open.photo.id)}
                alt={`Foto bukti ${open.index + 1} ukuran besar`}
                className="max-h-[70dvh] max-w-full object-contain"
              />
            </div>
          ) : null}
          <DialogFooter>
            {open ? (
              <Button asChild variant="outline">
                <a href={proofThumbUrl(open.photo.id)} download={open.photo.filename}>
                  <Download aria-hidden />
                  Unduh
                </a>
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={discarding !== null} onOpenChange={(next) => !next && setDiscarding(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Buang foto ini?</AlertDialogTitle>
            <AlertDialogDescription>
              Foto yang gagal diproses dibuang permanen dan tidak bisa dikembalikan. Pembuangannya
              dicatat di riwayat audit.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const photo = discarding;
                setDiscarding(null);
                if (photo) void runRemove(photo);
              }}
            >
              Ya, buang foto
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
