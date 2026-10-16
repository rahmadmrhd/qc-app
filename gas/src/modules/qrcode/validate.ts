import { readObject_ } from '@gas/core/validate';
import { base64ByteLength, isBase64Text } from '@shared/files';
import type { QrStyle } from '@shared/qrcode';
import { isHttpUrl, isQrLayout, isQrStyle, isRenderableLabelText, QR_LIMITS } from '@shared/qrcode';
import type {
  ExportQrDesignInput,
  QrDesignRefInput,
  QrFileInput,
  SaveQrDesignInput,
  UploadQrPdfInput,
} from '@shared/rpc';

const QR_PDF_PREFIX = 'JVBERi0'; // "%PDF-" dalam base64
const QR_PNG_PREFIX = 'iVBORw0KGgo';
const QR_FILE_KINDS = ['pdf', 'png'] as const;
const QR_LINK_SOURCES = ['url', 'pdf'] as const;

export function validateSaveQrDesign_(raw: unknown): SaveQrDesignInput {
  const reader = readObject_(raw);
  const id = reader.optionalId('id');
  const expectedUpdatedAt = reader.optionalId('expectedUpdatedAt');
  // Mengubah wajib membawa versi yang dimuat: tanpa itu, perubahan orang lain bisa tertimpa diam-diam.
  if (id && !expectedUpdatedAt) reader.fail('expectedUpdatedAt', 'Wajib diisi saat mengubah');
  const title = reader.str('title', { required: true, max: QR_LIMITS.title });
  const linkSource = reader.oneOf('linkSource', QR_LINK_SOURCES);
  const subtitle = reader.str('subtitle', { max: QR_LIMITS.subtitle });
  const footer = reader.str('footer', { max: QR_LIMITS.footer });
  for (const [key, text] of [
    ['title', title],
    ['subtitle', subtitle],
    ['footer', footer],
  ] as const) {
    if (text !== '' && !isRenderableLabelText(text)) {
      reader.fail(
        key,
        'Karakter tidak didukung font label (gunakan huruf Latin, angka, dan tanda baca umum)',
      );
    }
  }
  let link = '';
  let documentId = '';
  if (linkSource === 'url') {
    link = reader.str('link', { required: true, max: QR_LIMITS.link });
    if (link !== '' && !isHttpUrl(link))
      reader.fail('link', 'Link harus diawali http:// atau https:// tanpa spasi');
  } else {
    documentId = reader.str('documentId', { required: true, max: 100 });
  }
  const logoFileId = reader.str('logoFileId', { max: 100 });
  const layout = reader.raw('layout');
  if (!isQrLayout(layout))
    reader.fail('layout', 'Ukuran tata letak tidak valid atau di luar rentang');
  const overflow = reader.raw('overflow');
  if (overflow !== undefined && typeof overflow !== 'boolean') {
    reader.fail('overflow', 'Harus true atau false');
  }
  const style = reader.raw('style');
  if (style !== undefined && !isQrStyle(style)) {
    reader.fail('style', 'Gaya teks atau bingkai tidak valid atau di luar rentang');
  }
  reader.done();
  const input: SaveQrDesignInput = {
    title,
    linkSource,
    link,
    documentId,
    subtitle,
    footer,
    logoFileId,
    layout: layout as SaveQrDesignInput['layout'],
    ...(style === undefined ? {} : { style: style as QrStyle }),
    ...(typeof overflow === 'boolean' ? { overflow } : {}),
  };
  return {
    ...(id ? { id } : {}),
    ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
    ...input,
  };
}

export function validateQrDesignRef_(raw: unknown): QrDesignRefInput {
  const reader = readObject_(raw);
  const id = reader.str('id', { required: true, max: 100 });
  reader.done();
  return { id };
}

export function validateUploadQrPdf_(raw: unknown): UploadQrPdfInput {
  const reader = readObject_(raw);
  const name = reader.str('name', { required: true, max: QR_LIMITS.documentName });
  const replaceDocumentId = reader.optionalId('replaceDocumentId');
  const base64 = reader.raw('base64');
  if (typeof base64 !== 'string' || !isBase64Text(base64)) {
    reader.fail('base64', 'Isi berkas tidak valid');
  } else if (base64ByteLength(base64) > QR_LIMITS.documentMaxBytes) {
    reader.fail('base64', 'Ukuran PDF maksimal 10 MB');
  } else if (!base64.startsWith(QR_PDF_PREFIX)) {
    reader.fail('base64', 'Berkas bukan PDF');
  }
  reader.done();
  return { name, base64: base64 as string, ...(replaceDocumentId ? { replaceDocumentId } : {}) };
}

export function validateExportQrDesign_(raw: unknown): ExportQrDesignInput {
  const reader = readObject_(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const expectedUpdatedAt = reader.str('expectedUpdatedAt', { required: true, max: 40 });
  const pdf = reader.raw('pdfBase64');
  const png = reader.raw('pngBase64');
  if (typeof pdf !== 'string' || !isBase64Text(pdf) || !pdf.startsWith(QR_PDF_PREFIX)) {
    reader.fail('pdfBase64', 'PDF tidak valid');
  }
  if (typeof png !== 'string' || !isBase64Text(png) || !png.startsWith(QR_PNG_PREFIX)) {
    reader.fail('pngBase64', 'PNG tidak valid');
  }
  if (
    typeof pdf === 'string' &&
    typeof png === 'string' &&
    base64ByteLength(pdf) + base64ByteLength(png) > QR_LIMITS.exportMaxBytes
  ) {
    reader.fail('pdfBase64', 'Ukuran hasil ekspor maksimal 8 MB');
  }
  reader.done();
  return { id, expectedUpdatedAt, pdfBase64: pdf as string, pngBase64: png as string };
}

export function validateQrFile_(raw: unknown): QrFileInput {
  const reader = readObject_(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const kind = reader.oneOf('kind', QR_FILE_KINDS);
  reader.done();
  return { id, kind };
}
