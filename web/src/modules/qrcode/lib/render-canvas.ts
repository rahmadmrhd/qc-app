import type { LabelLayout } from '@shared/qrcode';
import { LABEL_MM, PT_PER_MM } from '@shared/qrcode';
import { LABEL_FONT_FAMILY } from './fonts';

export interface LogoSource {
  image: CanvasImageSource;
  width: number;
  height: number;
}

/** Gambar yang muat di kotak persegi `boxMm` dengan aspek terjaga dan terpusat. */
export function containRect(srcW: number, srcH: number, boxMm: number) {
  const scale = boxMm / Math.max(srcW, srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { dx: (boxMm - w) / 2, dy: (boxMm - h) / 2, w, h };
}

function darkRuns(row: readonly boolean[]): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let start = -1;
  row.forEach((dark, index) => {
    if (dark && start < 0) start = index;
    if (!dark && start >= 0) {
      runs.push([start, index - start]);
      start = -1;
    }
  });
  if (start >= 0) runs.push([start, row.length - start]);
  return runs;
}

/** Menggambar label 30 × 30 mm; `pxPerMm` menentukan resolusi (12 = pratinjau, ~23,6 = 600 dpi). */
export function drawLabel(
  ctx: CanvasRenderingContext2D,
  layout: LabelLayout,
  matrix: boolean[][],
  logo: LogoSource | null,
  pxPerMm: number,
): void {
  const side = LABEL_MM * pxPerMm;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, side, side);
  for (const element of layout.elements) {
    if (element.kind === 'qr') {
      const modulePx = (element.sizeMm * pxPerMm) / matrix.length;
      const originX = element.xMm * pxPerMm;
      const originY = element.yMm * pxPerMm;
      ctx.fillStyle = '#000000';
      matrix.forEach((row, r) => {
        const y0 = Math.round(originY + r * modulePx);
        const y1 = Math.round(originY + (r + 1) * modulePx);
        for (const [start, length] of darkRuns(row)) {
          const x0 = Math.round(originX + start * modulePx);
          const x1 = Math.round(originX + (start + length) * modulePx);
          ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        }
      });
    } else if (element.kind === 'logo' && logo) {
      const back = element.backdropMm * pxPerMm;
      const cx = (element.xMm + element.sizeMm / 2) * pxPerMm;
      const cy = (element.yMm + element.sizeMm / 2) * pxPerMm;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - back / 2, cy - back / 2, back, back);
      const fit = containRect(logo.width, logo.height, element.sizeMm);
      ctx.drawImage(
        logo.image,
        (element.xMm + fit.dx) * pxPerMm,
        (element.yMm + fit.dy) * pxPerMm,
        fit.w * pxPerMm,
        fit.h * pxPerMm,
      );
    } else if (element.kind === 'text') {
      ctx.fillStyle = '#000000';
      ctx.font = `${element.bold ? 600 : 400} ${(element.sizePt / PT_PER_MM) * pxPerMm}px ${LABEL_FONT_FAMILY}, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(element.text, element.centerMm * pxPerMm, element.baselineMm * pxPerMm);
    }
  }
}

export function renderLabelCanvas(
  layout: LabelLayout,
  matrix: boolean[][],
  logo: LogoSource | null,
  pxPerMm: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const side = Math.round(LABEL_MM * pxPerMm);
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Peramban tidak mendukung pengolahan gambar');
  drawLabel(ctx, layout, matrix, logo, pxPerMm);
  return canvas;
}
