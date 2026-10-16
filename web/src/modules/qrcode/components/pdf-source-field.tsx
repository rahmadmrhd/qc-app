import { QR_LIMITS } from '@shared/qrcode';
import type { QrDocumentDto } from '@shared/rpc';
import { useState } from 'react';
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

export interface PdfSourceFieldProps {
  document: QrDocumentDto | null;
  onDocument: (document: QrDocumentDto) => void;
  /** Mengunggah (atau mengganti isi bila `replaceId` ada) dan mengembalikan dokumen terbaru. */
  onUpload: (file: File, replaceId?: string) => Promise<QrDocumentDto>;
}

/** Sumber link dari PDF yang diunggah ke Drive; link QR = URL berbagi berkas. */
export function PdfSourceField({ document, onDocument, onUpload }: PdfSourceFieldProps) {
  const [pending, setPending] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const replacing = document !== null;

  function choose(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (file.type !== 'application/pdf') {
      setError('Hanya berkas PDF yang dapat diunggah');
      return;
    }
    if (file.size > QR_LIMITS.documentMaxBytes) {
      setError('Ukuran PDF maksimal 10 MB');
      return;
    }
    setPending(file);
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    try {
      onDocument(await onUpload(pending, document?.id));
      setPending(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Gagal mengunggah PDF');
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
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
                : `"${pending?.name ?? ''}" akan disimpan di Drive dan dibagikan kepada siapa saja yang punya link (hanya lihat). Siapa pun yang memindai QR atau memegang link dapat membukanya.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPending(null)}>
              Batal
            </Button>
            <Button type="button" disabled={busy} onClick={() => void confirm()}>
              {replacing ? 'Ganti PDF' : 'Bagikan dan unggah'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
