import type { LabelLayout, QrLayout, QrStyle } from '@shared/qrcode';
import { layoutLabel } from '@shared/qrcode';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { registerCanvasFonts } from '../lib/fonts';
import { createCanvasMeasure, fallbackMeasure } from '../lib/measure';
import { qrMatrix } from '../lib/qr-matrix';
import type { LogoSource } from '../lib/render-canvas';
import { drawLabel } from '../lib/render-canvas';
import type { LabelStatus } from './label-status-alerts';

const PREVIEW_PX_PER_MM = 12;
const ZOOM_PX_PER_MM = 20;
const PLACEHOLDER_LINK = 'https://contoh.com';

export interface LabelPreviewProps {
  title: string;
  subtitle: string;
  footer: string;
  link: string;
  layout: QrLayout;
  /** Gaya teks dan bingkai; kosong = bawaan. */
  style?: QrStyle;
  /** URL gambar logo (data URL) atau `null`. */
  logoUrl: string | null;
  /** Dipanggil tiap tata letak berubah: pemanggil menampilkan banner (isi melebihi kanvas / QR terlalu padat). */
  onStatus?: (status: LabelStatus) => void;
}

/** Pengukur teks: cadangan dahulu, berganti ke pengukur canvas setelah font label siap. */
export function useLabelMeasure() {
  const [measure, setMeasure] = useState(() => fallbackMeasure);
  useEffect(() => {
    let alive = true;
    registerCanvasFonts()
      .then(() => {
        if (alive) setMeasure(() => createCanvasMeasure());
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return measure;
}

/** Kanvas label berukuran besar (20 px per mm) untuk memeriksa detail; memakai tata letak yang sama. */
function ZoomCanvas({
  layout,
  matrix,
  logo,
}: {
  layout: LabelLayout;
  matrix: boolean[][];
  logo: LogoSource | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = ref.current?.getContext('2d');
    if (context) drawLabel(context, layout, matrix, logo, ZOOM_PX_PER_MM);
  }, [layout, matrix, logo]);
  return (
    <canvas
      ref={ref}
      width={30 * ZOOM_PX_PER_MM}
      height={30 * ZOOM_PX_PER_MM}
      aria-label="Pratinjau label diperbesar"
      className="mx-auto h-auto max-w-full rounded border bg-white"
    />
  );
}

/** Pratinjau realtime label 3 × 3 cm: tata letak dihitung ulang tiap isi/ukuran berubah; klik untuk memperbesar. */
export function LabelPreview({
  title,
  subtitle,
  footer,
  link,
  layout,
  style,
  logoUrl,
  onStatus,
}: LabelPreviewProps) {
  const measure = useLabelMeasure();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const linkText = link.trim() === '' ? PLACEHOLDER_LINK : link.trim();
  const matrix = useMemo(() => qrMatrix(linkText), [linkText]);
  const computed = useMemo(
    () =>
      layoutLabel(
        {
          title,
          subtitle,
          footer,
          hasLogo: logo !== null,
          logoAspect: logo ? logo.naturalWidth / logo.naturalHeight : 1,
          layout,
          ...(style ? { style } : {}),
          qrModules: matrix.length,
        },
        measure,
      ),
    [title, subtitle, footer, logo, layout, style, matrix, measure],
  );

  useEffect(() => {
    if (!logoUrl) {
      setLogo(null);
      return;
    }
    let alive = true;
    const image = new Image();
    image.onload = () => {
      if (alive) setLogo(image);
    };
    image.onerror = () => {
      if (alive) setLogo(null);
    };
    image.src = logoUrl;
    return () => {
      alive = false;
    };
  }, [logoUrl]);

  useEffect(() => {
    onStatus?.({
      overflow: computed.overflow,
      tooDense: computed.tooDense,
      frameTight: computed.frameTight,
      moduleMm: computed.moduleMm,
    });
  }, [computed, onStatus]);

  useEffect(() => {
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    drawLabel(
      context,
      computed,
      matrix,
      logo ? { image: logo, width: logo.naturalWidth, height: logo.naturalHeight } : null,
      PREVIEW_PX_PER_MM,
    );
  }, [computed, matrix, logo]);

  return (
    <div className="space-y-2">
      <button
        type="button"
        aria-label="Perbesar pratinjau label"
        title="Klik untuk memperbesar"
        className="block cursor-zoom-in rounded focus-visible:outline-2 focus-visible:outline-offset-2"
        onClick={() => setZoomed(true)}
      >
        <canvas
          ref={canvasRef}
          width={30 * PREVIEW_PX_PER_MM}
          height={30 * PREVIEW_PX_PER_MM}
          aria-label="Pratinjau label 3 × 3 cm"
          className="rounded border bg-white shadow-sm"
          style={{ width: '30mm', height: '30mm', minWidth: 180, minHeight: 180 }}
        />
      </button>
      <Dialog open={zoomed} onOpenChange={setZoomed}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Pratinjau label</DialogTitle>
            <DialogDescription>
              Diperbesar untuk memeriksa detail; ukuran asli 3 × 3 cm.
            </DialogDescription>
          </DialogHeader>
          <ZoomCanvas
            layout={computed}
            matrix={matrix}
            logo={
              logo ? { image: logo, width: logo.naturalWidth, height: logo.naturalHeight } : null
            }
          />
        </DialogContent>
      </Dialog>
      {link.trim() === '' ? (
        <p className="text-xs text-muted-foreground">Isi link untuk melihat QR yang sebenarnya.</p>
      ) : null}
    </div>
  );
}
