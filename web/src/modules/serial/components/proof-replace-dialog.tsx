import { MAX_IMAGE_BYTES } from '@shared/files';
import { FileDialog, type QueuedFile, UploadProgress } from '@/components/file-dialog';
import { Button } from '@/components/ui/button';
import { proofSource } from '../lib/proof-source';
import type { ProofReplaceState } from '../lib/use-proof-replace';

export interface ProofReplaceDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Satu foto pengganti sudah dipilih; pemanggil (hook `useProofReplace`, pemiliknya `ProofReplaceProvider`) yang mengunggah dan memanggil `replace`. */
  onPicked(files: QueuedFile[]): void;
}

/**
 * Dialog "Unggah ulang" foto bukti yang gagal: dialog lampiran yang sama dengan form Tambah/Cek ulang (tab Unggah +
 * Kamera, tanpa Pustaka), tetapi SATU foto. Dialog hanya mengumpulkan berkas dan menutup; unggahannya dan penggantian
 * (`serialProofs.replace`) dikerjakan hook `useProofReplace` yang dibagi lewat `ProofReplaceProvider` (banner dan galeri satu pemilik), dengan progres di kartu foto.
 */
export function ProofReplaceDialog({ open, onOpenChange, onPicked }: ProofReplaceDialogProps) {
  if (!open) return null;
  return (
    <FileDialog
      open
      onOpenChange={onOpenChange}
      source={proofSource}
      mode="single"
      accept={['image']}
      maxBytes={MAX_IMAGE_BYTES}
      showLibrary={false}
      title="Unggah ulang foto bukti QC"
      confirmLabel="Ganti foto"
      hideNames
      onConfirm={(result) => onPicked(result.files)}
    />
  );
}

export interface ProofReplaceStatusProps {
  state: ProofReplaceState;
  /** Penggantian (`serialProofs.replace`) foto ini sedang berjalan. */
  replacing: boolean;
  onCancel(): void;
}

/**
 * Keadaan penggantian pada kartu foto gagal: bar progres + "Mengganti…" selama diunggah atau diganti, atau pesan galat
 * (unggahan atau penggantian gagal) dengan "Unggah ulang" yang tersedia lagi di kartu. Tanpa keduanya tidak menampilkan apa pun.
 */
export function ProofReplaceStatus({ state, replacing, onCancel }: ProofReplaceStatusProps) {
  const { entry, error } = state;
  if (entry && entry.phase !== 'failed') {
    return (
      <div data-testid="proof-replacing" className="space-y-1">
        <p className="text-xs font-medium">Mengganti…</p>
        <UploadProgress phase={entry.phase} fraction={entry.fraction} />
        <Button type="button" variant="ghost" size="xs" onClick={onCancel}>
          Batalkan
        </Button>
      </div>
    );
  }
  if (replacing) {
    return (
      <div data-testid="proof-replacing" className="space-y-1">
        <p className="text-xs font-medium">Mengganti…</p>
        <UploadProgress phase="processing" fraction={null} />
      </div>
    );
  }
  const message = entry?.error ?? error;
  if (!message) return null;
  return (
    <p role="alert" className="text-xs text-destructive-text">
      {entry ? `Unggah ulang gagal: ${message}` : message}
    </p>
  );
}
