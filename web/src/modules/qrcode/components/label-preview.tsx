import type { QrLayout } from '@shared/qrcode';
import { layoutLabel } from '@shared/qrcode';
import { useEffect, useMemo, useRef, useState } from 'react';
import { registerCanvasFonts } from '../lib/fonts';
import { createCanvasMeasure, fallbackMeasure } from '../lib/measure';
import { qrMatrix } from '../lib/qr-matrix';
import { drawLabel } from '../lib/render-canvas';

const PREVIEW_PX_PER_MM = 12;
const PLACEHOLDER_LINK = 'https://contoh.com';

export interface LabelPreviewProps {
  title: string;
  subtitle: string;
  footer: string;
  link: string;
  layout: QrLayout;
  /** URL gambar logo (data URL) atau `null`. */
  logoUrl: string | null;
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

/** Pratinjau realtime label 3 × 3 cm: tata letak dihitung ulang tiap isi/ukuran berubah. */
export function LabelPreview({
  title,
  subtitle,
  footer,
  link,
  layout,
  logoUrl,
}: LabelPreviewProps) {
  const measure = useLabelMeasure();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const linkText = link.trim() === '' ? PLACEHOLDER_LINK : link.trim();
  const matrix = useMemo(() => qrMatrix(linkText), [linkText]);
  const computed = useMemo(
    () =>
      layoutLabel(
        { title, subtitle, footer, hasLogo: logo !== null, layout, qrModules: matrix.length },
        measure,
      ),
    [title, subtitle, footer, logo, layout, matrix, measure],
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
      <canvas
        ref={canvasRef}
        width={30 * PREVIEW_PX_PER_MM}
        height={30 * PREVIEW_PX_PER_MM}
        aria-label="Pratinjau label 3 × 3 cm"
        className="rounded border bg-white shadow-sm"
        style={{ width: '30mm', height: '30mm', minWidth: 180, minHeight: 180 }}
      />
      {link.trim() === '' ? (
        <p className="text-xs text-muted-foreground">Isi link untuk melihat QR yang sebenarnya.</p>
      ) : null}
      {computed.overflow ? (
        <p role="alert" className="text-sm text-destructive">
          Isi melebihi kanvas 3 × 3 cm: perkecil ukuran/teks. Ekspor diblokir sampai muat.
        </p>
      ) : null}
      {computed.tooDense ? (
        <p className="text-sm text-amber-600 dark:text-amber-400">
          QR terlalu padat ({computed.moduleMm.toFixed(2)} mm per modul): pendekkan link atau
          perbesar QR agar mudah dipindai.
        </p>
      ) : null}
    </div>
  );
}
