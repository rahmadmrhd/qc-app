import type { QrLayout } from '@shared/qrcode';
import { layoutLabel } from '@shared/qrcode';
import { loadLabelFonts, registerCanvasFonts } from './fonts';
import { createCanvasMeasure } from './measure';
import { qrMatrix } from './qr-matrix';
import { renderLabelCanvas } from './render-canvas';
import { buildSheetPdf } from './render-pdf';

export interface ExportDesign {
  title: string;
  subtitle: string;
  footer: string;
  link: string;
  layout: QrLayout;
}

/** Logo sebagai berkas gambar (hasil `files.get`). */
export interface ExportLogo {
  mime: string;
  base64: string;
}

const PNG_PX_PER_MM = 600 / 25.4;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Gagal membuat PNG'))),
      'image/png',
    ),
  );
}

/** Menghasilkan PDF lembar dan PNG label tunggal (base64). Melempar bila isi melebihi kanvas 3 × 3 cm. */
export async function renderExportFiles(
  design: ExportDesign,
  logo: ExportLogo | null,
): Promise<{ pdfBase64: string; pngBase64: string }> {
  const [fonts] = await Promise.all([loadLabelFonts(), registerCanvasFonts()]);
  const matrix = qrMatrix(design.link);
  // Logo di-decode lebih dulu: rasionya menentukan ukuran kotak logo pada tata letak.
  let logoSource: { image: ImageBitmap; width: number; height: number } | null = null;
  let logoPng: Uint8Array | null = null;
  if (logo) {
    const bitmap = await createImageBitmap(
      new Blob([base64ToBytes(logo.base64)], { type: logo.mime }),
    );
    logoSource = { image: bitmap, width: bitmap.width, height: bitmap.height };
    // pdf-lib hanya menyematkan PNG/JPEG: ubah logo (mis. WebP) menjadi PNG berlatar transparan.
    const logoCanvas = document.createElement('canvas');
    logoCanvas.width = bitmap.width;
    logoCanvas.height = bitmap.height;
    logoCanvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    logoPng = new Uint8Array(await (await canvasToBlob(logoCanvas)).arrayBuffer());
  }
  const layout = layoutLabel(
    {
      title: design.title,
      subtitle: design.subtitle,
      footer: design.footer,
      hasLogo: logoSource !== null,
      logoAspect: logoSource ? logoSource.width / logoSource.height : 1,
      layout: design.layout,
      qrModules: matrix.length,
    },
    createCanvasMeasure(),
  );
  if (layout.overflow)
    throw new Error('Isi label melebihi kanvas 3 × 3 cm; perbaiki ukuran atau teks');
  const pngCanvas = renderLabelCanvas(layout, matrix, logoSource, PNG_PX_PER_MM);
  const pngBytes = new Uint8Array(await (await canvasToBlob(pngCanvas)).arrayBuffer());
  const pdfBytes = await buildSheetPdf(layout, matrix, logoPng, fonts);
  return { pdfBase64: bytesToBase64(pdfBytes), pngBase64: bytesToBase64(pngBytes) };
}
