import type { QrLayout } from '@shared/qrcode';
import { LABEL_MM, layoutLabel, SHEET, sheetCells } from '@shared/qrcode';
import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { registerCanvasFonts } from '../lib/fonts';
import { createCanvasMeasure } from '../lib/measure';
import { qrMatrix } from '../lib/qr-matrix';
import { renderLabelCanvas } from '../lib/render-canvas';

const SHEET_PX_PER_MM = 2;

export interface SheetPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  design: { title: string; subtitle: string; footer: string; link: string; layout: QrLayout };
  logoUrl: string | null;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Logo tidak dapat dimuat'));
    image.src = url;
  });
}

/** Pratinjau seluruh lembar 10 × 14 (hanya saat dibuka); tidak ada efek samping. */
export function SheetPreviewDialog({
  open,
  onOpenChange,
  design,
  logoUrl,
}: SheetPreviewDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setState('loading');
    (async () => {
      await registerCanvasFonts().catch(() => undefined);
      const matrix = qrMatrix(design.link.trim() || 'https://contoh.com');
      const logo = logoUrl ? await loadImage(logoUrl) : null;
      const layout = layoutLabel(
        { ...design, hasLogo: logo !== null, qrModules: matrix.length },
        createCanvasMeasure(),
      );
      const label = renderLabelCanvas(
        layout,
        matrix,
        logo ? { image: logo, width: logo.naturalWidth, height: logo.naturalHeight } : null,
        SHEET_PX_PER_MM * 4,
      );
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d');
      if (!alive || !canvas || !context) return;
      const side = LABEL_MM * SHEET_PX_PER_MM;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      for (const cell of sheetCells()) {
        context.drawImage(
          label,
          cell.xMm * SHEET_PX_PER_MM,
          cell.yMm * SHEET_PX_PER_MM,
          side,
          side,
        );
      }
      context.strokeStyle = '#737373';
      context.lineWidth = 1;
      for (let c = 0; c <= SHEET.columns; c++) {
        context.strokeRect(c * side, 0, 0, canvas.height);
      }
      for (let r = 0; r <= SHEET.rows; r++) {
        context.strokeRect(0, r * side, canvas.width, 0);
      }
      setState('ready');
    })().catch(() => {
      if (alive) setState('error');
    });
    return () => {
      alive = false;
    };
  }, [open, design, logoUrl]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-auto">
        <DialogHeader>
          <DialogTitle>Pratinjau lembar 10 × 14</DialogTitle>
          <DialogDescription>
            Lembar 300 × 420 mm dengan sel 30 mm tanpa margin dan garis potong. Ini hanya pratinjau;
            belum ada yang disimpan.
          </DialogDescription>
        </DialogHeader>
        {state === 'loading' ? (
          <p className="text-sm text-muted-foreground">Menyiapkan pratinjau…</p>
        ) : null}
        {state === 'error' ? (
          <p role="alert" className="text-sm text-destructive">
            Pratinjau gagal dibuat.
          </p>
        ) : null}
        <canvas
          ref={canvasRef}
          width={SHEET.widthMm * SHEET_PX_PER_MM}
          height={SHEET.heightMm * SHEET_PX_PER_MM}
          aria-label="Pratinjau lembar 10 × 14"
          className="mx-auto h-auto max-w-full border bg-white"
        />
      </DialogContent>
    </Dialog>
  );
}
