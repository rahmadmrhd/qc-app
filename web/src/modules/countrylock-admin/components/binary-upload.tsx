import type { ClFileDto } from '@shared/contract';
import { CL_BINARY_MAX_BYTES, validateClPath } from '@shared/countrylock-bundle';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { formatBytes } from '@/components/file-dialog/accept';
import { FilePicker } from '@/components/file-dialog/file-picker';
import { FormDialogShell } from '@/components/form-dialog-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { describeError } from '@/lib/api/describe-error';
import { uploadBinary } from '../lib/upload-chunks';
import { useAfterUpload } from '../queries';

const FORM_ID = 'cl-binary-upload-form';

export interface BinaryUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Jalur tetap (unggah versi baru berkas yang ada); kosong = nama dari pengguna (berkas baru). */
  fixedPath?: string;
  /** Judul dialog; bawaan menurut `fixedPath`. */
  title?: string;
  onUploaded: (file: ClFileDto) => void;
}

/**
 * Dialog unggah berkas biner router (firmware, `.npk`, `.cfg`): pilih berkas (jenis apa pun, maks. 64 MB), nama jalur di
 * bundel, lalu unggah bertahap dengan kemajuan. Menutup dialog saat berjalan membatalkan unggahan.
 */
export function BinaryUploadDialog({
  open,
  onOpenChange,
  fixedPath,
  title,
  onUploaded,
}: BinaryUploadDialogProps) {
  const [path, setPath] = useState(fixedPath ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const afterUpload = useAfterUpload();
  const controller = useRef<AbortController | null>(null);
  const uploading = progress !== null;

  // Dialog dibuka ulang = isian bersih.
  useEffect(() => {
    if (open) {
      setPath(fixedPath ?? '');
      setFile(null);
      setError(null);
      setProgress(null);
    } else {
      controller.current?.abort();
    }
  }, [open, fixedPath]);

  const pick = (files: File[]) => {
    const picked = files[0];
    if (!picked) return;
    setError(null);
    if (picked.size === 0) {
      setError('Berkas kosong');
      return;
    }
    if (picked.size > CL_BINARY_MAX_BYTES) {
      setError(`Ukuran melebihi ${formatBytes(CL_BINARY_MAX_BYTES)}`);
      return;
    }
    setFile(picked);
    if (fixedPath === undefined && path.trim() === '') setPath(picked.name);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (uploading) return;
    const target = (fixedPath ?? path).trim();
    const pathProblem = validateClPath(target);
    if (pathProblem !== null) {
      setError(pathProblem);
      return;
    }
    if (!file) {
      setError('Pilih berkas yang akan diunggah');
      return;
    }
    setError(null);
    setProgress(0);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const saved = await uploadBinary(file, target, {
        signal: abort.signal,
        onProgress: (sent, total) => setProgress(Math.round((sent / total) * 100)),
      });
      // Cache daftar/riwayat/draf disegarkan apa pun yang terjadi: berkasnya sudah ada di server.
      afterUpload(saved);
      if (abort.signal.aborted) {
        // Dialog ditutup tepat saat perakitan akhir: jangan berpindah halaman atau menutup dialog lain.
        toast.info(`${saved.path} sempat selesai diunggah sebelum dibatalkan`);
        return;
      }
      toast.success(`${saved.path} diunggah`);
      onUploaded(saved);
      onOpenChange(false);
    } catch (failure) {
      if (!abort.signal.aborted) setError(describeError(failure));
    } finally {
      setProgress(null);
      controller.current = null;
    }
  };

  return (
    <FormDialogShell
      open={open}
      onOpenChange={onOpenChange}
      formId={FORM_ID}
      title={title ?? (fixedPath === undefined ? 'Unggah berkas biner' : 'Unggah versi baru')}
      description="Berkas diunggah ke Drive dan diteruskan ke router jump saat inject. Maksimal 64 MB."
      submitting={uploading}
      submitLabel="Unggah"
    >
      <form id={FORM_ID} onSubmit={(event) => void submit(event)} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="cl-upload-path" required>
            Nama berkas di bundel
          </Label>
          <Input
            id="cl-upload-path"
            value={fixedPath ?? path}
            disabled={fixedPath !== undefined || uploading}
            required
            aria-required="true"
            placeholder="mis. firmware/system.npk"
            onChange={(event) => setPath(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Berkas</Label>
          <div className="flex flex-wrap items-center gap-3">
            <FilePicker accept={[]} anyType disabled={uploading} onFiles={pick}>
              Pilih berkas
            </FilePicker>
            <span className="min-w-0 truncate text-sm text-muted-foreground">
              {file ? `${file.name} (${formatBytes(file.size)})` : 'Belum ada berkas dipilih'}
            </span>
          </div>
        </div>
        {progress === null ? null : (
          <div className="space-y-1">
            <progress
              className="h-2 w-full"
              value={progress}
              max={100}
              aria-label="Kemajuan unggahan"
            />
            <p className="text-sm text-muted-foreground">
              Mengunggah… {progress}%. Tutup dialog (X atau Esc) untuk membatalkan.
            </p>
          </div>
        )}
        {error === null ? null : (
          <Alert color="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </form>
    </FormDialogShell>
  );
}
