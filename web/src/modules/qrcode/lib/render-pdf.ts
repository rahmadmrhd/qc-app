import fontkit from '@pdf-lib/fontkit';
import type { LabelLayout } from '@shared/qrcode';
import { LABEL_MM, PT_PER_MM, SHEET, sheetCells } from '@shared/qrcode';
import { PDFDocument, rgb } from 'pdf-lib';

export interface PdfFonts {
  regular: ArrayBuffer | Uint8Array;
  bold: ArrayBuffer | Uint8Array;
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

/** Satu label 30 × 30 mm sebagai PDF vektor (QR = kotak, teks = font tersemat). */
async function buildLabelPdf(
  layout: LabelLayout,
  matrix: boolean[][],
  logoPng: Uint8Array | null,
  fonts: PdfFonts,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(fonts.regular, { subset: true });
  const bold = await doc.embedFont(fonts.bold, { subset: true });
  const side = LABEL_MM * PT_PER_MM;
  const page = doc.addPage([side, side]);
  const black = rgb(0, 0, 0);
  const white = rgb(1, 1, 1);
  page.drawRectangle({ x: 0, y: 0, width: side, height: side, color: white });
  const logoImage = logoPng ? await doc.embedPng(logoPng) : null;
  for (const element of layout.elements) {
    if (element.kind === 'qr') {
      const cell = (element.sizeMm * PT_PER_MM) / matrix.length;
      matrix.forEach((row, r) => {
        for (const [start, length] of darkRuns(row)) {
          page.drawRectangle({
            x: element.xMm * PT_PER_MM + start * cell,
            y: side - element.yMm * PT_PER_MM - (r + 1) * cell,
            width: length * cell,
            height: cell,
            color: black,
          });
        }
      });
    } else if (element.kind === 'logo' && logoImage) {
      const backW = element.backdropWidthMm * PT_PER_MM;
      const backH = element.backdropHeightMm * PT_PER_MM;
      const cx = (element.xMm + element.widthMm / 2) * PT_PER_MM;
      const cy = side - (element.yMm + element.heightMm / 2) * PT_PER_MM;
      page.drawRectangle({
        x: cx - backW / 2,
        y: cy - backH / 2,
        width: backW,
        height: backH,
        color: white,
      });
      page.drawImage(logoImage, {
        x: element.xMm * PT_PER_MM,
        y: side - (element.yMm + element.heightMm) * PT_PER_MM,
        width: element.widthMm * PT_PER_MM,
        height: element.heightMm * PT_PER_MM,
      });
    } else if (element.kind === 'text') {
      const font = element.bold ? bold : regular;
      const width = font.widthOfTextAtSize(element.text, element.sizePt);
      page.drawText(element.text, {
        x: element.centerMm * PT_PER_MM - width / 2,
        y: side - element.baselineMm * PT_PER_MM,
        size: element.sizePt,
        font,
        color: black,
      });
    }
  }
  return doc.save();
}

/**
 * Lembar 300 × 420 mm: label dibuat SEKALI lalu dirujuk 140 kali (`embedPdf`), sehingga berkas tetap kecil;
 * garis potong tipis di setiap batas sel.
 */
export async function buildSheetPdf(
  layout: LabelLayout,
  matrix: boolean[][],
  logoPng: Uint8Array | null,
  fonts: PdfFonts,
): Promise<Uint8Array> {
  const labelBytes = await buildLabelPdf(layout, matrix, logoPng, fonts);
  const sheet = await PDFDocument.create();
  const [embedded] = await sheet.embedPdf(labelBytes);
  if (!embedded) throw new Error('Label gagal disematkan');
  const width = SHEET.widthMm * PT_PER_MM;
  const height = SHEET.heightMm * PT_PER_MM;
  const side = LABEL_MM * PT_PER_MM;
  const page = sheet.addPage([width, height]);
  for (const cell of sheetCells()) {
    page.drawPage(embedded, {
      x: cell.xMm * PT_PER_MM,
      y: height - (cell.yMm + LABEL_MM) * PT_PER_MM,
      width: side,
      height: side,
    });
  }
  const line = { thickness: 0.25, color: rgb(0.45, 0.45, 0.45) };
  for (let c = 0; c <= SHEET.columns; c++) {
    const x = c * side;
    page.drawLine({ start: { x, y: 0 }, end: { x, y: height }, ...line });
  }
  for (let r = 0; r <= SHEET.rows; r++) {
    const y = height - r * side;
    page.drawLine({ start: { x: 0, y }, end: { x: width, y }, ...line });
  }
  return sheet.save();
}
