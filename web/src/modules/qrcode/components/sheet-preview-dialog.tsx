import type { QrLayout, QrStyle } from '@shared/qrcode';
import { LABEL_MM, layoutLabel, SHEET, sheetCells } from '@shared/qrcode';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
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

const SHEET_PX_PER_MM = 4;
/** Tingkat zoom (1 = pas lebar kotak pratinjau). */
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;
const FIT_INDEX = ZOOM_STEPS.indexOf(1);

export interface SheetPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  design: {
    title: string;
    subtitle: string;
    footer: string;
    link: string;
    layout: QrLayout;
    style?: QrStyle;
  };
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
  // Ref berbasis state: isi dialog baru ada setelah Radix memasangnya, jadi efek harus menunggu elemennya.
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [zoomIndex, setZoomIndex] = useState(FIT_INDEX);
  const zoom = ZOOM_STEPS[zoomIndex] ?? 1;
  const stepZoom = (delta: number) =>
    setZoomIndex((index) => Math.min(ZOOM_STEPS.length - 1, Math.max(0, index + delta)));

  // Dibuka ulang = kembali pas lebar.
  useEffect(() => {
    if (open) setZoomIndex(FIT_INDEX);
  }, [open]);

  // Ctrl + roda (juga pinch di trackpad) = zoom; roda biasa tetap menggulir. Listener asli (non-pasif)
  // karena preventDefault tidak berlaku pada listener roda React yang pasif.
  useEffect(() => {
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      setZoomIndex((index) =>
        Math.min(ZOOM_STEPS.length - 1, Math.max(0, index + (event.deltaY < 0 ? 1 : -1))),
      );
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [viewport]);
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
        {
          ...design,
          hasLogo: logo !== null,
          logoAspect: logo ? logo.naturalWidth / logo.naturalHeight : 1,
          qrModules: matrix.length,
        },
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
      <DialogContent className="flex max-h-[95vh] w-[95vw] flex-col gap-3 sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Pratinjau lembar 10 × 14</DialogTitle>
          <DialogDescription>
            Lembar 300 × 420 mm dengan sel 30 mm tanpa margin dan garis potong. Ini hanya pratinjau;
            belum ada yang disimpan. Zoom dengan tombol di bawah atau Ctrl + roda mouse.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Perkecil zoom"
            disabled={zoomIndex === 0}
            onClick={() => stepZoom(-1)}
          >
            −
          </Button>
          <span className="min-w-12 text-center text-sm tabular-nums" aria-live="polite">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Perbesar zoom"
            disabled={zoomIndex === ZOOM_STEPS.length - 1}
            onClick={() => stepZoom(1)}
          >
            +
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={zoomIndex === FIT_INDEX}
            onClick={() => setZoomIndex(FIT_INDEX)}
          >
            Pas lebar
          </Button>
        </div>
        {state === 'loading' ? (
          <p className="text-sm text-muted-foreground">Menyiapkan pratinjau…</p>
        ) : null}
        {state === 'error' ? (
          <p role="alert" className="text-sm text-destructive">
            Pratinjau gagal dibuat.
          </p>
        ) : null}
        <div
          ref={setViewport}
          data-testid="sheet-viewport"
          className="min-h-0 flex-1 overflow-auto rounded border bg-muted/30"
        >
          <canvas
            ref={canvasRef}
            width={SHEET.widthMm * SHEET_PX_PER_MM}
            height={SHEET.heightMm * SHEET_PX_PER_MM}
            aria-label="Gambar lembar 10 × 14"
            className="mx-auto block h-auto max-w-none border bg-white"
            style={{ width: `${zoom * 100}%` }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
