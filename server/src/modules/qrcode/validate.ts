import { readObject } from '@server/core/validate';
import type {
  ClonePresetInput,
  CloneQrPdfInput,
  ExportQrDesignInput,
  GetQrDefaultsInput,
  ListQrDesignsInput,
  ListQrItemOptionsInput,
  QrDesignRefInput,
  QrFileInput,
  SaveQrDesignInput,
  SaveQrLogoLibraryInput,
  SaveQrPresetInput,
  UploadQrPdfInput,
} from '@shared/contract';
import { isPdfBytes, isPngBytes } from '@shared/files';
import type { QrStyle } from '@shared/qrcode';
import { isHttpUrl, isQrLayout, isQrStyle, isRenderableLabelText, QR_LIMITS } from '@shared/qrcode';

const QR_FILE_KINDS = ['pdf', 'png'] as const;
const QR_LINK_SOURCES = ['url', 'pdf'] as const;
const QR_NAME_PLACEMENTS = ['title', 'subtitle', 'footer'] as const;

export function validateSaveQrDesign(raw: unknown): SaveQrDesignInput {
  const reader = readObject(raw);
  const id = reader.optionalId('id');
  const expectedUpdatedAt = reader.optionalId('expectedUpdatedAt');
  // Mengubah wajib membawa versi yang dimuat: tanpa itu, perubahan orang lain bisa tertimpa diam-diam.
  if (id && !expectedUpdatedAt) reader.fail('expectedUpdatedAt', 'Wajib diisi saat mengubah');
  const name = reader.str('name', { max: QR_LIMITS.manualBookName });
  const presetId = reader.str('presetId', { max: 100 });
  const itemIdsRaw = reader.raw('itemIds');
  if (
    !Array.isArray(itemIdsRaw) ||
    itemIdsRaw.length > QR_LIMITS.items ||
    itemIdsRaw.some((value) => typeof value !== 'string' || value === '' || value.length > 100)
  ) {
    reader.fail('itemIds', `Pilih maksimal ${QR_LIMITS.items} item`);
  }
  const title = reader.str('title', { required: true, max: QR_LIMITS.title });
  const linkSource = reader.oneOf('linkSource', QR_LINK_SOURCES);
  const subtitle = reader.str('subtitle', { max: QR_LIMITS.subtitle });
  const footer = reader.str('footer', { max: QR_LIMITS.footer });
  for (const [key, text] of [
    ['name', name],
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
    name,
    presetId,
    itemIds: [...new Set(itemIdsRaw as string[])],
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

export function validateSaveQrPreset(raw: unknown): SaveQrPresetInput {
  const reader = readObject(raw);
  const id = reader.optionalId('id');
  const expectedUpdatedAt = reader.optionalId('expectedUpdatedAt');
  if (id && !expectedUpdatedAt) reader.fail('expectedUpdatedAt', 'Wajib diisi saat mengubah');
  const name = reader.str('name', { required: true, max: QR_LIMITS.presetName });
  const title = reader.str('title', { max: QR_LIMITS.title });
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
  const layout = reader.raw('layout');
  if (!isQrLayout(layout))
    reader.fail('layout', 'Ukuran tata letak tidak valid atau di luar rentang');
  const style = reader.raw('style');
  if (!isQrStyle(style))
    reader.fail('style', 'Gaya teks atau bingkai tidak valid atau di luar rentang');
  const defaultLogoId = reader.str('defaultLogoId', { max: 100 });
  const buId = reader.str('buId', { required: true, max: 100 });
  const namePlacement = reader.oneOf('namePlacement', QR_NAME_PLACEMENTS);
  reader.done();
  return {
    ...(id ? { id } : {}),
    ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
    buId,
    namePlacement,
    name,
    title,
    subtitle,
    footer,
    layout: layout as SaveQrPresetInput['layout'],
    style: style as QrStyle,
    defaultLogoId,
  };
}

export function validateClonePreset(raw: unknown): ClonePresetInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const buId = reader.str('buId', { required: true, max: 100 });
  const name = reader.str('name', { required: true, max: QR_LIMITS.presetName });
  reader.done();
  return { id, buId, name };
}

export function validateSaveQrLogoLibrary(raw: unknown): SaveQrLogoLibraryInput {
  const reader = readObject(raw);
  const expectedUpdatedAt = reader.optionalId('expectedUpdatedAt');
  const ids = reader.raw('logoFileIds');
  if (
    !Array.isArray(ids) ||
    ids.length > QR_LIMITS.logoLibrary ||
    ids.some((id) => typeof id !== 'string' || id === '' || id.length > 100)
  ) {
    reader.fail('logoFileIds', `Pustaka logo maksimal ${QR_LIMITS.logoLibrary} berkas`);
  }
  reader.done();
  return {
    ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
    logoFileIds: [...new Set(ids as string[])],
  };
}

const QR_LIST_STATUS_VALUES = ['live', 'deleted'] as const;

/** Masukan opsional `{ status }` (daftar konfigurasi, konfigurasi default): kosong = hanya yang hidup. */
function readLiveStatus(raw: unknown): { status?: 'live' | 'deleted' } | null {
  if (raw === null || raw === undefined) return null;
  const reader = readObject(raw);
  const value = reader.raw('status');
  if (value === undefined || value === null || value === '') {
    reader.done();
    return {};
  }
  const status = reader.oneOf('status', QR_LIST_STATUS_VALUES);
  reader.done();
  return { status };
}

/** `qrcodes.list`: input boleh kosong; `status` opsional (`deleted` hanya bagi `qrcode: manage`, dicek di service). */
export function validateListQrDesigns(raw: unknown): ListQrDesignsInput | null {
  return readLiveStatus(raw);
}

/** `qrcodes.getDefaults`: sama seperti daftar (preset terhapus hanya bagi `qrcode: manage`). */
export function validateGetQrDefaults(raw: unknown): GetQrDefaultsInput | null {
  return readLiveStatus(raw);
}

export function validateQrDesignRef(raw: unknown): QrDesignRefInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: 100 });
  reader.done();
  return { id };
}

