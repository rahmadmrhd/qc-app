import { POSTEL_LIMITS } from '@shared/postel';
import { Paperclip } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  AttachDialog,
  type AttachmentItem,
  AttachmentView,
  FileDropZone,
} from '@/components/file-dialog';
import { fileMime } from '@/components/file-dialog/accept';
import { useBackgroundUploads } from '@/components/file-dialog/use-background-uploads';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { saveFileDownload } from '@/modules/qrcode/lib/download';
import { postelSource } from '../lib/postel-source';
import type { AttachmentRow } from '../lib/schemas';
import { postelUploadError } from '../lib/upload';
import { usePostelFileUrl } from '../queries';

export type { AttachmentRow } from '../lib/schemas';

export interface AttachmentsFieldProps {
  value: readonly AttachmentRow[];
  onChange: (rows: AttachmentRow[]) => void;
  /** Galat dari induk (mis. galat server pada `attachmentIds`). */
  error?: string | undefined;
  /** Dipanggil saat ada/tidaknya unggahan berjalan (induk menahan tombol Simpan). */
  onBusyChange?: ((busy: boolean) => void) | undefined;
}

const OWNER = 'attachments';
const MAX = POSTEL_LIMITS.attachmentsMax;

interface DialogState {
  open: boolean;
  files: File[];
  rejected: { name: string; reason: string }[];
}

const CLOSED: DialogState = { open: false, files: [], rejected: [] };

/** Gambar lampiran (thumbnail atau besar) dimuat lewat `postelFiles.get` (privat) sebagai URL objek. */
function PostelImage({
  id,
  alt,
  variant,
}: {
  id: string;
  alt: string;
  variant: 'thumb' | 'large';
}) {
  const { url, isLoading, isError } = usePostelFileUrl(id);
  if (isLoading) {
    return (
      <div role="img" aria-label="Memuat gambar" className="size-full animate-pulse bg-muted" />
    );
  }
  if (isError || !url) {
    return (
      <div
        role="img"
        aria-label="Gambar tidak tersedia"
        className="flex size-full items-center justify-center bg-muted text-xs text-muted-foreground"
      >
        Tidak tersedia
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      className={
        variant === 'thumb' ? 'size-full object-cover' : 'max-h-[70dvh] max-w-full object-contain'
      }
    />
  );
}

/**
 * Lampiran catatan Postel: gambar atau PDF apa adanya (tanpa pengecilan; desain stiker perlu resolusi asli) lewat
 * dialog lampiran (Telusuri, seret-lepas, Kamera) dan unggahan latar. Gambar dapat diperbesar; PDF hanya diunduh.
 */
export function AttachmentsField({ value, onChange, error, onBusyChange }: AttachmentsFieldProps) {
  // Nilai terbaru, termasuk perubahan yang belum sempat dirender induk; dibaca ulang saat unggahan selesai.
  const valueRef = useRef(value);
  valueRef.current = value;
  const commit = (next: AttachmentRow[]) => {
    valueRef.current = next;
    onChange(next);
  };
  const [dialog, setDialog] = useState<DialogState>(CLOSED);
  const [full, setFull] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const uploads = useBackgroundUploads({
    source: postelSource,
    onUploaded: (_owner, item) => {
      if (valueRef.current.length >= MAX) {
        setFull(true);
        return false;
      }
      commit([
        ...valueRef.current,
        {
          id: item.id,
          mime: fileMime({ name: item.name, type: '' }),
          size: item.size,
          filename: item.name,
        },
      ]);
      return true;
    },
  });
  const own = uploads.forOwner(OWNER);
  // Unggahan yang menunggu/berjalan sudah mengisi kuota; yang gagal tidak.
  const reserved = own.entries.filter((entry) => entry.phase !== 'failed').length;
  const remaining = Math.max(0, MAX - value.length - reserved);
  const busy = own.busy;
  const onBusyChangeRef = useRef(onBusyChange);
  onBusyChangeRef.current = onBusyChange;
  useEffect(() => {
    onBusyChangeRef.current?.(busy);
    return () => onBusyChangeRef.current?.(false);
  }, [busy]);

  function openDialog(files: File[], rejected: { name: string; reason: string }[]) {
    if (files.length === 0 && rejected.length === 0) return;
    if (remaining <= 0) {
      setFull(true);
      return;
    }
    setFull(false);
    setDialog({ open: true, files, rejected });
  }

  async function download(row: AttachmentRow) {
    setDownloadError(null);
    try {
      const file = await api('postelFiles.get', { id: row.id });
      saveFileDownload({ bytes: file.bytes, mime: file.mime, filename: row.filename });
    } catch (failure) {
      setDownloadError(postelUploadError(failure));
    }
  }

  const items: AttachmentItem[] = value.map((row) => ({
    id: row.id,
    name: row.filename,
    mime: row.mime,
    size: row.size,
    ...(row.mime.startsWith('image/')
      ? {
          renderImage: (variant: 'thumb' | 'large') => (
            <PostelImage id={row.id} alt={row.filename} variant={variant} />
          ),
        }
      : { onDownload: () => void download(row) }),
  }));

  const messages = [
    ...new Set([
      ...(full ? [`Maksimal ${MAX} lampiran`] : []),
      ...(downloadError ? [downloadError] : []),
      ...(error ? [error] : []),
    ]),
  ];
  return (
    <>
      <FileDropZone accept={postelSource.mimeTypes} onFiles={openDialog} className="space-y-2">
        {value.length === 0 && own.entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada lampiran.</p>
        ) : null}
        <AttachmentView
          items={items}
          pending={own.entries}
          layout="list"
          label="lampiran"
          onRemove={(id) => commit(valueRef.current.filter((row) => row.id !== id))}
          onRetry={own.retry}
          onCancel={own.remove}
        />
        <div className="flex items-center gap-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={remaining <= 0}
            onClick={() => {
              setFull(false);
              setDialog({ open: true, files: [], rejected: [] });
            }}
          >
            <Paperclip aria-hidden="true" />
            Tambah lampiran
          </Button>
          <span className="text-xs text-muted-foreground">
            {value.length + reserved}/{MAX}
          </span>
          <span aria-live="polite" className="text-xs text-muted-foreground">
            {busy ? 'Mengunggah lampiran…' : ''}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          JPEG, PNG, WebP, atau PDF; maksimal 10 MB per berkas. Gambar tidak dikecilkan.
        </p>
        {messages.map((message) => (
          <p key={message} role="alert" className="text-sm text-destructive">
            {message}
          </p>
        ))}
      </FileDropZone>
      {dialog.open ? (
        <AttachDialog
          open
          onOpenChange={(open) => {
            if (!open) setDialog(CLOSED);
          }}
          source={postelSource}
          mode="multiple"
          accept={['image', 'pdf']}
          maxBytes={POSTEL_LIMITS.attachmentMaxBytes}
          maxFiles={Math.max(1, remaining)}
          initialFiles={dialog.files.length > 0 ? dialog.files : undefined}
          initialRejected={dialog.rejected.length > 0 ? dialog.rejected : undefined}
          showLibrary={false}
          camera
          hideNames
          title="Tambah lampiran"
          confirmLabel="Tambahkan"
          onConfirm={(result) => own.add(result.files)}
        />
      ) : null}
    </>
  );
}
