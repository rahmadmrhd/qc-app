import { Camera, CircleAlert, CircleCheck, RotateCcw, Trash2, Upload, X } from 'lucide-react';
import { useRef } from 'react';
import { Spinner } from '@/components/spinner';
import { Button } from '@/components/ui/button';
import { formatBytes, partitionByType } from './accept';
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
  /** Nama berkas tidak dapat diubah (mis. sumber yang membuat nama sendiri): hanya nama berkas asli yang tampil. */
  hideNames?: boolean;
  /**
   * Tombol "Ambil foto dengan kamera" yang membuka aplikasi kamera bawaan perangkat (`capture`); hasilnya diproses sama
   * dengan berkas yang ditelusuri. Tanpa nilai ini tombolnya tidak dirender (mis. perangkat desktop).
   */
  capture?: 'environment' | 'user' | undefined;
  /** Berkas yang sudah ada di luar antrean (mis. foto yang sudah menempel pada baris): ikut dihitung di "n dari m". */
  countOffset?: number | undefined;
  /** Mode satu berkas: foto baru menggantikan yang ada (tombol kamera tidak berhitung). */
  single?: boolean | undefined;
  /** Pengganti penambahan langsung ke antrean (mis. aturan mode satu berkas di dialog); bawaan: tambah ke antrean. */
  onFiles?(files: File[], rejected: { name: string; reason: string }[]): void;
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
  hideNames,
  capture,
  countOffset = 0,
  single = false,
  onFiles,
}: UploadTabProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const captureRef = useRef<HTMLInputElement>(null);
  const { entries, rejected } = queue;
  // Kamera native = satu jepretan per ketukan (`multiple` tidak konsisten antar peramban): sesudah foto pertama tombolnya
  // menjadi "Ambil foto lagi" dengan hitungan sampai batas. Mode satu berkas (maxFiles 1) mengganti fotonya.
  const shot = countOffset + entries.length;
  const shotMax = maxFiles === undefined ? undefined : countOffset + maxFiles;
  const captureFull = !single && shotMax !== undefined && shot >= shotMax;
  const handleFiles =
    onFiles ??
    ((files: File[], refused: { name: string; reason: string }[]) => {
      queue.add(files);
      queue.addRejected(refused);
    });
  return (
    <FileDropZone
      accept={accept}
      disabled={disabled}
      className="flex min-h-0 flex-1 flex-col gap-3"
      onFiles={handleFiles}
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
        {capture ? (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={disabled || captureFull}
              onClick={() => captureRef.current?.click()}
            >
              <Camera aria-hidden />
              {single || entries.length === 0
                ? 'Ambil foto dengan kamera'
                : `Ambil foto lagi (${shot} dari ${shotMax ?? shot})`}
            </Button>
            <input
              ref={captureRef}
              type="file"
              hidden
              accept="image/*"
              capture={capture}
              data-testid="capture-input"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = '';
                if (files.length > 0) {
                  const split = partitionByType(files, accept);
                  handleFiles(split.files, split.rejected);
                }
              }}
            />
          </>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          multiple={maxFiles !== 1}
          hidden
          accept={accept.join(',')}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            // Pilihan yang sama dapat dipilih lagi.
            event.target.value = '';
            // Pemilih berkas dapat lolos dari filter `accept` (mis. "Semua berkas"): pisahkan menurut tipe seperti drop.
            if (files.length > 0) {
              const split = partitionByType(files, accept);
              handleFiles(split.files, split.rejected);
            }
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
                  {hideNames ? (
                    <span className="truncate" title={entry.file.name}>
                      {entry.file.name}
                    </span>
                  ) : (
                    <InlineName
                      value={entry.name}
                      maxLength={nameMax}
                      readOnly={busy || entry.status === 'done' || disabled}
                      onSave={(name) => queue.rename(entry.key, name)}
                    />
                  )}
                  <span className="truncate text-xs text-muted-foreground">
                    {hideNames
                      ? formatBytes(entry.file.size)
                      : `${entry.file.name} · ${formatBytes(entry.file.size)}`}
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