export function validateCloneQrPdf(raw: unknown): CloneQrPdfInput {
  const reader = readObject(raw);
  const source = reader.str('source', { required: true, max: 500 });
  const replaceDocumentId = reader.optionalId('replaceDocumentId');
  reader.done();
  return { source, ...(replaceDocumentId ? { replaceDocumentId } : {}) };
}

export function validateUploadQrPdf(raw: unknown): UploadQrPdfInput {
  const reader = readObject(raw);
  const name = reader.str('name', { required: true, max: QR_LIMITS.documentName });
  const replaceDocumentId = reader.optionalId('replaceDocumentId');
  const bytes = reader.raw('bytes');
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    reader.fail('bytes', 'Isi berkas tidak valid');
  } else if (bytes.length > QR_LIMITS.documentMaxBytes) {
    reader.fail('bytes', 'Ukuran PDF maksimal 10 MB');
  } else if (!isPdfBytes(bytes)) {
    reader.fail('bytes', 'Berkas bukan PDF');
  }
  reader.done();
  return { name, bytes: bytes as Uint8Array, ...(replaceDocumentId ? { replaceDocumentId } : {}) };
}

export function validateExportQrDesign(raw: unknown): ExportQrDesignInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const expectedUpdatedAt = reader.str('expectedUpdatedAt', { required: true, max: 40 });
  const pdf = reader.raw('pdf');
  const png = reader.raw('png');
  if (!(pdf instanceof Uint8Array) || !isPdfBytes(pdf)) reader.fail('pdf', 'PDF tidak valid');
  if (!(png instanceof Uint8Array) || !isPngBytes(png)) reader.fail('png', 'PNG tidak valid');
  // Gambar contoh: bagian boleh tidak ada (kosong); bila ada harus PNG sah dan tidak melebihi batas.
  const previewRaw = reader.raw('preview');
  const preview = previewRaw === undefined || previewRaw === null ? new Uint8Array(0) : previewRaw;
  if (!(preview instanceof Uint8Array)) {
    reader.fail('preview', 'Gambar contoh tidak valid');
  } else if (preview.length > 0 && !isPngBytes(preview)) {
    reader.fail('preview', 'Gambar contoh harus PNG');
  } else if (preview.length > QR_LIMITS.previewMaxBytes) {
    reader.fail('preview', 'Ukuran gambar contoh maksimal 512 KB');
  }
  const reason = reader.str('reason', { max: QR_LIMITS.reason });
  if (
    pdf instanceof Uint8Array &&
    png instanceof Uint8Array &&
    pdf.length + png.length > QR_LIMITS.exportMaxBytes
  ) {
    reader.fail('pdf', 'Ukuran hasil ekspor maksimal 8 MB');
  }
  reader.done();
  return {
    id,
    expectedUpdatedAt,
    pdf: pdf as Uint8Array,
    png: png as Uint8Array,
    preview: preview as Uint8Array,
    reason,
  };
}

const QR_ITEM_OPTIONS_MAX_LIMIT = 50;

/** Opsi item untuk pemilih: input boleh kosong; `cursor` buram (kunci item terakhir). */
export function validateListQrItemOptions(raw: unknown): ListQrItemOptionsInput {
  const reader = readObject(raw ?? {});
  const cursor = reader.raw('cursor');
  if (cursor !== undefined && cursor !== null && (typeof cursor !== 'string' || cursor === '')) {
    reader.fail('cursor', 'Kursor tidak valid');
  }
  const limit = reader.raw('limit');
  if (
    limit !== undefined &&
    limit !== null &&
    (typeof limit !== 'number' ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > QR_ITEM_OPTIONS_MAX_LIMIT)
  ) {
    reader.fail('limit', `Batas halaman harus 1-${QR_ITEM_OPTIONS_MAX_LIMIT}`);
  }
  const query = reader.str('query', { max: 100 });
  reader.done();
  return {
    ...(typeof limit === 'number' ? { limit } : {}),
    ...(typeof cursor === 'string' ? { cursor } : {}),
    ...(query !== '' ? { query } : {}),
  };
}

export function validateQrFile(raw: unknown): QrFileInput {
  const reader = readObject(raw);
  const id = reader.str('id', { required: true, max: 100 });
  const kind = reader.oneOf('kind', QR_FILE_KINDS);
  reader.done();
  return { id, kind };
}
