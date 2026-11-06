import type { QrLayout, QrStyle } from '@shared/qrcode';
import { layoutLabel } from '@shared/qrcode';
import { loadLabelFonts, registerCanvasFonts } from './fonts';
import { createCanvasMeasure } from './measure';
import { setPngDpi } from './png-dpi';
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

/** Menghasilkan PDF lembar dan PNG label tunggal (byte mentah). Melempar bila isi melebihi kanvas 3 × 3 cm. */
export async function renderExportFiles(
  design: ExportDesign,
  logo: ExportLogo | null,
): Promise<{ pdf: Uint8Array; png: Uint8Array }> {
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
  return { pdf: pdfBytes, png: pngBytes };
}
