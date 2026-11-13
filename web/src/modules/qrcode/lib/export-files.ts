import type { QrLayout, QrStyle } from '@shared/qrcode';
import { layoutLabel, QR_LIMITS } from '@shared/qrcode';
import { loadLabelFonts, registerCanvasFonts } from './fonts';
import { createCanvasMeasure } from './measure';
import { setPngDpi } from './png-dpi';
import { fitPreviewSize, PREVIEW_SIDES } from './preview-png';
import { qrMatrix } from './qr-matrix';
import { renderLabelCanvas } from './render-canvas';
import { buildSheetPdf } from './render-pdf';

export interface ExportDesign {
  title: string;
  subtitle: string;
  footer: string;
  link: string;
  layout: QrLayout;
  style: QrStyle;
}

/** Logo sebagai berkas gambar (hasil `files.get`). */
export interface ExportLogo {
  mime: string;
  bytes: Uint8Array;
}

const PNG_DPI = 600;
const PNG_PX_PER_MM = PNG_DPI / 25.4;

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Gagal membuat PNG'))),
      'image/png',
    ),
  );
}

/**
 * Gambar contoh stiker (PNG kecil dari kanvas label yang sama): sisi terpanjang <= 800 px dan <= `previewMaxBytes`;
 * bila masih terlalu besar, diperkecil bertahap. Tanpa pHYs (bukan berkas cetak).
 */
async function renderPreview(source: HTMLCanvasElement): Promise<Uint8Array> {
  for (const side of PREVIEW_SIDES) {
    const size = fitPreviewSize(source.width, source.height, side);
    let canvas = source;
    if (size.width !== source.width || size.height !== source.height) {
      canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      canvas.getContext('2d')?.drawImage(source, 0, 0, size.width, size.height);
    }
    const bytes = new Uint8Array(await (await canvasToBlob(canvas)).arrayBuffer());
    if (bytes.length <= QR_LIMITS.previewMaxBytes) return bytes;
  }
  // Server menolak gambar contoh yang kebesaran (422): lebih baik gagal jelas di sini daripada setelah mengunggah.
  throw new Error('Gambar contoh stiker terlalu besar; sederhanakan isi label lalu coba lagi');
}

/**
 * Menghasilkan PDF lembar, PNG label tunggal, dan gambar contoh stiker (byte mentah). Melempar bila isi melebihi
 * kanvas 3 × 3 cm.
 */
export async function renderExportFiles(
  design: ExportDesign,
  logo: ExportLogo | null,
): Promise<{ pdf: Uint8Array; png: Uint8Array; preview: Uint8Array }> {
  const [fonts] = await Promise.all([loadLabelFonts(), registerCanvasFonts()]);
  const matrix = qrMatrix(design.link);
  // Logo di-decode lebih dulu: rasionya menentukan ukuran kotak logo pada tata letak.
  let logoSource: { image: ImageBitmap; width: number; height: number } | null = null;
  let logoPng: Uint8Array | null = null;
  if (logo) {
    const bitmap = await createImageBitmap(new Blob([logo.bytes as BlobPart], { type: logo.mime }));
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
      style: design.style,
      qrModules: matrix.length,
    },
    createCanvasMeasure(),
  );
  if (layout.overflow)
    throw new Error('Isi label melebihi kanvas 3 × 3 cm; perbaiki ukuran atau teks');
  const pngCanvas = renderLabelCanvas(layout, matrix, logoSource, PNG_PX_PER_MM);
  // Canvas tidak menyimpan resolusi: tambahkan pHYs 600 dpi agar tercetak tepat 3 cm.
  const pngBytes = setPngDpi(
    new Uint8Array(await (await canvasToBlob(pngCanvas)).arrayBuffer()),
    PNG_DPI,
  );
  const pdfBytes = await buildSheetPdf(layout, matrix, logoPng, fonts);
  return { pdf: pdfBytes, png: pngBytes, preview: await renderPreview(pngCanvas) };
}
