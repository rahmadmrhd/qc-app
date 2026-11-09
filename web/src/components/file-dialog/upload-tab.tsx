import { CircleAlert, CircleCheck, RotateCcw, Trash2, Upload, X } from 'lucide-react';
import { useRef } from 'react';
import { Spinner } from '@/components/spinner';
import { Button } from '@/components/ui/button';
import { formatBytes } from './accept';
import { FileDropZone } from './file-drop-zone';
import { InlineName } from './inline-name';
import type { UploadQueue } from './use-upload-queue';

export interface UploadTabProps {
  queue: UploadQueue;
  accept: readonly string[];
  maxBytes: number;
  maxFiles?: number;
  /** Panjang maksimum nama entri (karakter). */
  nameMax?: number;
  disabled?: boolean;
}

const STATUS_LABEL = { waiting: 'Menunggu', uploading: 'Mengunggah', done: 'Selesai' } as const;

/** Tab Unggah: seret-lepas/Telusuri, daftar antrean (ubah nama, hapus, ulangi), dan berkas yang ditolak. */
export function UploadTab({
  queue,
  accept,
  maxBytes,
  maxFiles,
  nameMax,
  disabled,
}: UploadTabProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { entries, rejected } = queue;
  return (
    <FileDropZone
      accept={accept}
      disabled={disabled}
      className="flex min-h-0 flex-1 flex-col gap-3"
      onFiles={(files, refused) => {
        queue.add(files);
        queue.addRejected(refused);
      }}
    >
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center">
        <Upload aria-hidden className="size-6 text-muted-foreground" />
        <p className="text-sm">Seret gambar ke sini, atau</p>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          Telusuri
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept={accept.join(',')}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            // Pilihan yang sama dapat dipilih lagi.
            event.target.value = '';
            // Berkas di luar `accept` yang lolos dari filter pemilih tetap ditolak di `queue.add`.
            if (files.length > 0) queue.add(files);
          }}
        />
        <p className="text-xs text-muted-foreground">
          Maksimum {formatBytes(maxBytes)} per berkas
          {maxFiles ? `, hingga ${maxFiles} berkas sekali unggah` : ''}.
        </p>
      </div>

      {rejected.length > 0 ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium text-destructive">
              {rejected.length} berkas tidak dapat ditambahkan
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Tutup daftar berkas ditolak"
              onClick={queue.clearRejected}
            >
              <X />
            </Button>
          </div>
          <ul aria-label="Berkas ditolak" className="mt-1 space-y-0.5">
            {rejected.map((item, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: nama berkas boleh kembar
              <li key={`${item.name}-${index}`} className="break-words">
                <span className="font-medium">{item.name}</span>
                <span className="text-muted-foreground"> — {item.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {entries.length > 0 ? (
        <ul aria-label="Antrean unggah" className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {entries.map((entry) => {
            const busy = entry.status === 'uploading';
            return (
              <li
                key={entry.key}
                className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm"
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <InlineName
                    value={entry.name}
                    maxLength={nameMax}
                    readOnly={busy || entry.status === 'done' || disabled}
                    onSave={(name) => queue.rename(entry.key, name)}
                  />
                  <span className="truncate text-xs text-muted-foreground">
                    {entry.file.name} · {formatBytes(entry.file.size)}
                  </span>
                  {entry.status === 'failed' && entry.error ? (
                    <span className="text-xs text-destructive">{entry.error}</span>
                  ) : null}
                </div>
                <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  {busy ? <Spinner /> : null}
                  {entry.status === 'done' ? (
                    <CircleCheck aria-hidden className="size-4 text-green-600" />
                  ) : null}
                  {entry.status === 'failed' ? (
                    <CircleAlert aria-hidden className="size-4 text-destructive" />
                  ) : null}
                  {entry.status === 'failed' ? 'Gagal' : STATUS_LABEL[entry.status]}
                </span>
                {entry.status === 'failed' ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Ulangi ${entry.name}`}
                    disabled={disabled}
                    onClick={() => queue.retry(entry.key)}
                  >
                    <RotateCcw />
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Hapus ${entry.name} dari antrean`}
                  disabled={busy || disabled}
                  onClick={() => queue.remove(entry.key)}
                >
                  <Trash2 />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </FileDropZone>
  );
}
