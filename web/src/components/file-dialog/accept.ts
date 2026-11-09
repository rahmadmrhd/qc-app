/** Kategori berkas yang dapat diminta pemanggil dialog; kategori baru ditambah di sini saja. */
export type FileCategory = 'image';

const CATEGORY_PREFIX: Record<FileCategory, string> = { image: 'image/' };

/** Mime yang diterima dialog: yang didukung sumber DAN termasuk salah satu kategori. */
export function resolveAccept(
  categories: readonly FileCategory[],
  supported: readonly string[],
): string[] {
  return supported.filter((mime) =>
    categories.some((category) => mime.startsWith(CATEGORY_PREFIX[category])),
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

const MIME_LABELS: Record<string, string> = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
};

function mimeLabel(mime: string): string {
  return MIME_LABELS[mime] ?? (mime.split('/')[1] ?? mime).toUpperCase();
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Nama format untuk alasan penolakan, dari tipe (atau ekstensi bila tipe kosong, mis. HEIC di sebagian peramban). */
function describeFormat(file: { name: string; type: string }): string | null {
  const type = file.type.toLowerCase();
  const extension = extensionOf(file.name);
  if (type === 'image/heic' || type === 'image/heif' || ['heic', 'heif'].includes(extension)) {
    return 'HEIC';
  }
  if (type === 'image/gif' || (type === '' && extension === 'gif')) return 'GIF';
  if (type === 'application/pdf' || (type === '' && extension === 'pdf')) return 'PDF';
  return null;
}

/**
 * Pemeriksaan satu berkas di klien. Mengembalikan alasan (bahasa Indonesia, tanpa nama berkas; nama dibawa
 * terpisah oleh pemanggil) atau `null` bila lolos.
 */
export function checkFile(
  file: { name: string; size: number; type: string },
  rule: { accept: readonly string[]; maxBytes: number },
): string | null {
  if (!rule.accept.includes(file.type)) {
    const supported = rule.accept.map(mimeLabel).join(', ');
    const format = describeFormat(file);
    return format
      ? `Format ${format} tidak didukung (hanya ${supported})`
      : `Format tidak didukung (hanya ${supported})`;
  }
  if (file.size === 0) return 'Berkas kosong';
  if (file.size > rule.maxBytes) return `Ukuran melebihi ${formatBytes(rule.maxBytes)}`;
  return null;
}

/**
 * Nama awal dari nama berkas: ekstensi terakhir dibuang, spasi dirapikan, dipotong `max` karakter (titik kode)
 * bila diberikan. Hasil kosong = "Berkas".
 */
export function baseName(filename: string, max?: number): string {
  const dot = filename.lastIndexOf('.');
  const base = dot >= 0 ? filename.slice(0, dot) : filename;
  const collapsed = base.replace(/\s+/g, ' ').trim();
  if (collapsed === '') return 'Berkas';
  if (max === undefined) return collapsed;
  return [...collapsed].slice(0, max).join('').trim();
}
