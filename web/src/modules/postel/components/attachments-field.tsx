import { isPostelFileMime } from '@shared/files';
import { POSTEL_LIMITS } from '@shared/postel';
import { Paperclip } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { saveFileDownload } from '@/modules/qrcode/lib/download';
import type { AttachmentRow } from '../lib/schemas';
import { postelFileMime, postelUploadError, uploadPostelFile } from '../lib/upload';

export type { AttachmentRow } from '../lib/schemas';

export interface AttachmentsFieldProps {
  value: readonly AttachmentRow[];
  onChange: (rows: AttachmentRow[]) => void;
  /** Galat dari induk (mis. galat server pada `attachmentIds`). */
  error?: string | undefined;
  /** Dipanggil saat ada/tidaknya unggahan berjalan (induk menahan tombol Simpan). */
  onBusyChange?: ((busy: boolean) => void) | undefined;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const format = (value: number) => value.toLocaleString('id-ID', { maximumFractionDigits: 1 });
  if (bytes < 1_048_576) return `${format(bytes / 1024)} KB`;
  return `${format(bytes / 1_048_576)} MB`;
}

/** Lampiran catatan Postel: unggah gambar/PDF apa adanya (tanpa pengecilan), unduh, dan hapus dari daftar. */
export function AttachmentsField({ value, onChange, error, onBusyChange }: AttachmentsFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Nilai terbaru, termasuk perubahan yang belum sempat dirender induk; dibaca ulang setelah setiap await.
  const valueRef = useRef(value);
  valueRef.current = value;
  const commit = (next: AttachmentRow[]) => {
    valueRef.current = next;
    onChange(next);
  };
  const [uploading, setUploading] = useState(0);
  // Unggahan yang sedang berjalan (dari semua pemilihan berkas): ikut dihitung pada batas jumlah lampiran.
  const pendingRef = useRef(0);
  // Galat berkas dikumpulkan (tanpa duplikat), bukan ditimpa: satu pemilihan dapat memuat beberapa berkas bermasalah.
  const [localErrors, setLocalErrors] = useState<string[]>([]);
  const addError = (message: string) =>
    setLocalErrors((previous) => (previous.includes(message) ? previous : [...previous, message]));
  const busy = uploading > 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: hanya perubahan status sibuk yang dilaporkan
  useEffect(() => onBusyChange?.(busy), [busy]);

  async function addFiles(files: File[]) {
    setLocalErrors([]);
    for (const file of files) {
      if (valueRef.current.length + pendingRef.current >= POSTEL_LIMITS.attachmentsMax) {
        addError(`Maksimal ${POSTEL_LIMITS.attachmentsMax} lampiran`);
        return;
      }
      if (!isPostelFileMime(postelFileMime(file))) {
        addError('Hanya JPEG, PNG, WebP, atau PDF');
        continue;
      }
      if (file.size > POSTEL_LIMITS.attachmentMaxBytes) {
        addError('Berkas melebihi 10 MB');
        continue;
      }
      pendingRef.current += 1;
      setUploading((count) => count + 1);
      try {
        const uploaded = await uploadPostelFile(file);
        commit([...valueRef.current, uploaded]);
      } catch (failure) {
        addError(postelUploadError(failure));
      } finally {
        pendingRef.current -= 1;
        setUploading((count) => count - 1);
      }
    }
  }

  async function download(row: AttachmentRow) {
    setLocalErrors([]);
    try {
      const file = await api('postelFiles.get', { id: row.id });
      saveFileDownload({ bytes: file.bytes, mime: file.mime, filename: row.filename });
    } catch (failure) {
      addError(postelUploadError(failure));
    }
  }

  const messages = [...new Set([...localErrors, ...(error ? [error] : [])])];
  return (
    <div className="space-y-2">
      {value.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada lampiran.</p>
      ) : (
        <ul className="space-y-2">
          {value.map((row, index) => (
            <li key={row.id} className="flex flex-wrap items-center gap-2 text-sm">
              <Paperclip aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 font-medium break-all">{row.filename}</span>
              <span className="text-muted-foreground">{formatSize(row.size)}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void download(row)}>
                Unduh
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Hapus lampiran ${index + 1}`}
                onClick={() => commit(valueRef.current.filter((_, i) => i !== index))}
              >
                Hapus
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={value.length >= POSTEL_LIMITS.attachmentsMax}
          onClick={() => inputRef.current?.click()}
        >
          Tambah lampiran
        </Button>
        <span className="text-xs text-muted-foreground">
          {value.length}/{POSTEL_LIMITS.attachmentsMax}
        </span>
        <span aria-live="polite" className="text-xs text-muted-foreground">
          {busy ? 'Mengunggah lampiran…' : ''}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        JPEG, PNG, WebP, atau PDF; maksimal 10 MB per berkas. Gambar tidak dikecilkan.
      </p>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,application/pdf"
        aria-label="Pilih lampiran"
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = '';
          if (files.length > 0) void addFiles(files);
        }}
      />
      {messages.map((message) => (
        <p key={message} role="alert" className="text-sm text-destructive-text">
          {message}
        </p>
      ))}
    </div>
  );
}
