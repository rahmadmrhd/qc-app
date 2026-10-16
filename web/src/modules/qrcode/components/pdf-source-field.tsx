import { QR_LIMITS } from '@shared/qrcode';
import type { QrDocumentDto } from '@shared/rpc';
import { useEffect, useState } from 'react';
import { BusyLabel } from '@/components/spinner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { looksLikePdf } from '../lib/document-name';

export interface PdfSourceFieldProps {
  document: QrDocumentDto | null;
  onDocument: (document: QrDocumentDto) => void;
  /** Mengunggah (atau mengganti isi bila `replaceId` ada) dan mengembalikan dokumen terbaru. */
  onUpload: (file: File, replaceId?: string) => Promise<QrDocumentDto>;
  /** Menyalin berkas Drive (link atau fileId) ke folder aplikasi sebagai PDF sumber baru. */
  onClone: (source: string) => Promise<QrDocumentDto>;
  /** Konfigurasi sudah diekspor: PDF hanya boleh diganti isinya (URL tetap), tanpa opsi PDF baru. */
  replaceOnly?: boolean;
  /** Dipanggil saat proses (unggah/salin) mulai/selesai; induk menonaktifkan Simpan selama berjalan. */
  onBusyChange?: (busy: boolean) => void;
}

/** Sumber link dari PDF yang diunggah ke Drive; link QR = URL berbagi berkas. */
export function PdfSourceField({
  document,
  onDocument,
  onUpload,
  onClone,
  replaceOnly = false,
  onBusyChange,
}: PdfSourceFieldProps) {
  const [pending, setPending] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [task, setTaskState] = useState<'clone' | 'upload' | null>(null);
  const busy = task !== null;
  const setTask = (next: 'clone' | 'upload' | null) => {
    setTaskState(next);
    onBusyChange?.(next !== null);
  };
  const [copied, setCopied] = useState(false);
  const [driveSource, setDriveSource] = useState('');
  // PDF yang dipakai banyak konfigurasi: bawaan PDF BARU agar isi bersama (dan label tercetak lain) tidak tertimpa.
  const [mode, setMode] = useState<'replace' | 'new'>(
    document !== null && document.uses > 1 && !replaceOnly ? 'new' : 'replace',
  );
  const documentId = document?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: hanya saat dokumen yang terpasang berganti
  useEffect(() => {
    setMode(document !== null && document.uses > 1 && !replaceOnly ? 'new' : 'replace');
  }, [documentId]);
  const replacing = document !== null && (replaceOnly || mode === 'replace');

  function choose(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (!looksLikePdf(file)) {
      setError('Hanya berkas PDF yang dapat diunggah');
      return;
    }
    if (file.size > QR_LIMITS.documentMaxBytes) {
      setError('Ukuran PDF maksimal 10 MB');
      return;
    }
    setPending(file);
  }

  async function cloneFromDrive() {
    setError(null);
    setTask('clone');
    try {
      onDocument(await onClone(driveSource.trim()));
      setDriveSource('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gagal menyalin PDF dari Drive');
    } finally {
      setTask(null);
    }
  }

  async function confirm() {
    if (!pending) return;
    setTask('upload');
    try {
      onDocument(await onUpload(pending, replacing ? document?.id : undefined));
      setPending(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gagal mengunggah PDF');
      setPending(null);
    } finally {
      setTask(null);
    }
  }

  return (
    <div className="space-y-3">
      {document && replaceOnly ? (
        <p className="text-sm text-muted-foreground">
          Konfigurasi ini sudah diekspor: PDF hanya dapat diganti isinya (URL tetap
          {document.uses > 1 ? `; memengaruhi ${document.uses} konfigurasi yang memakainya` : ''}).
        </p>
      ) : null}
      {document && !replaceOnly ? (
        <div role="radiogroup" aria-label="Mode unggah PDF" className="space-y-1.5">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="qr-pdf-mode"
              checked={mode === 'replace'}
              onChange={() => setMode('replace')}
            />
            <span>
              Ganti isi PDF ini (URL tetap; memengaruhi {document.uses} konfigurasi yang memakainya)
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="qr-pdf-mode"
              checked={mode === 'new'}
              onChange={() => setMode('new')}
            />
            <span>Pakai PDF baru (URL baru; konfigurasi lain tidak berubah)</span>
          </label>
        </div>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="qr-pdf-file">Pilih PDF</Label>
        <Input
          id="qr-pdf-file"
          type="file"
          accept="application/pdf"
          disabled={busy}
          onChange={(event) => {
            choose(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <p className="text-xs text-muted-foreground">
          {replacing ? 'Mengganti PDF mempertahankan URL yang sama. ' : ''}Maksimal 10 MB.
        </p>
      </div>
      {!replaceOnly && (document === null || mode === 'new') ? (
        <div className="space-y-1.5">
          <Label htmlFor="qr-drive-source">Atau salin dari Google Drive</Label>
          <div className="flex gap-2">
            <Input
              id="qr-drive-source"
              placeholder="Link atau ID berkas Drive"
              value={driveSource}
              disabled={busy}
              onChange={(event) => setDriveSource(event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              disabled={busy || driveSource.trim() === ''}
              onClick={() => void cloneFromDrive()}
            >
              {task === 'clone' ? <BusyLabel>Menyalin…</BusyLabel> : 'Salin dari Drive'}
            </Button>
          </div>
          {task === 'clone' ? (
            <p role="status" className="text-sm">
              <BusyLabel>Memeriksa berkas di Drive, lalu menyalinnya ke folder aplikasi…</BusyLabel>
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            PDF disalin ke folder aplikasi dan dibagikan ke siapa saja yang punya link; berkas asli
            tidak diubah. URL salinan tetap, isinya dapat diganti kemudian.
          </p>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {document ? (
        <div className="space-y-1.5 rounded-md border p-3">
          <p className="text-sm">
            <span className="font-medium">{document.name}</span> · dipakai {document.uses}{' '}
            konfigurasi
          </p>
          <Label htmlFor="qr-pdf-link" className="text-xs text-muted-foreground">
            URL berbagi (isi QR)
          </Label>
          <div className="flex gap-2">
            <Input id="qr-pdf-link" readOnly value={document.link} />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void navigator.clipboard?.writeText(document.link);
                setCopied(true);
              }}
            >
              {copied ? 'Tersalin' : 'Salin'}
            </Button>
            <Button asChild type="button" variant="outline">
              <a href={document.link} target="_blank" rel="noopener noreferrer">
                Lihat PDF
              </a>
            </Button>
          </div>
        </div>
      ) : null}
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => (open ? undefined : setPending(null))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{replacing ? 'Ganti PDF?' : 'Bagikan PDF lewat link?'}</DialogTitle>
            <DialogDescription>
              {replacing
                ? `Isi PDF diganti dengan "${pending?.name ?? ''}"; URL tetap sama sehingga label yang sudah tercetak tetap valid, tetapi pemindai akan melihat dokumen baru. ${document?.uses ?? 0} konfigurasi yang memakai PDF ini ikut berubah.`
                : `"${pending?.name ?? ''}" akan disimpan di Drive dan dibagikan kepada siapa saja yang punya link (hanya lihat). Siapa pun yang memindai QR atau memegang link dapat membukanya. Berbagi dicabut otomatis bila PDF tidak dipakai konfigurasi mana pun.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPending(null)}>
              Batal
            </Button>
            <Button type="button" disabled={busy} onClick={() => void confirm()}>
              {task === 'upload' ? (
                <BusyLabel>
                  {replacing
                    ? 'Mengganti isi PDF di Drive…'
                    : 'Mengunggah PDF ke Drive dan membagikannya…'}
                </BusyLabel>
              ) : replacing ? (
                'Ganti PDF'
              ) : (
                'Bagikan dan unggah'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
